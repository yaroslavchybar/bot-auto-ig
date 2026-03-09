import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DialogClose, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { RefreshCw, Search, Users, X } from 'lucide-react'
import { fetchProfilesForEdit } from '../api'
import type { List, ProfileRow } from '../types'

interface ListsFormProps {
  mode: 'create' | 'edit'
  initialData?: List
  saving: boolean
  error?: string | null
  onSave: (name: string, addedIds: string[], removedIds: string[]) => void
  onCancel: () => void
  className?: string
}

export function ListsForm({
  mode,
  initialData,
  saving,
  error: externalError,
  onSave,
  onCancel,
  className,
}: ListsFormProps) {
  const [name, setName] = useState(initialData?.name || '')
  const [profiles, setProfiles] = useState<ProfileRow[]>([])
  const [loadingProfiles, setLoadingProfiles] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    setName(initialData?.name || '')
    setLocalError(null)
    setSearchQuery('')
  }, [initialData?.id, initialData?.name, mode])

  useEffect(() => {
    if (mode === 'edit' && initialData) {
      setLoadingProfiles(true)
      fetchProfilesForEdit(initialData.id)
        .then(setProfiles)
        .catch((e) => setLocalError(e instanceof Error ? e.message : String(e)))
        .finally(() => setLoadingProfiles(false))
    } else {
      setProfiles([])
    }
  }, [mode, initialData])

  const handleToggle = (profileId: string) => {
    if (saving) return

    setProfiles((prev) => {
      return prev.map((profile) =>
        profile.profile_id === profileId
          ? { ...profile, selected: !profile.selected }
          : profile,
      )
    })
  }

  const handleSubmit = () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setLocalError('Name is required')
      return
    }

    const addedIds = profiles
      .filter((p) => p.selected && !p.initialSelected)
      .map((p) => p.profile_id)
    const removedIds = profiles
      .filter((p) => !p.selected && p.initialSelected)
      .map((p) => p.profile_id)

    setLocalError(null)
    onSave(trimmed, addedIds, removedIds)
  }

  const error = externalError || localError

  const filteredProfiles = useMemo(
    () =>
      profiles.filter((p) => {
        const query = searchQuery.trim().toLowerCase()
        if (!query) return true
        return (
          p.name.toLowerCase().includes(query) ||
          p.profile_id.toLowerCase().includes(query)
        )
      }),
    [profiles, searchQuery],
  )

  const selectedProfiles = useMemo(
    () => profiles.filter((p) => p.selected),
    [profiles],
  )
  const changedCount = useMemo(
    () => profiles.filter((p) => p.selected !== p.initialSelected).length,
    [profiles],
  )

  const setFilteredSelection = (nextSelected: boolean) => {
    if (saving || loadingProfiles) return
    const query = searchQuery.trim().toLowerCase()

    setProfiles((prev) =>
      prev.map((p) => {
        const matches =
          !query ||
          p.name.toLowerCase().includes(query) ||
          p.profile_id.toLowerCase().includes(query)
        return matches ? { ...p, selected: nextSelected } : p
      }),
    )
  }

  const filteredSelectionState: boolean | 'indeterminate' = useMemo(() => {
    if (filteredProfiles.length === 0) return false

    const checkedCount = filteredProfiles.filter(
      (profile) => profile.selected,
    ).length
    if (checkedCount === 0) return false
    if (checkedCount === filteredProfiles.length) return true
    return 'indeterminate'
  }, [filteredProfiles])

  const saveDisabled = saving || (mode === 'edit' && loadingProfiles)
  const footerButtonLabel = saving
    ? 'Saving...'
    : mode === 'create'
      ? 'Create List'
      : 'Save Changes'

  if (mode === 'create') {
    return (
      <div className={cn('flex flex-col p-6', className)}>
        <div className="grid gap-5 pb-6">
          <div className="grid gap-1.5">
            <Label
              htmlFor="name"
              className="text-muted-copy text-xs font-semibold tracking-wider uppercase"
            >
              List Name
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
              placeholder="Enter list name..."
              autoFocus
              className="brand-focus bg-field border-line h-10 font-medium text-ink"
            />
          </div>
        </div>

        <div className="border-line shrink-0 border-t pt-4">
          {error && (
            <div className="text-status-danger bg-status-danger-soft border-status-danger-border mb-4 rounded-md border p-3 text-sm font-medium">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <Button
              variant="ghost"
              onClick={onCancel}
              disabled={saving}
              className="border-line text-copy hover:bg-panel-hover border bg-transparent shadow-none transition-all hover:text-ink"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={saveDisabled}
              className="brand-button font-medium"
            >
              {footerButtonLabel}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={cn('flex h-[min(82vh,720px)] flex-col', className)}>
      <div className="border-line-soft flex items-center justify-between gap-4 border-b px-6 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-6">
          <DialogTitle className="text-inverse shrink-0 text-xl font-semibold tracking-tight">
            Edit List
          </DialogTitle>
          
          <div className="flex min-w-0 flex-1 items-center gap-3 sm:max-w-md">
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
              placeholder="List name..."
              autoFocus
              className="brand-focus border-line bg-panel-subtle text-ink h-9 w-full rounded-lg border px-3 text-sm font-medium"
            />
            {changedCount > 0 && (
              <span className="brand-surface brand-text-soft shrink-0 rounded-full border px-2.5 py-0.5 font-mono text-[10px] tracking-[0.14em] uppercase">
                {changedCount} pending change{changedCount === 1 ? '' : 's'}
              </span>
            )}
          </div>
        </div>

        <DialogClose asChild>
          <button
            type="button"
            aria-label="Close modal"
            className="border-line bg-panel-subtle text-subtle-copy hover:border-line-strong inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </DialogClose>
      </div>

      <div className="flex-1 overflow-hidden px-6 pt-4 pb-4">
        <div className="flex h-full flex-col gap-4">
          <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
            <section className="flex min-h-0 flex-col">


              <div className="mb-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[rgb(163,163,177)]" />
                  <Input
                    placeholder="Search profiles..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="border-transparent bg-[rgb(51,51,62)] text-[rgb(246,246,247)] placeholder:text-[rgb(147,148,161)] brand-focus h-8 rounded-md pl-9 text-sm font-normal leading-5 shadow-[inset_0_0_0_1px_rgba(61,61,74,0.88),0_2px_2px_-1px_rgba(0,0,0,0.16),0_4px_4px_-2px_rgba(0,0,0,0.24)] focus-visible:border-transparent focus-visible:ring-0 focus-visible:shadow-[inset_0_0_0_1px_rgba(130,130,148,0.92),0_2px_2px_-1px_rgba(0,0,0,0.16),0_4px_4px_-2px_rgba(0,0,0,0.24)]"
                    disabled={loadingProfiles || saving}
                  />
                </div>
              </div>

              <div className="border-line bg-panel-soft flex items-center rounded-t-[18px] border border-b-0 px-3.5 py-2.5">
                <label className="flex cursor-pointer items-center gap-2.5 text-xs font-medium text-ink hover:text-ink/80 transition-colors">
                  <Checkbox
                    checked={filteredSelectionState}
                    onCheckedChange={(checked) =>
                      setFilteredSelection(checked === true)
                    }
                    disabled={
                      loadingProfiles || saving || filteredProfiles.length === 0
                    }
                    className="brand-checkbox border-line-strong bg-field-alt h-4.5 w-4.5"
                  />
                  <span>
                    {filteredSelectionState === true ? 'Deselect All' : 'Select All'}
                  </span>
                </label>
              </div>

              <div className="border-line bg-panel-subtle min-h-0 flex-1 overflow-hidden rounded-b-[18px] border">
                {loadingProfiles ? (
                  <div className="text-subtle-copy flex h-full items-center justify-center text-xs">
                    <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
                    Loading profiles...
                  </div>
                ) : profiles.length === 0 ? (
                  <div className="text-subtle-copy flex h-full flex-col items-center justify-center px-6 text-center text-xs">
                    <Users className="text-dim-copy mb-2 h-5 w-5" />
                    No profiles available in registry.
                  </div>
                ) : filteredProfiles.length === 0 ? (
                  <div className="text-subtle-copy flex h-full items-center justify-center px-6 text-center text-xs">
                    No matching profiles found.
                  </div>
                ) : (
                  <ScrollArea className="h-full">
                    <div className="flex flex-col">
                      {filteredProfiles.map((profile, index) => (
                        <button
                          key={profile.profile_id}
                          type="button"
                          onClick={() => handleToggle(profile.profile_id)}
                          className={cn(
                            'flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left transition-colors',
                            index < filteredProfiles.length - 1 &&
                              'border-line border-b',
                            profile.selected
                              ? 'bg-panel-selected'
                              : 'hover:bg-panel-subtle',
                          )}
                        >
                          <Checkbox
                            checked={profile.selected}
                            onCheckedChange={() => undefined}
                            className="brand-checkbox border-line-strong bg-field-alt pointer-events-none mt-0.5 h-4.5 w-4.5"
                          />

                          <div className="min-w-0 flex-1">
                            <p className="text-ink truncate text-xs font-medium">
                              {profile.name}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </div>
            </section>

            <section className="flex min-h-0 flex-col">


              <div className="border-line bg-panel-subtle min-h-0 flex-1 rounded-[18px] border p-1">
                {selectedProfiles.length === 0 ? (
                  <div className="text-subtle-copy flex h-full min-h-[180px] flex-col items-center justify-center px-6 text-center text-sm">
                    <Users className="text-dim-copy mb-3 h-8 w-8" />
                    No profiles selected.
                    <p className="text-dim-copy mt-1 max-w-[200px] text-xs">
                      Select profiles from the list on the left to add them here.
                    </p>
                  </div>
                ) : (
                  <ScrollArea className="h-full">
                    <div className="space-y-2.5 p-2.5">
                      {selectedProfiles.map((profile) => (
                        <div
                          key={profile.profile_id}
                          className="border-line bg-panel-muted flex items-center justify-between gap-2 rounded-xl border px-3 py-2"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-ink truncate text-[13px] font-medium leading-tight">
                              {profile.name}
                            </p>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleToggle(profile.profile_id)}
                            disabled={saving}
                            className="text-subtle-copy hover:bg-panel-hover hover:text-ink -mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors"
                            aria-label={`Remove ${profile.name}`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>

      <div className="border-line-soft bg-panel border-t px-6 py-4">
        {error && (
          <div className="border-status-danger-border bg-status-danger-soft text-status-danger mb-3 rounded-xl border px-3.5 py-2.5 text-xs font-medium">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-end">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              disabled={saving}
              className="border-line bg-panel-soft text-ink hover:bg-panel-hover h-8 border px-3 text-xs hover:text-ink"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={saveDisabled}
              className="brand-button h-8 px-3.5 text-xs"
            >
              {footerButtonLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}



