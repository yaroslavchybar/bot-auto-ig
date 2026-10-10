import { useState } from 'react'
import type { Dispatch, KeyboardEvent, ReactNode, SetStateAction } from 'react'
import { useMutation } from 'convex/react'
import { Upload } from 'lucide-react'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { List } from '../types'

// Mirrors the rules in convex/lists.ts so bad entries are flagged before saving.
const USERNAME_PATTERN = /^[a-z0-9._]{1,30}$/
const FULL_NAME_PATTERN = /^[\p{L}\p{M}\p{Extended_Pictographic}\p{Emoji_Component} .'-]{3,80}$/u

type ParsedList = { items: string[]; duplicates: number }

// Splits pasted usernames on spaces, commas, or new lines, then strips "@", lowercases, and dedupes.
function parseUsernames(text: string): ParsedList {
  const all = text
    .split(/[\s,]+/)
    .map((name) => name.trim().replace(/^@/, '').toLowerCase())
    .filter(Boolean)
  const items = [...new Set(all)]
  return { items, duplicates: all.length - items.length }
}

// Reads one full name per line, dropping blank lines and duplicates.
function parseFullNames(text: string): ParsedList {
  const all = text
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean)
  const items = [...new Set(all)]
  return { items, duplicates: all.length - items.length }
}

