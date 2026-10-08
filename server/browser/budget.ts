import { nativeLease } from '../shared/runtimeSockets.js'

export async function acquireBrowserSlot(
  signal: AbortSignal,
  onLost: () => void = () => {},
): Promise<() => void> {
  return (await nativeLease('/browser/lease', undefined, signal, onLost)).release
}
