import { useState, type FormEvent } from 'react'
import { Tags, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { errorText } from '../utils/chat'

type ChatTagsProps = {
  tags: string[]
  availableTags: string[]
  loading: boolean
  onChange: (tag: string, enabled: boolean) => Promise<void>
}

export function ChatTags({ tags, availableTags, loading, onChange }: ChatTagsProps) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function change(tag: string, enabled: boolean) {
    if (saving) return false
    setSaving(true)
    setError('')
    try {
      await onChange(tag, enabled)
      return true
    } catch (error) {
      setError(errorText(error))
      return false
    } finally {
      setSaving(false)
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault()
    if (name.trim() && (await change(name, true))) setName('')
  }

  return (
    <div className="border-b border-line-soft px-3 py-2 md:px-4">
      <div className="flex max-h-24 flex-wrap items-center gap-1.5 overflow-y-auto">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-7" disabled={loading || saving}>
              <Tags className="size-3.5" /> Tags
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" aria-label="Edit chat tags" className="space-y-3">
            <p className="text-sm font-medium">Chat tags</p>
            <form onSubmit={add} className="flex gap-2">
              <Input
                aria-label="New tag"
                placeholder="New tag..."
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={40}
                disabled={saving || tags.length >= 10}
                className="h-8 min-w-0"
              />
              <Button
                type="submit"
                size="sm"
                disabled={saving || !name.trim() || tags.length >= 10}
              >
                Add
              </Button>
            </form>
            {availableTags.length > 0 && (
              <div className="max-h-48 space-y-1 overflow-y-auto" aria-label="Existing tags">
                {availableTags.map((tag) => (
                  <label
                    key={tag}
                    className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={tags.includes(tag)}
                      disabled={saving || (!tags.includes(tag) && tags.length >= 10)}
                      onChange={(event) => void change(tag, event.target.checked)}
                    />
                    <span className="min-w-0 break-words">{tag}</span>
                  </label>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-copy">
              Up to 10 tags per chat. Tags are shared across your devices.
            </p>
          </PopoverContent>
        </Popover>
        {tags.map((tag) => (
          <span
            key={tag}
            className="flex max-w-full items-center gap-1 rounded-full bg-panel-subtle px-2 py-0.5 text-xs"
          >
            <span className="truncate">{tag}</span>
            <button
              type="button"
              aria-label={`Remove tag ${tag}`}
              disabled={saving || loading}
              onClick={() => void change(tag, false)}
              className="rounded-full p-0.5 hover:bg-panel-muted disabled:opacity-50"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-1 text-xs text-status-danger">
          {error}
        </p>
      )}
    </div>
  )
}
