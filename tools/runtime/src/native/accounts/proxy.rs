use super::{profiles, Failure, Result};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::{Mutex, OwnedMutexGuard, Semaphore};
pub struct Proxies {
    root: PathBuf,
    cache: Mutex<HashMap<String, (Instant, Value)>>,
    blacklist: Mutex<()>,
    exits: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    quarantine: Mutex<Vec<OwnedMutexGuard<()>>>,
    probes: Semaphore,
    #[cfg(test)]
    pub(super) probe_url: String,
}
impl Proxies {
    pub fn new(root: PathBuf) -> Arc<Self> {
        Arc::new(Self {
            root,
            cache: Default::default(),
            blacklist: Default::default(),
            exits: Default::default(),
            quarantine: Default::default(),
            probes: Semaphore::new(8),
            #[cfg(test)]
            probe_url: "https://ipwho.is/".into(),
        })
    }
    pub async fn exit(&self, raw: &str, cached: bool) -> Result<Value> {
        let proxy = crate::instagram::normalize_proxy(raw, "")
            .map_err(|_| Failure::invalid("Invalid proxy protocol or URL"))?;
        if proxy.is_empty() {
            return Err(Failure::invalid("Proxy is required"));
        }
        if cached {
            if let Some((_, value)) = self
                .cache
                .lock()
                .await
                .get(&proxy)
                .filter(|(expires, _)| *expires > Instant::now())
            {
                return Ok(value.clone());
            }
        }
        let _slot = self
            .probes
            .acquire()
            .await
            .map_err(|_| Failure::unavailable("Proxy service stopped"))?;
        let proxy_config = reqwest::Proxy::all(proxy.replacen("socks5://", "socks5h://", 1))
            .map_err(|_| Failure::invalid("Invalid proxy"))?;
        let client = reqwest::Client::builder()
            .no_proxy()
            .proxy(proxy_config)
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|_| Failure::unavailable("Proxy client unavailable"))?;
        #[cfg(test)]
        let url = &self.probe_url;
        #[cfg(not(test))]
        let url = "https://ipwho.is/";
        let response = client
            .get(url)
            .send()
            .await
            .map_err(|_| Failure::unavailable("Geolocation lookup failed"))?;
        if !response.status().is_success() {
            return Err(Failure::unavailable("Geolocation lookup failed"));
        }
        let value = crate::api::bounded_json(response, 20_000).await?;
        let ip = profiles::text(&value, "ip");
        let country = profiles::text(&value, "country_code");
        if value["success"] != true
            || ip.parse::<std::net::IpAddr>().is_err()
            || country.len() != 2
            || !country.bytes().all(|c| c.is_ascii_uppercase())
        {
            return Err(Failure::unavailable(
                "Proxy exit country could not be determined",
            ));
        }
        let value = json!({"ip":ip,"country":country.to_lowercase()});
        if cached {
            let mut cache = self.cache.lock().await;
            cache.retain(|_, (at, _)| *at > Instant::now());
            if cache.len() < 1000 {
                cache.insert(
                    proxy,
                    (
                        Instant::now() + Duration::from_secs(6 * 3600),
                        value.clone(),
                    ),
                );
            }
        }
        Ok(value)
    }
    pub async fn claim_exit(&self, ip: &str) -> Option<OwnedMutexGuard<()>> {
        let mut exits = self.exits.lock().await;
        exits.retain(|_, v| Arc::strong_count(v) > 1);
        if !exits.contains_key(ip) && exits.len() >= 1000 {
            return None;
        }
        exits
            .entry(ip.into())
            .or_default()
            .clone()
            .try_lock_owned()
            .ok()
    }
    // An unacknowledged browser cancellation must never permit IP reuse in this runtime.
    pub async fn quarantine(&self, guard: OwnedMutexGuard<()>) {
        self.quarantine.lock().await.push(guard);
    }
    async fn read_blacklist(&self) -> Result<Value> {
        match tokio::fs::read(self.root.join("data/login-proxy-blacklist.json")).await {
            Ok(bytes) => {
                let rows: Value = serde_json::from_slice(&bytes)?;
                if !rows.is_array() {
                    return Err(Failure::unavailable("Invalid proxy blacklist"));
                }
                Ok(rows)
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(json!([])),
            Err(e) => Err(e.into()),
        }
    }
    pub async fn blacklist(&self) -> Result<Value> {
        let _guard = self.blacklist.lock().await;
        self.read_blacklist().await
    }
    pub async fn block(&self, row: Value) -> Result<()> {
        if profiles::text(&row, "ip")
            .parse::<std::net::IpAddr>()
            .is_err()
        {
            return Err(Failure::invalid("Invalid proxy exit IP"));
        }
        let _guard = self.blacklist.lock().await;
        let mut rows = self.read_blacklist().await?;
        if rows
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v["ip"] == row["ip"])
        {
            return Ok(());
        }
        rows.as_array_mut().unwrap().push(row);
        let dir = self.root.join("data");
        tokio::fs::create_dir_all(&dir).await?;
        let bytes = serde_json::to_vec(&rows)?;
        tokio::task::spawn_blocking(move || -> Result<()> {
            use std::io::Write;
            let mut file = tempfile::NamedTempFile::new_in(&dir)?;
            file.write_all(&bytes)?;
            file.as_file().sync_all()?;
            file.persist(dir.join("login-proxy-blacklist.json"))
                .map_err(|_| Failure::unavailable("Proxy blacklist save failed"))?;
            #[cfg(unix)]
            std::fs::File::open(&dir)?.sync_all()?;
            Ok(())
        })
        .await
        .map_err(|_| Failure::unavailable("Proxy blacklist task failed"))?
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::Fixture;
    use axum::{response::IntoResponse, Json};
    use std::sync::atomic::{AtomicUsize, Ordering};
    #[tokio::test]
    async fn probes_use_the_actual_proxy_cache_only_work_exits_and_serialize_ip_claims() {
        let count = Arc::new(AtomicUsize::new(0));
        let seen = count.clone();
        let fixture = Fixture::start(move |request| {
            let count = seen.clone();
            async move {
                assert_eq!(request.uri().host(), Some("geo.fixture"));
                count.fetch_add(1, Ordering::SeqCst);
                Json(json!({"success":true,"ip":"203.0.113.1","country_code":"UA"})).into_response()
            }
        })
        .await;
        let root = tempfile::tempdir().unwrap();
        let mut state = Proxies::new(root.path().into());
        Arc::get_mut(&mut state).unwrap().probe_url = "http://geo.fixture/".into();
        assert_eq!(
            state.exit(&fixture.url, true).await.unwrap(),
            json!({"ip":"203.0.113.1","country":"ua"})
        );
        state.exit(&fixture.url, true).await.unwrap();
        assert_eq!(count.load(Ordering::SeqCst), 1);
        state.exit(&fixture.url, false).await.unwrap();
        assert_eq!(count.load(Ordering::SeqCst), 2);
        let claim = state.claim_exit("203.0.113.1").await.unwrap();
        assert!(state.claim_exit("203.0.113.1").await.is_none());
        drop(claim);
        assert!(state.claim_exit("203.0.113.1").await.is_some());
        state
            .block(json!({"ip":"203.0.113.1","country":"ua"}))
            .await
            .unwrap();
        state
            .block(json!({"ip":"203.0.113.1","country":"ua"}))
            .await
            .unwrap();
        assert_eq!(
            state.blacklist().await.unwrap().as_array().unwrap().len(),
            1
        );
        assert!(state.exit("", false).await.is_err());
        assert!(state.exit("file:///tmp/proxy", false).await.is_err());
    }
}
