import { useState } from 'react'
import { useMutation } from 'convex/react'
import { Upload } from 'lucide-react'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { List } from '../types'

function parseUsernames(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).map(name => name.trim().replace(/^@/, '').toLowerCase()).filter(Boolean))]
}

function parseFullNames(text: string): string[] {
  return [...new Set(text.split(/\r?\n/).map(name => name.trim()).filter(Boolean))]
}

export function ModelIdentityPanel({ model }: { model: List }) {
  const update = useMutation(api.lists.update)
  const [name, setName] = useState(model.name)
  const [fullName, setFullName] = useState(model.fullName ?? '')
  const [fullNames, setFullNames] = useState((model.fullNames ?? []).join('\n'))
  const [usernames, setUsernames] = useState((model.usernames ?? []).join('\n'))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const parsedFullNames = parseFullNames(fullNames)
  const parsedUsernames = parseUsernames(usernames)
  const changed = name.trim() !== model.name || fullName.trim() !== (model.fullName ?? '') ||
    JSON.stringify(parsedFullNames) !== JSON.stringify(model.fullNames ?? []) ||
    JSON.stringify(parsedUsernames) !== JSON.stringify(model.usernames ?? [])

  async function save() {
    if (!changed || !name.trim() || saving) return
    setSaving(true)
    setError('')
    try {
      await update({ id: model.id as Id<'lists'>, name: name.trim(),
        fullName: fullName.trim(), fullNames: parsedFullNames, usernames: parsedUsernames })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function importFile(file: File, target: 'usernames' | 'fullNames') {
    try {
      const text = await file.text()
      const append = (current: string) => [current.trim(), text.trim()].filter(Boolean).join('\n')
      if (target === 'usernames') setUsernames(append)
      else setFullNames(append)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read TXT file')
    }
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto p-5 sm:p-6">
      <div className="mb-5 grid gap-2">
        <Label htmlFor="model-detail-name" className="text-ink font-medium">Model name</Label>
        <Input id="model-detail-name" value={name} disabled={saving}
          onChange={(event) => setName(event.target.value)} placeholder="Model name"
          className="brand-focus bg-field border-line h-9 text-ink" />
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="model-detail-usernames" className="text-ink font-medium">Usernames</Label>
            <span className="text-subtle-copy text-xs tabular-nums">{parsedUsernames.length} saved</span>
          </div>
          <Textarea id="model-detail-usernames" value={usernames} disabled={saving}
            onChange={(e) => setUsernames(e.target.value)}
            placeholder="One username per line" className="brand-focus bg-field border-line min-h-48 font-mono text-sm text-ink" />
          <p className="text-subtle-copy text-xs">The first 10 are used as examples when more usernames are generated.</p>
          <Button variant="outline" size="sm" className="button-panel h-8" disabled={saving} asChild>
            <label className="cursor-pointer">
              <Upload className="h-3.5 w-3.5" /> Import usernames TXT
              <input type="file" accept=".txt,text/plain" className="sr-only" disabled={saving}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) void importFile(file, 'usernames')
                }} />
            </label>
          </Button>
        </section>

        <section className="space-y-3">
          <Label htmlFor="model-detail-base-name" className="text-ink font-medium">Full names</Label>
          <Input id="model-detail-base-name" value={fullName} disabled={saving}
            onChange={(e) => setFullName(e.target.value)} placeholder="Base full name"
            className="brand-focus bg-field border-line h-9 text-ink" />
          <Textarea id="model-detail-full-names" value={fullNames} disabled={saving}
            onChange={(e) => setFullNames(e.target.value)}
            placeholder="Optional variations, one full name per line"
            aria-label="Full name variations"
            className="brand-focus bg-field border-line min-h-48 text-sm text-ink" />
          <p className="text-subtle-copy text-xs">Each name is used by four accounts in order. More are generated from the base name.</p>
          <div className="flex items-center justify-between gap-2">
            <Button variant="outline" size="sm" className="button-panel h-8" disabled={saving} asChild>
              <label className="cursor-pointer">
                <Upload className="h-3.5 w-3.5" /> Import full names TXT
                <input type="file" accept=".txt,text/plain" className="sr-only" disabled={saving}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (file) void importFile(file, 'fullNames')
                  }} />
              </label>
            </Button>
            <span className="text-subtle-copy text-xs tabular-nums">{parsedFullNames.length} variations</span>
          </div>
        </section>
      </div>
      <div className="border-line-soft mt-6 flex items-center justify-between gap-3 border-t pt-4">
        <p role="alert" className="text-status-danger min-w-0 break-words text-sm">{error}</p>
        <Button onClick={() => void save()} disabled={!changed || !name.trim() || saving} className="brand-button ml-auto shrink-0">
          {saving ? 'Saving...' : 'Save model'}
        </Button>
      </div>
    </div>
  )
}
