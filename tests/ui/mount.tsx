import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

export function mount() {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  return {
    container,
    async render(node: ReactNode) {
      await act(async () => {
        root.render(node)
      })
    },
    async unmount() {
      await act(async () => {
        root.unmount()
      })
      container.remove()
    },
  }
}
