import { afterEach, expect, test, vi } from 'vitest';
import { reactiveWork } from '../../server/shared/reactiveWork';
afterEach(() => vi.useRealTimers());

test('idle workers make no calls and timestamps wake them without a write', async () => {
  vi.useFakeTimers();
  const run = vi.fn(async () => {});
  const worker = reactiveWork<number | null>({ dueAt: value => value, run, onError: vi.fn() });
  worker.update(null);
  await vi.advanceTimersByTimeAsync(86_400_000);
  expect(run).not.toHaveBeenCalled();
  worker.update(Date.now() + 60_000);
  await vi.advanceTimersByTimeAsync(59_999);
  expect(run).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(run).toHaveBeenCalledTimes(1);
  worker.update(null);
  await vi.advanceTimersByTimeAsync(86_400_000);
  expect(run).toHaveBeenCalledTimes(1);
  worker.stop();
});

test('coalesces busy updates, retries failures, and cancels on stop', async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const run = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }))
    .mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  const onError = vi.fn();
  const worker = reactiveWork<number | null>({ dueAt: value => value, run, onError });
  worker.update(0);
  await vi.advanceTimersByTimeAsync(0);
  for (let i = 0; i < 10; i++) worker.update(0);
  expect(run).toHaveBeenCalledTimes(1);
  release();
  await vi.advanceTimersByTimeAsync(1);
  expect(run).toHaveBeenCalledTimes(2);
  expect(onError).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(run).toHaveBeenCalledTimes(3);
  worker.stop();
  await vi.advanceTimersByTimeAsync(86_400_000);
  expect(run).toHaveBeenCalledTimes(3);
});
