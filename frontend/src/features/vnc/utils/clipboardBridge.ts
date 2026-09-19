import type RFB from '@novnc/novnc'

type ClipboardBridgeOptions = {
  screen: HTMLElement
  rfb: Pick<RFB, 'addEventListener' | 'removeEventListener' | 'sendKey'>
  canInteract: () => boolean
  writeRemoteText: (text: string, signal: AbortSignal) => Promise<unknown>
  clipboard: Pick<Clipboard, 'readText' | 'writeText'> | undefined
  onError: (message: string) => void
}

const MODIFIERS: Record<string, number> = {
  ControlLeft: 0xffe3, ControlRight: 0xffe4,
  ShiftLeft: 0xffe1, ShiftRight: 0xffe2,
  AltLeft: 0xffe9, AltRight: 0xffea,
  MetaLeft: 0xffeb, MetaRight: 0xffec,
}

// Capture paste before noVNC forwards the shortcut with stale clipboard data.
export function attachClipboardBridge({
  screen, rfb, canInteract, writeRemoteText, clipboard, onError,
}: ClipboardBridgeOptions) {
  const document = screen.ownerDocument
  const window = document.defaultView
  const isMac = /Mac|iPhone|iPad/.test(window?.navigator.platform ?? '')
  const held = new Set<string>()
  let disposed = false
  let pending: AbortController | null = null
  let activityVersion = 0
  let lastCopied: string | null = null
  let copyQueue = Promise.resolve()
  const isActive = () => !disposed && canInteract() && document.hasFocus()
    && document.visibilityState !== 'hidden' && screen.contains(document.activeElement)

  function cancel() {
    activityVersion++
    pending?.abort()
    pending = null
  }

  function leave() {
    cancel()
    held.clear()
    lastCopied = null
  }

  function modifierKeysym(code: string): number {
    // Match noVNC's macOS modifier mapping.
    if (isMac) {
      if (code === 'MetaLeft') return 0xffe9
      if (code === 'MetaRight') return 0xffeb
      if (code === 'AltLeft') return 0xff7e
      if (code === 'AltRight') return 0xfe03
    }
    return MODIFIERS[code]
  }

  function trackModifiers(event: KeyboardEvent, down: boolean) {
    if (event.code in MODIFIERS) {
      if (down) held.add(event.code)
      else held.delete(event.code)
    }
    for (const [prefix, pressed] of [
      ['Control', event.ctrlKey], ['Shift', event.shiftKey],
      ['Alt', event.altKey], ['Meta', event.metaKey],
    ] as const) {
      if (!pressed) { held.delete(prefix + 'Left'); held.delete(prefix + 'Right') }
      else if (!held.has(prefix + 'Left') && !held.has(prefix + 'Right')) held.add(prefix + 'Left')
    }
  }

  async function paste(readText: () => string | Promise<string>, plainText: boolean) {
    if (pending) return
    const controller = new AbortController()
    pending = controller
    lastCopied = null
    const current = () => pending === controller && !controller.signal.aborted && isActive()
    try {
      const text = await readText()
      if (!text || !current()) return
      await writeRemoteText(text, controller.signal)
      if (!current()) return
      // Temporarily normalize modifiers, then restore keys still physically held.
      for (const code of held) rfb.sendKey(modifierKeysym(code), code, false)
      rfb.sendKey(0xffe3, 'ControlLeft', true)
      if (plainText) rfb.sendKey(0xffe1, 'ShiftLeft', true)
      rfb.sendKey(0x76, 'KeyV')
      if (plainText) rfb.sendKey(0xffe1, 'ShiftLeft', false)
      rfb.sendKey(0xffe3, 'ControlLeft', false)
      for (const code of held) rfb.sendKey(modifierKeysym(code), code, true)
    } catch {
      if (current()) onError('Could not paste — use the Clipboard panel or allow clipboard access')
    } finally {
      if (pending === controller) pending = null
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (!isActive()) return
    trackModifiers(event, true)
    const pasteKey = (event.ctrlKey || event.metaKey) && !event.altKey
      && (event.code === 'KeyV' || event.key.toLowerCase() === 'v')
    if (!pasteKey) {
      if (!(event.code in MODIFIERS)) cancel()
      return
    }
    event.preventDefault()
    event.stopPropagation()
    if (event.repeat) return
    void paste(() => {
      if (!clipboard) throw new Error('Clipboard unavailable')
      return clipboard.readText()
    }, event.shiftKey)
  }

  function onKeyUp(event: KeyboardEvent) { trackModifiers(event, false) }

  function onPaste(event: ClipboardEvent) {
    if (!isActive()) return
    event.preventDefault()
    event.stopPropagation()
    const text = event.clipboardData?.getData('text/plain') ?? ''
    void paste(() => text, false)
  }

  function onRemoteClipboard(event: Event) {
    const text = (event as CustomEvent<{ text?: unknown }>).detail?.text
    if (!isActive() || pending || typeof text !== 'string' || !text) return
    const version = activityVersion
    copyQueue = copyQueue.then(async () => {
      if (version !== activityVersion || !isActive() || text === lastCopied) return
      try {
        if (!clipboard) throw new Error('Clipboard unavailable')
        await clipboard.writeText(text)
        if (version === activityVersion) lastCopied = text
      } catch {
        if (isActive()) onError('Automatic copy blocked — use Copy to my PC in the Clipboard panel')
      }
    })
  }

  function onVisibilityChange() { if (document.visibilityState === 'hidden') leave() }
  screen.addEventListener('keydown', onKeyDown, true)
  screen.addEventListener('keyup', onKeyUp, true)
  screen.addEventListener('paste', onPaste, true)
  screen.addEventListener('pointerdown', cancel, true)
  screen.addEventListener('wheel', cancel, { capture: true, passive: true })
  screen.addEventListener('focusout', leave, true)
  window?.addEventListener('blur', leave)
  document.addEventListener('visibilitychange', onVisibilityChange)
  rfb.addEventListener('clipboard', onRemoteClipboard)
  return {
    cancel: leave,
    dispose() {
      disposed = true
      leave()
      screen.removeEventListener('keydown', onKeyDown, true)
      screen.removeEventListener('keyup', onKeyUp, true)
      screen.removeEventListener('paste', onPaste, true)
      screen.removeEventListener('pointerdown', cancel, true)
      screen.removeEventListener('wheel', cancel, true)
      screen.removeEventListener('focusout', leave, true)
      window?.removeEventListener('blur', leave)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      rfb.removeEventListener('clipboard', onRemoteClipboard)
    },
  }
}
