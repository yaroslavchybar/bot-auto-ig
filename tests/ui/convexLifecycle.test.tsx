import { StrictMode } from 'react'
import { afterEach, expect, test, vi } from 'vite-plus/test'
import { ConvexClientProvider } from '@/components/layout/ConvexClientProvider'
import { mount } from './mount'

const clients = vi.hoisted(() => [] as Array<{ close: ReturnType<typeof vi.fn> }>)
vi.mock('@/lib/env', () => ({ env: { convexUrl: 'https://convex.example.invalid' } }))
vi.mock('convex/react', () => ({
  ConvexReactClient: class {
    close = vi.fn(async () => {})
    constructor() {
      clients.push(this)
    }
  },
  ConvexProvider: ({ children }: { children: React.ReactNode }) => children,
}))
let view: ReturnType<typeof mount> | undefined
afterEach(async () => {
  await view?.unmount()
  view = undefined
  clients.length = 0
})

test('database clients are shared and every client closes when the protected UI unmounts', async () => {
  view = mount()
  await view.render(
    <StrictMode>
      <ConvexClientProvider>
        <p>One</p>
      </ConvexClientProvider>
      <ConvexClientProvider>
        <p>Two</p>
      </ConvexClientProvider>
    </StrictMode>,
  )
  expect(view.container.textContent).toBe('OneTwo')
  expect(clients.filter((client) => client.close.mock.calls.length === 0)).toHaveLength(1)
  await view.unmount()
  view = undefined
  expect(clients.every((client) => client.close.mock.calls.length === 1)).toBe(true)
  const previousCount = clients.length
  view = mount()
  await view.render(
    <ConvexClientProvider>
      <p>New session</p>
    </ConvexClientProvider>,
  )
  expect(clients).toHaveLength(previousCount + 1)
  expect(view.container.textContent).toBe('New session')
})
