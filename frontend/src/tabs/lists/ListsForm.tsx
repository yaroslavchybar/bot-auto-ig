import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DialogClose, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { RefreshCw, Search, Users, X } from 'lucide-react'
import { fetchProfilesForEdit } from './api'
import type { List, ProfileRow } from './types'

interface ListsFormProps {
  mode: 'create' | 'edit'
  initialData?: List
  saving: boolean
  error?: string | null
  onSave: (name: string, addedIds: string[], removedIds: string[]) => void
  onCancel: () => void
  className?: string
}

export function ListsForm({ mode, initialData, saving, error: externalError, onSave, onCancel, className }: ListsFormProps) {
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
          : profile
      )
    })
  }

  const handleSubmit = () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setLocalError('Name is required')
      return
    }

    const addedIds = profiles.filter((p) => p.selected && !p.initialSelected).map((p) => p.profile_id)
    const removedIds = profiles.filter((p) => !p.selected && p.initialSelected).map((p) => p.profile_id)

    setLocalError(null)
    onSave(trimmed, addedIds, removedIds)
  }

  const error = externalError || localError

  const filteredProfiles = useMemo(
    () => profiles.filter((p) => {
      const query = searchQuery.trim().toLowerCase()
      if (!query) return true
      return p.name.toLowerCase().includes(query) || p.profile_id.toLowerCase().includes(query)
    }),
    [profiles, searchQuery]
  )

  const selectedCount = useMemo(() => profiles.filter((p) => p.selected).length, [profiles])
  const selectedProfiles = useMemo(() => profiles.filter((p) => p.selected), [profiles])
  const changedCount = useMemo(
    () => profiles.filter((p) => p.selected !== p.initialSelected).length,
    [profiles]
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
      })
    )
  }

  const filteredSelectionState: boolean | 'indeterminate' = useMemo(() => {
    if (filteredProfiles.length === 0) return false

    const checkedCount = filteredProfiles.filter((profile) => profile.selected).length
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
      <div className={cn('flex flex-col h-[calc(90vh-10rem)] p-6', className)}>
        <div className="flex-1 min-h-0 overflow-auto pr-4">
          <div className="grid gap-5 pb-2">
            <div className="grid gap-1.5">
              <Label htmlFor="name" className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                List Name
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={saving}
                placeholder="Enter list name..."
                autoFocus
                className="h-10 font-medium bg-black/50 border-white/10 text-white focus-visible:ring-red-500/50 focus-visible:border-red-500"
              />
            </div>
          </div>
        </div>

        <div className="flex-shrink-0 pt-4 border-t border-white/10 mt-4">
          {error && (
            <div className="text-sm text-red-500 font-medium bg-red-500/10 p-3 rounded-md mb-4 border border-red-500/20">{error}</div>
          )}

          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={onCancel} disabled={saving} className="bg-transparent border border-white/10 text-gray-300 hover:bg-white/10 hover:text-white transition-all shadow-none">
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={saveDisabled} className="border-none bg-gradient-to-r from-red-600 to-orange-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.4)] hover:shadow-[0_0_25px_rgba(239,68,68,0.6)] hover:from-red-500 hover:to-orange-400 transition-all font-medium">
              {footerButtonLabel}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={cn('flex h-[min(82vh,720px)] flex-col', className)}>
      <div className="flex items-start justify-between gap-3 border-b border-white/5 px-6 py-3">
        <div>
          <DialogTitle className="text-xl font-semibold tracking-tight text-gray-100">Edit List</DialogTitle>
        </div>

        <DialogClose asChild>
          <button
            type="button"
            aria-label="Close modal"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.02] text-gray-500 transition-colors hover:border-white/20 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </DialogClose>
      </div>

      <div className="flex-1 overflow-hidden px-6 pb-4 pt-2">
        <div className="flex h-full flex-col gap-4">
          <section className="grid gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="name" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                List Name
              </Label>
              {changedCount > 0 && (
                <span className="rounded-full border border-orange-500/20 bg-orange-500/10 px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-[0.14em] text-orange-300">
                  {changedCount} pending change{changedCount === 1 ? '' : 's'}
                </span>
              )}
            </div>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
              placeholder="Enter list name..."
              autoFocus
              className="h-10 rounded-xl border-orange-500/70 bg-black/20 px-3.5 text-sm font-medium text-gray-100 focus-visible:border-orange-500 focus-visible:ring-orange-500/30"
            />
          </section>

          <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
            <section className="flex min-h-0 flex-col">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 className="text-base font-medium text-gray-200">Available Profiles</h2>
                <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-0.5 text-[11px] text-gray-500">
                  {filteredProfiles.length} shown
                </span>
              </div>

              <div className="mb-2 rounded-2xl border border-white/10 bg-white/[0.02] p-2.5">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
                  <Input
                    placeholder="Search profiles..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-9 rounded-xl border-white/10 bg-black/40 pl-9 text-xs text-gray-200 placeholder:text-gray-600 focus-visible:border-orange-500 focus-visible:ring-orange-500/30"
                    disabled={loadingProfiles || saving}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-t-[18px] border border-white/10 border-b-0 bg-white/[0.03] px-3.5 py-2.5">
                <label className="flex cursor-pointer items-center gap-2.5 text-xs font-medium text-white">
                  <Checkbox
                    checked={filteredSelectionState}
                    onCheckedChange={(checked) => setFilteredSelection(checked === true)}
                    disabled={loadingProfiles || saving || filteredProfiles.length === 0}
                    className="h-4.5 w-4.5 rounded-md border-white/20 bg-black/40 data-[state=checked]:border-orange-500 data-[state=checked]:bg-orange-500 data-[state=checked]:text-white"
                  />
                  <span>Select All</span>
                </label>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setFilteredSelection(false)}
                  disabled={loadingProfiles || saving || filteredProfiles.every((profile) => !profile.selected)}
                  className="h-7 rounded-lg border border-white/10 bg-transparent px-2.5 text-[11px] text-gray-500 hover:bg-white/[0.03] hover:text-gray-200"
                >
                  Deselect All
                </Button>
              </div>

              <div className="min-h-0 flex-1 overflow-hidden rounded-b-[18px] border border-white/10 bg-black/20">
                {loadingProfiles ? (
                  <div className="flex h-full items-center justify-center text-xs text-gray-500">
                    <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
                    Loading profiles...
                  </div>
                ) : profiles.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center px-6 text-center text-xs text-gray-500">
                    <Users className="mb-2 h-5 w-5 text-gray-600" />
                    No profiles available in registry.
                  </div>
                ) : filteredProfiles.length === 0 ? (
                  <div className="flex h-full items-center justify-center px-6 text-center text-xs text-gray-500">
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
                            index < filteredProfiles.length - 1 && 'border-b border-white/10',
                            profile.selected ? 'bg-white/[0.04]' : 'hover:bg-white/[0.02]'
                          )}
                        >
                          <Checkbox
                            checked={profile.selected}
                            onCheckedChange={() => undefined}
                            className="mt-0.5 h-4.5 w-4.5 rounded-md border-white/20 bg-black/40 pointer-events-none data-[state=checked]:border-orange-500 data-[state=checked]:bg-orange-500 data-[state=checked]:text-white"
                          />

                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium text-gray-200">{profile.name}</p>
                            <p className="mt-0.5 truncate font-mono text-[10px] text-gray-500">{profile.profile_id}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </div>
            </section>

            <section className="flex min-h-0 flex-col">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 className="text-lg font-medium text-gray-200">
                  Selected Profiles <span className="ml-1 text-gray-500">({selectedCount})</span>
                </h2>
              </div>

              <div className="min-h-0 flex-1 rounded-[18px] border border-white/10 bg-white/[0.02] p-1">
                {selectedProfiles.length === 0 ? (
                  <div className="flex h-full min-h-[180px] flex-col items-center justify-center px-6 text-center text-xs text-gray-500">
                    <Users className="mb-2 h-5 w-5 text-gray-600" />
                    No profiles selected yet.
                  </div>
                ) : (
                  <ScrollArea className="h-full">
                    <div className="space-y-2.5 p-2.5">
                      {selectedProfiles.map((profile) => (
                        <div
                          key={profile.profile_id}
                          className="flex items-start justify-between gap-2.5 rounded-2xl border border-white/10 bg-black/30 p-3"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium text-gray-200">{profile.name}</p>
                            <p className="mt-0.5 break-all font-mono text-[10px] leading-relaxed text-gray-500">
                              {profile.profile_id}
                            </p>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleToggle(profile.profile_id)}
                            disabled={saving}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-orange-400 transition-colors hover:bg-orange-500/10 hover:text-orange-300"
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

      <div className="border-t border-white/5 bg-[#0a0a0a] px-6 py-4">
        {error && (
          <div className="mb-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3.5 py-2.5 text-xs font-medium text-red-400">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-gray-400">{profiles.length} available profiles</div>

          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              disabled={saving}
              className="h-8 border border-white/10 bg-white/[0.03] px-3 text-xs text-gray-200 hover:bg-white/[0.06] hover:text-white"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={saveDisabled}
              className="h-8 border-none bg-gradient-to-r from-red-600 to-orange-500 px-3.5 text-xs text-white shadow-[0_0_15px_rgba(239,68,68,0.35)] hover:from-red-500 hover:to-orange-400 hover:shadow-[0_0_25px_rgba(239,68,68,0.5)]"
            >
              {footerButtonLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
