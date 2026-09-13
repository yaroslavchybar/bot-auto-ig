import { useState } from 'react'
import { useQuery } from 'convex/react'
import { Loader2 } from 'lucide-react'
import { api } from '../../../../../convex/_generated/api'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { ScrapeJobForm } from '../types'
import { DEFAULT_JOB_FORM } from '../types'

/* ── Export fields + skip rules ── */

function CheckCard({
  id,
  label,
  checked,
  disabled,
  onChange,
}: {
  id: string
  label: string
  checked: boolean
  disabled: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="bg-field-alt flex items-center space-x-2 rounded-xl px-3 py-2.5">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        disabled={disabled}
        className="brand-checkbox h-4 w-4"
      />
      <Label htmlFor={id} className="text-copy flex-1 cursor-pointer text-xs">
        {label}
      </Label>
    </div>
  )
}

function ExportSection({
  form,
  saving,
  onChange,
}: {
  form: ScrapeJobForm
  saving: boolean
  onChange: (patch: Partial<ScrapeJobForm['fields']>) => void
}) {
  const all = form.fields.fullName && form.fields.isVerified && form.fields.isPrivate
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <Label className="text-muted-copy text-xs font-semibold tracking-wide">EXPORT · {Object.values(form.fields).filter(Boolean).length + 1}/4</Label>
        <button
          type="button"
          disabled={saving}
          onClick={() => onChange(all
            ? { fullName: false, isVerified: false, isPrivate: false }
            : { fullName: true, isVerified: true, isPrivate: true })}
          className="text-subtle-copy text-xs underline underline-offset-2 hover:text-copy disabled:opacity-50"
        >
          {all ? 'Deselect all' : 'Select all'}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <CheckCard id="export-username" label="Username" checked disabled onChange={() => {}} />
        <CheckCard
          id="export-fullname" label="Full Name" checked={form.fields.fullName}
          disabled={saving} onChange={(v) => onChange({ fullName: v })}
        />
        <CheckCard
          id="export-verified" label="Verified Status" checked={form.fields.isVerified}
          disabled={saving} onChange={(v) => onChange({ isVerified: v })}
        />
        <CheckCard
          id="export-private" label="Private Status" checked={form.fields.isPrivate}
          disabled={saving} onChange={(v) => onChange({ isPrivate: v })}
        />
      </div>
    </div>
  )
}

function SkipSection({
  form,
  saving,
  onChange,
}: {
  form: ScrapeJobForm
  saving: boolean
  onChange: (patch: Partial<ScrapeJobForm['skip']>) => void
}) {
  return (
    <div className="grid gap-2">
      <Label className="text-muted-copy text-xs font-semibold tracking-wide">
        SKIP PROFILES · {Object.values(form.skip).filter(Boolean).length}
      </Label>
      <div className="grid grid-cols-2 gap-2">
        <CheckCard
          id="skip-private" label="Private" checked={form.skip.private}
          disabled={saving} onChange={(v) => onChange({ private: v })}
        />
        <CheckCard
          id="skip-verified" label="Verified" checked={form.skip.verified}
          disabled={saving} onChange={(v) => onChange({ verified: v })}
        />
        <CheckCard
          id="skip-noname" label="Without a full name" checked={form.skip.noFullName}
          disabled={saving} onChange={(v) => onChange({ noFullName: v })}
        />
      </div>
    </div>
  )
}

