// Open immediately; delay closing so a brief tab switch doesn't reconnect VNC.
export function createVisibilityGate(onChange: (active: boolean) => void, delayMs: number) {
  let active = false
  let timer: ReturnType<typeof setTimeout> | undefined
  return {
    update(visible: boolean) {
      clearTimeout(timer)
      if (visible) {
        if (!active) { active = true; onChange(true) }
      } else if (active) {
        timer = setTimeout(() => { active = false; onChange(false) }, delayMs)
      }
    },
    dispose() { clearTimeout(timer) },
  }
}
