declare module '@novnc/novnc/lib/rfb.js' {
  export default class RFB extends EventTarget {
    constructor(target: Element, url: string, options?: {
      shared?: boolean
      repeaterID?: string
      credentials?: {
        username?: string
        password?: string
        target?: string
      }
    })

    background: string
    focusOnClick: boolean
    resizeSession: boolean
    scaleViewport: boolean
    viewOnly: boolean

    blur(): void
    disconnect(): void
    focus(): void
    sendCtrlAltDel(): void
    sendCredentials(credentials: {
      username?: string
      password?: string
      target?: string
    }): void
  }
}