/* ── Lists picker ── */function JobListsPicker({
  selected, disabled, onChange,
}: {
  selected: string[]
  disabled: boolean
  onChange: (ids: string[]) => void
}) {
  const lists = useQuery(api.lists.list, {})

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((v) => v !== id) : [...selected, id])
  }

  return (
    <div className="grid gap-1.5">
      <Label className="text-muted-copy text-xs">Profile Lists</Label>
      <p className="text-subtle-copy text-[10px] leading-tight">
        Logged-in profiles from these lists run the scrape sequentially and share quota progress.
      </p>
      <div className="bg-field-alt mt-1 max-h-32 space-y-0.5 overflow-auto rounded-lg p-2">
        {!lists ? (
          <p className="text-subtle-copy py-2 text-center text-[10px]">Loading lists...</p>
        ) : lists.length === 0 ? (
          <p className="text-subtle-copy py-2 text-center text-[10px]">No lists available</p>
        ) : (
          lists.map((list) => (
            <div
              key={String(list._id)}
              className="hover:bg-panel-hover/70 flex items-center space-x-2 rounded-md px-2 py-1.5"
            >
              <Checkbox
                id={`job-list-${String(list._id)}`}
                checked={selected.includes(String(list._id))}
                onCheckedChange={() => toggle(String(list._id))}
                disabled={disabled}
                className="brand-checkbox h-3.5 w-3.5"
              />
              <Label
                htmlFor={`job-list-${String(list._id)}`}
                className="text-copy flex-1 cursor-pointer text-xs"
              >
                {list.name}
              </Label>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

/* ── Main dialog ── */

export function ScrapeJobDialog({
  open,
  title,
  description,
  initial,
  saving,
  error,
  onClose,
  onSave,
}: {
  open: boolean
  title: string
  description: string
  initial: ScrapeJobForm
  saving: boolean
  error: string | null
  onClose: () => void
  onSave: (form: ScrapeJobForm) => void
}) {
  const [form, setForm] = useState<ScrapeJobForm>(initial)
  const set = <K extends keyof ScrapeJobForm>(key: K, value: ScrapeJobForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  // Reset when a different job is edited.
  const [lastInitial, setLastInitial] = useState(initial)
  if (initial !== lastInitial) {
    setLastInitial(initial)
    setForm(initial)
  }

  const valid =
    form.name.trim().length > 0 &&
    form.targets.split(/\s+/).map((v) => v.trim()).filter(Boolean).length > 0

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <DialogContent className="bg-panel border-line text-ink max-h-[90vh] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="page-title-gradient">{title}</DialogTitle>
          <DialogDescription className="text-subtle-copy text-xs">{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="job-name" className="text-muted-copy text-xs">Job Name</Label>
            <Input
              id="job-name"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Viral post likers"
              disabled={saving}
              className="brand-focus bg-field border-line h-9 text-ink"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="job-targets" className="text-muted-copy text-xs">Post Links</Label>
            <Textarea
              id="job-targets"
              value={form.targets}
              onChange={(e) => set('targets', e.target.value)}
              placeholder={'https://www.instagram.com/p/DLyr8pYNK9e/\nDLyr8pYNK9e'}
              disabled={saving}
              rows={4}
              className="brand-focus bg-field border-line font-mono text-xs text-ink"
            />
            <p className="text-subtle-copy text-[10px] leading-tight">One post link, shortcode, or media id per line.</p>
          </div>
          <JobListsPicker selected={form.listIds} disabled={saving} onChange={(ids) => set('listIds', ids)} />
          <ExportSection form={form} saving={saving} onChange={(patch) => set('fields', { ...form.fields, ...patch })} />
          <SkipSection form={form} saving={saving} onChange={(patch) => set('skip', { ...form.skip, ...patch })} />
          <div className="grid gap-1.5">
            <Label htmlFor="job-max" className="text-muted-copy text-xs">Max Per Post</Label>
            <Input
              id="job-max"
              type="number"
              value={Number.isFinite(form.maxToScrape) ? form.maxToScrape : ''}
              min={0}
              disabled={saving}
              onChange={(e) => set('maxToScrape', Number(e.target.value))}
              className="brand-focus bg-field border-line h-9 text-ink"
            />
            <p className="text-subtle-copy text-[10px] leading-tight">0 = unlimited.</p>
          </div>
          {error && (
            <div className="text-status-danger bg-status-danger-soft border-status-danger-border rounded-md border p-2 text-xs font-medium">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button
              size="sm"
              className="brand-button font-medium"
              disabled={saving || !valid}
              onClick={() => onSave({ ...form, name: form.name.trim() })}
            >
              {saving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              Save Job
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export { DEFAULT_JOB_FORM }
