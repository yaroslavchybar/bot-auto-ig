import { useState, useEffect, useMemo } from 'react'
import type { List, ProfileRow } from './types'
import { fetchProfilesForEdit } from './api'
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Users, Search, AlertCircle, RefreshCw, Check, Minus, Hash } from 'lucide-react'
import { DenseButton } from "@/components/ui/dense-button"

interface ListsFormProps {
  mode: 'create' | 'edit'
  initialData?: List
  saving: boolean
  error?: string | null
  onSave: (name: string, addedIds: string[], removedIds: string[]) => void
  onCancel: () => void
}

export function ListsForm({ mode, initialData, saving, error: externalError, onSave, onCancel }: ListsFormProps) {
  const [name, setName] = useState(initialData?.name || '')
  const [profiles, setProfiles] = useState<ProfileRow[]>([])
  const [loadingProfiles, setLoadingProfiles] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    setName(initialData?.name || '')
    setLocalError(null)
    setSearchQuery('')
  }, [initialData?.id, mode])

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

  const handleToggle = (index: number) => {
    if (saving) return
    const actualIndex = filteredProfiles[index]?.originalIndex
    if (actualIndex === undefined) return

    setProfiles((prev) => {
      const next = [...prev]
      const item = next[actualIndex]
      if (item) {
        next[actualIndex] = { ...item, selected: !item.selected }
      }
      return next
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

  const filteredProfiles = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return profiles
      .map((p, i) => ({ ...p, originalIndex: i }))
      .filter((p) => {
        if (!query) return true
        return p.name.toLowerCase().includes(query) || p.profile_id.toLowerCase().includes(query)
      })
  }, [profiles, searchQuery])

  const selectedCount = useMemo(() => profiles.filter((p) => p.selected).length, [profiles])
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

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#121212] font-sans text-xs">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-700 dark:text-neutral-300">
            {mode === 'create' ? 'List Identity' : 'List Configuration'}
          </span>
          <span className="text-[10px] text-neutral-500 font-mono">
            {mode === 'create' ? '[CREATE MODE]' : '[EDIT MODE]'}
          </span>
        </div>
        {mode === 'edit' && (
          <span className="text-[10px] text-neutral-500 font-mono">
            {changedCount} PENDING
          </span>
        )}
      </div>

      <div className="flex flex-col px-3 py-2.5 border-b border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/30 gap-1.5 shrink-0">
        <label htmlFor="name" className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 flex items-center">
          List Name
        </label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={saving}
          placeholder="Enter list name..."
          autoFocus
          className="h-6 px-2 py-0 text-[11px] rounded-[3px] border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 focus-visible:ring-1 focus-visible:ring-blue-500 focus-visible:ring-offset-0 shadow-inner"
        />
      </div>

      {mode === 'edit' && (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex flex-col md:flex-row md:items-center justify-between px-2 py-1.5 bg-neutral-100 dark:bg-neutral-800 border-b border-neutral-300 dark:border-neutral-700 shrink-0 select-none gap-2 md:gap-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="h-6 px-2 rounded-[3px] border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 text-[10px] uppercase tracking-wide text-neutral-600 dark:text-neutral-300 inline-flex items-center gap-1.5">
                <Users className="h-3 w-3 text-neutral-500" />
                {profiles.length} Profiles
              </div>
              <div className="h-6 px-2 rounded-[3px] border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 text-[10px] uppercase tracking-wide text-neutral-600 dark:text-neutral-300 inline-flex items-center gap-1.5">
                <Hash className="h-3 w-3 text-neutral-500" />
                {selectedCount} Selected
              </div>
              <div className="relative flex items-center">
                <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-neutral-400" />
                <Input
                  placeholder="Filter profiles..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-56 h-6 pl-6 text-[10px] rounded-[3px] border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 focus-visible:ring-1 focus-visible:ring-blue-500 focus-visible:ring-offset-0"
                  disabled={loadingProfiles || saving}
                />
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <DenseButton onClick={() => setFilteredSelection(true)} disabled={loadingProfiles || saving || filteredProfiles.length === 0}>
                <Check className="mr-1.5 h-3 w-3" />
                Select Filtered
              </DenseButton>
              <DenseButton onClick={() => setFilteredSelection(false)} disabled={loadingProfiles || saving || filteredProfiles.length === 0}>
                <Minus className="mr-1.5 h-3 w-3" />
                Clear Filtered
              </DenseButton>
            </div>
          </div>

          {/* Profiles List */}
          <div className="flex-1 min-h-0 relative overflow-hidden bg-white dark:bg-[#121212]">
            {loadingProfiles ? (
              <div className="flex items-center justify-center h-full text-neutral-500 font-sans italic text-[11px]">
                <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" /> Loading profiles...
              </div>
            ) : profiles.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center text-neutral-500 text-[11px]">
                No profiles available in registry.
              </div>
            ) : (
              <div className="flex flex-col h-full w-full">
                {/* Table Header Row */}
                <div className="flex items-center bg-neutral-100 dark:bg-neutral-800 border-b border-neutral-300 dark:border-neutral-700 text-[10px] uppercase font-semibold text-neutral-500 dark:text-neutral-400 shrink-0 select-none">
                  <div className="w-[56px] shrink-0 border-r border-neutral-300 dark:border-neutral-700 px-2 py-1 flex items-center justify-center">
                    Use
                  </div>
                  <div className="flex-1 w-0 min-w-[150px] border-r border-neutral-300 dark:border-neutral-700 px-2 py-1 flex items-center">
                    Profile Name
                  </div>
                  <div className="w-[180px] shrink-0 px-2 py-1 flex items-center">
                    Profile ID
                  </div>
                </div>

                <ScrollArea className="flex-1 min-h-0 bg-white dark:bg-[#121212]">
                  <div className="flex flex-col pb-2">
                    {filteredProfiles.length === 0 ? (
                      <div className="flex items-center justify-center py-8 text-center text-neutral-500 text-[11px]">
                        No profiles match your search
                      </div>
                    ) : (
                      filteredProfiles.map((p, i) => (
                        <div
                          key={p.profile_id}
                          onClick={() => handleToggle(i)}
                          className={`flex items-center border-b border-neutral-100 dark:border-neutral-800/60 cursor-pointer border-l-2 ${p.selected
                            ? 'bg-indigo-50/50 dark:bg-indigo-900/20 border-l-indigo-500'
                            : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/50 border-l-transparent'
                            }`}
                        >
                          <div className="w-[56px] shrink-0 px-2 py-0.5 border-r border-transparent flex items-center justify-center">
                            <Checkbox
                              checked={p.selected}
                              onCheckedChange={() => { }}
                              className="h-3 w-3 rounded-[2px] pointer-events-none data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600 border-neutral-400"
                            />
                          </div>

                          <div className={`flex-1 w-0 min-w-[150px] px-2 py-0.5 text-[11px] whitespace-nowrap overflow-hidden text-ellipsis border-r border-transparent ${p.selected ? 'text-indigo-700 dark:text-indigo-400 font-medium' : 'text-neutral-700 dark:text-neutral-300'}`}>
                            {p.name}
                          </div>

                          <div className="w-[180px] shrink-0 px-2 py-0.5 text-[10px] text-neutral-500 dark:text-neutral-500 whitespace-nowrap overflow-hidden text-ellipsis border-r border-transparent font-mono">
                            {p.profile_id}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="px-3 py-1.5 bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300 border-t border-red-200 dark:border-red-900/50 text-[10px] font-medium shrink-0 flex items-center">
          <AlertCircle className="h-3 w-3 mr-1.5" />
          {error}
        </div>
      )}

      {/* Footer Buttons Bar */}
      <div className="h-auto shrink-0 bg-neutral-200 dark:bg-neutral-800 border-t border-neutral-300 dark:border-neutral-700 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-neutral-500 dark:text-neutral-400 select-none">
        <div className="flex items-center gap-3">
          {mode === 'edit' && (
            <>
              <span>{selectedCount} Selected</span>
              <span>{changedCount} Pending Changes</span>
            </>
          )}
        </div>
        <div className="flex items-center justify-end gap-2">
          <DenseButton onClick={onCancel} disabled={saving}>
            Cancel
          </DenseButton>
          <DenseButton onClick={handleSubmit} disabled={saving} className="bg-blue-600 dark:bg-blue-600 text-white hover:bg-blue-700 dark:hover:bg-blue-700 border-blue-700 dark:border-blue-700 font-medium px-4">
            {saving ? 'Saving...' : mode === 'create' ? 'Create List' : 'Save Changes'}
          </DenseButton>
        </div>
      </div>
    </div>
  )
}
