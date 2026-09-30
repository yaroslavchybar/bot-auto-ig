import { act } from 'react'
import { EditorView } from '@codemirror/view'
import { afterEach, expect, test, vi } from 'vite-plus/test'
import { TypeScriptCodeField } from '@/features/automations/activity-ui/TypeScriptCodeField'
import { mount } from './mount'

let view: ReturnType<typeof mount> | undefined
afterEach(async () => {
  await view?.unmount()
  view = undefined
})

test('editor keeps its instance, reads the latest callback, and does not echo controlled updates', async () => {
  const first = vi.fn()
  const latest = vi.fn()
  const input = { name: 'script', label: 'Script', type: 'code' as const }
  view = mount()
  await view.render(<TypeScriptCodeField input={input} value="first" onChange={first} />)
  const element = view.container.querySelector<HTMLElement>('.cm-editor')!
  const editor = EditorView.findFromDOM(element)!
  const destroy = vi.spyOn(editor, 'destroy')
  expect(editor.state.doc.toString()).toBe('first')
  await view.render(<TypeScriptCodeField input={input} value="external" onChange={latest} />)
  expect(EditorView.findFromDOM(element)).toBe(editor)
  expect(editor.state.doc.toString()).toBe('external')
  expect(first).not.toHaveBeenCalled()
  expect(latest).not.toHaveBeenCalled()
  await act(async () =>
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: 'typed' } }),
  )
  expect(latest).toHaveBeenCalledWith('typed')
  expect(first).not.toHaveBeenCalled()
  await view.unmount()
  view = undefined
  expect(destroy).toHaveBeenCalledOnce()
})
