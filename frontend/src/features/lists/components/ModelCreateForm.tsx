import { useState } from 'react'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

function parseUsernames(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,]+/)
        .map((name) => name.trim().replace(/^@/, '').toLowerCase())
        .filter(Boolean),
    ),
  ]
}

export function ModelCreateForm({
  saving,
  onSave,
  onCancel,
}: {
  saving: boolean
  onSave: (values: { name: string; fullName: string; usernames: string[] }) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [fullName, setFullName] = useState('')
  const [usernames, setUsernames] = useState('')
  const [error, setError] = useState('')
  const trimmed = name.trim()
  const parsed = parseUsernames(usernames)
  const save = () => {
    if (trimmed && !saving) onSave({ name: trimmed, fullName: fullName.trim(), usernames: parsed })
  }

  return (
    <div className="flex flex-col gap-5 p-6">
      <div className="grid gap-1.5">
        <Label
          htmlFor="model-name"
          className="text-xs font-semibold tracking-wider text-muted-copy uppercase"
        >
          Model name
        </Label>
        <Input
          id="model-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={saving}
          placeholder="e.g. Fitness EU"
          autoFocus
          onKeyDown={(event) => {
            if (event.key === 'Enter') save()
          }}
          className="h-10 brand-focus border-line bg-field font-medium text-ink"
        />
      </div>
      <div className="grid gap-1.5">
        <Label
          htmlFor="model-full-name"
          className="text-xs font-semibold tracking-wider text-muted-copy uppercase"
        >
          Base full name
        </Label>
        <Input
          id="model-full-name"
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          disabled={saving}
          placeholder="e.g. Anna Kowalska"
          className="h-10 brand-focus border-line bg-field text-ink"
        />
      </div>
      <div className="space-y-3 rounded-md border border-line-soft bg-panel-subtle p-4">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="model-usernames" className="text-sm font-medium text-copy">
            Username pool
          </Label>
          <span className="text-xs text-subtle-copy tabular-nums">{parsed.length} parsed</span>
        </div>
        <Textarea
          id="model-usernames"
          value={usernames}
          onChange={(event) => setUsernames(event.target.value)}
          disabled={saving}
          placeholder="Usernames, one per line. The first names are used as entered."
          className="min-h-28 brand-focus border-line bg-field font-mono text-xs text-ink"
        />
        <Button
          type="button"
          variant="outline"
          disabled={saving}
          className="button-panel font-medium"
          asChild
        >
          <label className="cursor-pointer">
            <Upload className="h-3.5 w-3.5" /> Import usernames from TXT
            <input
              type="file"
              accept=".txt,text/plain"
              className="sr-only"
              disabled={saving}
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file)
                  void file
                    .text()
                    .then(setUsernames)
                    .catch(() => setError('Could not read TXT file'))
              }}
            />
          </label>
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-status-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-3">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={save} disabled={saving || !trimmed} className="brand-button font-medium">
          {saving ? 'Creating...' : 'Create'}
        </Button>
      </div>
    </div>
  )
}
