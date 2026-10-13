import type { BrowserContext } from 'playwright-core'

/** Paint browser pointer events into the desktop stream; CDP does not move the VNC cursor. */
export function renderSessionCursor(): void {
  if (window.top !== window) return
  const install = () => {
    const id = 'igbot-session-cursor'
    if (document.getElementById(id)) return
    const cursor = document.createElement('div')
    cursor.id = id
    cursor.setAttribute('aria-hidden', 'true')
    cursor.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:26px;z-index:2147483647;display:none;pointer-events:none!important;'
    const shadow = cursor.attachShadow({ mode: 'closed' })
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('width', '22')
    svg.setAttribute('height', '26')
    svg.setAttribute('viewBox', '0 0 22 26')
    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    arrow.setAttribute('d', 'M1 1V20L6 15L10 24L14 22L10 14H19Z')
    arrow.setAttribute('fill', 'white')
    arrow.setAttribute('stroke', 'black')
    arrow.setAttribute('stroke-width', '1.5')
    arrow.setAttribute('stroke-linejoin', 'round')
    svg.appendChild(arrow)
    shadow.appendChild(svg)
    document.documentElement.appendChild(cursor)
    const move = (event: MouseEvent) => {
      cursor.style.transform = `translate(${event.clientX - 1}px, ${event.clientY - 1}px)`
      cursor.style.display = 'block'
    }
    document.addEventListener('mousemove', move, { capture: true, passive: true })
    document.addEventListener('mousedown', event => {
      move(event)
      arrow.setAttribute('fill', '#22c55e')
    }, { capture: true, passive: true })
    document.addEventListener('mouseup', event => {
      move(event)
      arrow.setAttribute('fill', 'white')
    }, { capture: true, passive: true })
    const hide = () => { cursor.style.display = 'none'; arrow.setAttribute('fill', 'white') }
    document.addEventListener('mouseout', event => { if (!event.relatedTarget) hide() }, { capture: true, passive: true })
    window.addEventListener('blur', hide)
  }
  if (document.documentElement) install()
  else document.addEventListener('DOMContentLoaded', install, { once: true })
}

export async function installSessionCursor(context: BrowserContext): Promise<void> {
  await context.addInitScript(renderSessionCursor)
  // Persistent contexts may restore an already-loaded Instagram tab.
  await Promise.all(context.pages().map(page => page.evaluate(renderSessionCursor).catch(() => undefined)))
}
