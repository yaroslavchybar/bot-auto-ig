/** Run only when subscribed work exists. Coalesce updates while a task is busy. */
export function reactiveWork<T>(options: {
  dueAt: (state: T) => number | null;
  run: () => Promise<void>;
  onError: (error: unknown) => void;
  retryMs?: number;
}) {
  let state: T | undefined;
  let busy = false;
  let stopped = false;
  let revision = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (minimumDelay = 0) => {
    if (timer) clearTimeout(timer);
    if (stopped || busy || state === undefined) return;
    const at = options.dueAt(state);
    if (at === null) return;
    timer = setTimeout(() => { void tick(); }, Math.min(2_147_483_647, Math.max(minimumDelay, at - Date.now(), 0)));
    timer.unref?.();
  };
  const tick = async () => {
    timer = undefined;
    if (stopped || busy) return;
    busy = true;
    const startedRevision = revision;
    let failed = false;
    try { await options.run(); }
    catch (error) { failed = true; options.onError(error); }
    finally {
      busy = false;
      schedule(!failed && revision !== startedRevision ? 0 : options.retryMs ?? 30_000);
    }
  };
  return {
    update(value: T) { state = value; revision++; schedule(); },
    stop() { stopped = true; if (timer) clearTimeout(timer); },
  };
}
