use rand::Rng;
use std::{collections::VecDeque, time::Duration};
use tokio::{
    sync::{Mutex, MutexGuard},
    time::Instant,
};

#[derive(Clone, Copy)]
pub(super) struct Settings {
    pub min_gap: Duration,
    pub max_gap: Duration,
    pub window: Duration,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            min_gap: Duration::from_secs(10),
            max_gap: Duration::from_secs(20),
            window: Duration::from_secs(60),
        }
    }
}

#[derive(Default)]
struct State {
    next: Option<Instant>,
    recent: VecDeque<Instant>,
}

/// Share random spacing and a rolling three-request cap across all liker checks.
#[derive(Default)]
pub(super) struct Pacing {
    settings: Settings,
    state: Mutex<State>,
}

pub(super) struct Permit<'a> {
    settings: Settings,
    state: MutexGuard<'a, State>,
}

impl Permit<'_> {
    // Charge at dispatch, after waiting for the session lock and refreshing its context.
    pub fn record(&mut self) {
        let now = Instant::now();
        while self
            .state
            .recent
            .front()
            .is_some_and(|at| *at + self.settings.window <= now)
        {
            self.state.recent.pop_front();
        }
        let gap = rand::thread_rng().gen_range(
            self.settings.min_gap.as_millis() as u64..=self.settings.max_gap.as_millis() as u64,
        );
        self.state.recent.push_back(now);
        self.state.next = Some(now + Duration::from_millis(gap));
    }
}

impl Pacing {
    pub fn new(settings: Settings) -> Self {
        Self {
            settings,
            state: Mutex::default(),
        }
    }

    pub async fn wait(&self) -> Permit<'_> {
        let mut state = self.state.lock().await;
        loop {
            let now = Instant::now();
            while state
                .recent
                .front()
                .is_some_and(|at| *at + self.settings.window <= now)
            {
                state.recent.pop_front();
            }
            let mut ready = state.next.unwrap_or(now);
            if state.recent.len() >= 3 {
                ready = ready.max(state.recent[0] + self.settings.window);
            }
            if ready > now {
                tokio::time::sleep_until(ready).await;
                continue;
            }
            return Permit {
                settings: self.settings,
                state,
            };
        }
    }

    // Evicting a live window would let the next check bypass the cap.
    pub fn cooling_down(&self) -> bool {
        let Ok(state) = self.state.try_lock() else {
            return true;
        };
        let now = Instant::now();
        state.next.is_some_and(|at| at > now)
            || state
                .recent
                .back()
                .is_some_and(|at| *at + self.settings.window > now)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[tokio::test(start_paused = true)]
    async fn random_spacing_keeps_three_requests_in_a_rolling_minute() {
        let pacing = Pacing::default();
        let start = Instant::now();
        let mut times = Vec::new();
        for _ in 0..12 {
            pacing.wait().await.record();
            times.push(Instant::now());
            let next = pacing.state.lock().await.next.unwrap();
            assert!((Duration::from_secs(10)..=Duration::from_secs(20))
                .contains(&(next - Instant::now())));
        }
        assert_eq!(times[0], start);
        for pair in times.windows(2) {
            assert!(pair[1] - pair[0] >= Duration::from_secs(10));
        }
        for window in times.windows(4) {
            assert!(window[3] - window[0] >= Duration::from_secs(60));
        }
    }

    #[tokio::test(start_paused = true)]
    async fn queued_checks_share_the_cap_and_cancellation_does_not_reset_it() {
        let pacing = Arc::new(Pacing::default());
        pacing.wait().await.record();
        let next = pacing.state.lock().await.next.unwrap();
        let waiting = pacing.clone();
        let cancelled = tokio::spawn(async move { waiting.wait().await.record() });
        tokio::task::yield_now().await;
        cancelled.abort();
        assert!(cancelled.await.unwrap_err().is_cancelled());
        assert_eq!(pacing.state.lock().await.next, Some(next));
        assert_eq!(pacing.state.lock().await.recent.len(), 1);
        let mut tasks = Vec::new();
        for _ in 0..4 {
            let pacing = pacing.clone();
            tasks.push(tokio::spawn(async move {
                pacing.wait().await.record();
                Instant::now()
            }));
        }
        let mut times = Vec::new();
        for task in tasks {
            times.push(task.await.unwrap());
        }
        times.sort();
        assert!(times[0] >= next);
        assert!(times[3] - times[0] >= Duration::from_secs(60));
        assert!(pacing.cooling_down());
        tokio::time::advance(Duration::from_secs(60)).await;
        assert!(!pacing.cooling_down());
    }

    #[tokio::test(start_paused = true)]
    async fn delayed_dispatch_does_not_accumulate_permits_or_skip_spacing() {
        let pacing = Arc::new(Pacing::default());
        let mut permit = pacing.wait().await;
        let queued = pacing.clone();
        let next = tokio::spawn(async move {
            queued.wait().await.record();
            Instant::now()
        });
        tokio::time::advance(Duration::from_secs(120)).await;
        assert!(!next.is_finished());
        permit.record();
        let dispatched = Instant::now();
        drop(permit);
        assert!(next.await.unwrap() - dispatched >= Duration::from_secs(10));
    }
}
