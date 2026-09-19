import type RFB from '@novnc/novnc'

type ClipboardBridgeOptions = {
  screen: HTMLElement
  rfb: Pick<RFB, 'addEventListener' | 'removeEventListener' | 'sendKey'>
  canInteract: () => boolean
  writeRemoteText: (text: string) => Promise<unknown>
  clipboard: Pick<Clipboard, 'readText' | 'writeText'> | undefined
  onError: (message: string) => void
}

// Capture paste before noVNC forwards the shortcut with stale clipboard data.
export function attachClipboardBridge({
  screen, rfb, canInteract, writeRemoteText, clipboard, onError,
}: ClipboardBridgeOptions): () => void {
  let disposed = false
  let pasting = false
  const isActive = () => !disposed && canInteract()
    && screen.ownerDocument.hasFocus()
    && screen.contains(screen.ownerDocument.activeElement)

  async function paste(readText: () => string | Promise<string>, plainText: boolean) {
    if (pasting) return
    pasting = true
    try {
      const text = await readText()
      if (!text || !isActive()) return
      // The API acknowledges X clipboard ownership and checks agent control.
      await writeRemoteText(text)
      if (!isActive()) return
      // Release held modifiers before synthesizing the Linux paste shortcut.
      for (const [keysym, code] of [
        [0xffe3, 'ControlLeft'], [0xffe4, 'ControlRight'],
        [0xffe1, 'ShiftLeft'], [0xffe2, 'ShiftRight'],
        [0xffe9, 'AltLeft'], [0xffea, 'AltRight'],
        [0xffeb, 'MetaLeft'], [0xffec, 'MetaRight'],
      ] as const) rfb.sendKey(keysym, code, false)
      rfb.sendKey(0xffe3, 'ControlLeft', true)
      if (plainText) rfb.sendKey(0xffe1, 'ShiftLeft', true)
      rfb.sendKey(0x76, 'KeyV')
      if (plainText) rfb.sendKey(0xffe1, 'ShiftLeft', false)
      rfb.sendKey(0xffe3, 'ControlLeft', false)
    } catch {
      if (!disposed) onError('Could not paste — use the Clipboard panel or allow clipboard access')
    } finally {
      pasting = false
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    const pasteKey = (event.ctrlKey || event.metaKey) && !event.altKey
      && (event.code === 'KeyV' || event.key.toLowerCase() === 'v')
    if (!pasteKey || !isActive()) return
    event.preventDefault()
    event.stopPropagation()
    if (event.repeat) return
    void paste(() => {
      if (!clipboard) throw new Error('Clipboard unavailable')
      // Called during the key gesture, as required by the browser.
      return clipboard.readText()
    }, event.shiftKey)
  }

  function onPaste(event: ClipboardEvent) {
    if (!isActive()) return
    event.preventDefault()
    event.stopPropagation()
    const text = event.clipboardData?.getData('text/plain') ?? ''
    void paste(() => text, false)
  }

  function onRemoteClipboard(event: Event) {
    const text = (event as CustomEvent<{ text?: unknown }>).detail?.text
    if (!isActive() || pasting || typeof text !== 'string' || !text) return
    if (!clipboard) {
      onError('Automatic copy blocked — use Copy to my PC in the Clipboard panel')
      return
    }
    void clipboard.writeText(text).catch(() => {
      if (isActive()) onError('Automatic copy blocked — use Copy to my PC in the Clipboard panel')
    })
  }

  screen.addEventListener('keydown', onKeyDown, true)
  screen.addEventListener('paste', onPaste, true)
  rfb.addEventListener('clipboard', onRemoteClipboard)
  return () => {
    disposed = true
    screen.removeEventListener('keydown', onKeyDown, true)
    screen.removeEventListener('paste', onPaste, true)
    rfb.removeEventListener('clipboard', onRemoteClipboard)
  }
}