// Edits a model's name, usernames, and full names. All fields save together.
export function ModelIdentityPanel({ model }: { model: List }) {
  const update = useMutation(api.lists.update)
  const [name, setName] = useState(model.name)
  const [fullName, setFullName] = useState(model.fullName ?? '')
  const [fullNames, setFullNames] = useState((model.fullNames ?? []).join('\n'))
  const [usernames, setUsernames] = useState((model.usernames ?? []).join('\n'))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const trimmedName = name.trim()
  const usernameList = parseUsernames(usernames)
  const fullNameList = parseFullNames(fullNames)
  const invalidUsernames = usernameList.items.filter((n) => !USERNAME_PATTERN.test(n))
  const invalidFullNames = fullNameList.items.filter((n) => !FULL_NAME_PATTERN.test(n))
  const hasInvalid = invalidUsernames.length > 0 || invalidFullNames.length > 0
  const changed =
    trimmedName !== model.name ||
    fullName.trim() !== (model.fullName ?? '') ||
    JSON.stringify(fullNameList.items) !== JSON.stringify(model.fullNames ?? []) ||
    JSON.stringify(usernameList.items) !== JSON.stringify(model.usernames ?? [])
  const canSave = changed && trimmedName !== '' && !hasInvalid && !saving

  // Saves every field, then rewrites the text areas in their cleaned form.
  async function save() {
    if (!canSave) return
    setSaving(true)
    setError('')
    try {
      await update({
        id: model.id as Id<'lists'>,
        name: trimmedName,
        fullName: fullName.trim(),
        fullNames: fullNameList.items,
        usernames: usernameList.items,
      })
      setUsernames(usernameList.items.join('\n'))
      setFullNames(fullNameList.items.join('\n'))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  // Restores every field to the saved model values.
  function discard() {
    setName(model.name)
    setFullName(model.fullName ?? '')
    setFullNames((model.fullNames ?? []).join('\n'))
    setUsernames((model.usernames ?? []).join('\n'))
    setError('')
  }

  // Appends the contents of a .txt file to one of the text fields.
  async function importFile(file: File, setValue: Dispatch<SetStateAction<string>>) {
    try {
      const text = await file.text()
      setValue((current) => [current.trim(), text.trim()].filter(Boolean).join('\n'))
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read TXT file')
    }
  }

  // Cmd/Ctrl+S saves from anywhere in the panel.
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      void save()
    }
  }

  return (
    <div
      onKeyDown={handleKeyDown}
      className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-5 sm:p-6"
    >
      <div className="grid gap-1.5">
        <Label htmlFor="model-detail-name" className="font-medium text-ink">
          Model name
        </Label>
        <Input
          id="model-detail-name"
          value={name}
          disabled={saving}
          onChange={(event) => setName(event.target.value)}
          placeholder="Model name"
          aria-invalid={trimmedName === ''}
          className="h-9 brand-focus border-line bg-field text-ink"
        />
        {trimmedName === '' && (
          <p className="text-xs text-status-danger">Model name is required.</p>
        )}
      </div>

      <div className="grid gap-4 md:flex-1 md:grid-cols-2">
        <EditorSection
          title="Usernames"
          meta={
            <>
              <CountPill>{usernameList.items.length} usernames</CountPill>
              {usernameList.duplicates > 0 && (
                <CountPill tone="warning">{usernameList.duplicates} duplicates</CountPill>
              )}
            </>
          }
          footer={
            <>
              <p className="min-w-0 text-xs text-subtle-copy">
                The first 10 are used as examples when more usernames are generated.
              </p>
              <ImportButton
                disabled={saving}
                onFile={(file) => void importFile(file, setUsernames)}
              />
            </>
          }
        >
          <Textarea
            aria-label="Usernames"
            value={usernames}
            disabled={saving}
            onChange={(event) => setUsernames(event.target.value)}
            placeholder="One username per line"
            className="min-h-32 flex-1 resize-none brand-focus border-line bg-field font-mono text-sm text-ink"
          />
          <InvalidEntries items={invalidUsernames} />
        </EditorSection>

        <EditorSection
          title="Full names"
          meta={
            <>
              <CountPill>{fullNameList.items.length} variations</CountPill>
              {fullNameList.duplicates > 0 && (
                <CountPill tone="warning">{fullNameList.duplicates} duplicates</CountPill>
              )}
            </>
          }
          footer={
            <>
              <p className="min-w-0 text-xs text-subtle-copy">
                Each name is used by four accounts in order. More are generated from the base name.
              </p>
              <ImportButton
                disabled={saving}
                onFile={(file) => void importFile(file, setFullNames)}
              />
            </>
          }
        >
          <div className="grid gap-1.5">
            <Label htmlFor="model-detail-base-name" className="text-xs text-subtle-copy">
              Base full name
            </Label>
            <Input
              id="model-detail-base-name"
              value={fullName}
              disabled={saving}
              onChange={(event) => setFullName(event.target.value)}
              placeholder="e.g. Anna Smith"
              className="h-9 brand-focus border-line bg-field text-ink"
            />
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-1.5">
            <Label htmlFor="model-detail-full-names" className="text-xs text-subtle-copy">
              Variations
            </Label>
            <Textarea
              id="model-detail-full-names"
              value={fullNames}
              disabled={saving}
              onChange={(event) => setFullNames(event.target.value)}
              placeholder="Optional variations, one full name per line"
              className="min-h-32 flex-1 resize-none brand-focus border-line bg-field text-sm text-ink"
            />
            <InvalidEntries items={invalidFullNames} />
          </div>
        </EditorSection>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line-soft pt-4">
        <div className="min-w-0 text-sm">
          {error ? (
            <p role="alert" className="break-words text-status-danger">
              {error}
            </p>
          ) : changed ? (
            <p className="flex items-center gap-2 text-subtle-copy">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-status-warning" />
              {hasInvalid ? 'Fix invalid entries to save' : 'Unsaved changes'}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" onClick={discard} disabled={!changed || saving}>
            Discard
          </Button>
          <Button
            onClick={() => void save()}
            disabled={!canSave}
            className="brand-button font-medium"
          >
            {saving ? 'Saving...' : 'Save model'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// Bordered card for one editor column: title and counts in the header, hint and import in the footer.
function EditorSection({
  title,
  meta,
  footer,
  children,
}: {
  title: string
  meta: ReactNode
  footer: ReactNode
  children: ReactNode
}) {
  return (
    <section className="flex min-h-72 flex-col overflow-hidden rounded-xl border border-line-soft bg-panel">
      <header className="flex items-center justify-between gap-3 border-b border-line-soft px-4 py-3">
        <h4 className="text-sm font-semibold text-ink">{title}</h4>
        <div className="flex items-center gap-1.5">{meta}</div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">{children}</div>
      <footer className="flex items-center justify-between gap-3 border-t border-line-soft px-4 py-3">
        {footer}
      </footer>
    </section>
  )
}

// Small count label for a section header. The warning tone flags duplicates that were removed.
function CountPill({
  children,
  tone = 'muted',
}: {
  children: ReactNode
  tone?: 'muted' | 'warning'
}) {
  return (
    <span
      className={cn(
        'rounded-md px-1.5 py-0.5 text-xs tabular-nums',
        tone === 'warning'
          ? 'bg-status-warning-soft text-status-warning'
          : 'bg-panel-muted text-subtle-copy',
      )}
    >
      {children}
    </span>
  )
}

// Lists entries the server would reject, so they can be fixed before saving.
function InvalidEntries({ items }: { items: string[] }) {
  if (items.length === 0) return null
  const shown = items.slice(0, 5).join(', ')
  const more = items.length > 5 ? ` and ${items.length - 5} more` : ''
  return (
    <p className="text-xs break-words text-status-danger">
      Invalid: {shown}
      {more}
    </p>
  )
}

// Button that loads a .txt file into the field it sits next to.
function ImportButton({ disabled, onFile }: { disabled: boolean; onFile: (file: File) => void }) {
  return (
    <Button
      variant="outline"
      asChild
      className={cn('button-panel shrink-0', disabled && 'pointer-events-none opacity-50')}
    >
      <label className="cursor-pointer">
        <Upload /> Import .txt
        <input
          type="file"
          accept=".txt,text/plain"
          className="sr-only"
          disabled={disabled}
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) onFile(file)
          }}
        />
      </label>
    </Button>
  )
}
