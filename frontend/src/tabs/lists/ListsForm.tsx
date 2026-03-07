import { useState, useEffect, useMemo } from 'react'
import type { List, ProfileRow } from './types'
import { fetchProfilesForEdit } from './api'
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Users, Search, RefreshCw, Check, Minus } from 'lucide-react'
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

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

  const filteredProfiles = profiles
    .map((p, i) => ({ ...p, originalIndex: i }))
    .filter((p) => {
      const query = searchQuery.trim().toLowerCase()
      if (!query) return true
      return p.name.toLowerCase().includes(query) || p.profile_id.toLowerCase().includes(query)
    })

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
    <div className={cn("flex flex-col h-[calc(90vh-10rem)] p-6", className)}>
      <ScrollArea className="flex-1 min-h-0 pr-4">
        <div className="grid gap-5 pb-2">

          <div className="grid gap-1.5">
            <Label htmlFor="name" className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex justify-between items-center">
              <span>List Name</span>
              {mode === 'edit' && changedCount > 0 && (
                <span className="text-[10px] text-orange-400 font-mono lowercase tracking-normal bg-orange-500/10 px-2 py-0.5 rounded border border-orange-500/20">
                  {changedCount} pending changes
                </span>
              )}
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
              placeholder="Enter list name..."
              autoFocus
              className="h-9 font-medium bg-black/50 border-white/10 text-white focus-visible:ring-red-500/50 focus-visible:border-red-500"
            />
          </div>

          {mode === 'edit' && (
            <>
              <Separator className="bg-white/5" />

              <div className="grid gap-4">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium flex items-center gap-2 text-gray-300">
                    <Users className="h-4 w-4" /> Profiles Assignment
                  </Label>
                  <span className="text-[10px] text-gray-500 bg-black/30 px-2 py-0.5 rounded border border-white/5">
                    {selectedCount} assigned
                  </span>
                </div>

                <div className="flex flex-col rounded-md bg-white/[0.02] border-white/5 border overflow-hidden">
                  <div className="flex flex-col md:flex-row md:items-center justify-between p-3 border-b border-white/[0.05] bg-black/20 gap-3 md:gap-0">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                      <Input
                        placeholder="Search profiles..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full md:w-64 h-8 pl-9 text-xs bg-black/50 border-white/10 text-white focus-visible:ring-red-500/50 focus-visible:border-red-500 placeholder:text-gray-600"
                        disabled={loadingProfiles || saving}
                      />
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setFilteredSelection(true)}
                        disabled={loadingProfiles || saving || filteredProfiles.length === 0}
                        className="h-8 bg-transparent text-gray-300 hover:bg-white/10 hover:text-white"
                      >
                        <Check className="mr-1.5 h-3.5 w-3.5" />
                        Select All
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setFilteredSelection(false)}
                        disabled={loadingProfiles || saving || filteredProfiles.length === 0}
                        className="h-8 bg-transparent text-gray-300 hover:bg-white/10 hover:text-white"
                      >
                        <Minus className="mr-1.5 h-3.5 w-3.5" />
                        Clear All
                      </Button>
                    </div>
                  </div>

                  <div className="h-[250px] relative bg-transparent">
                    {loadingProfiles ? (
                      <div className="flex items-center justify-center h-full text-gray-500 text-sm italic">
                        <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Loading profiles...
                      </div>
                    ) : profiles.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full text-center text-gray-500 text-sm">
                        No profiles available in registry.
                      </div>
                    ) : filteredProfiles.length === 0 ? (
                      <div className="flex items-center justify-center h-full text-center text-gray-500 text-sm">
                        No matching profiles found
                      </div>
                    ) : (
                      <ScrollArea className="h-full">
                        <div className="flex flex-col">
                          {filteredProfiles.map((p, i) => (
                            <div
                              key={p.profile_id}
                              onClick={() => handleToggle(i)}
                              className={`flex items-center border-b border-white/[0.05] p-3 cursor-pointer transition-colors ${p.selected
                                ? 'bg-white/[0.04]'
                                : 'hover:bg-white/[0.02]'
                                }`}
                            >
                              <div className="flex items-center justify-center mr-3">
                                <Checkbox
                                  checked={p.selected}
                                  onCheckedChange={() => { }}
                                  className="h-4 w-4 rounded-[2px] pointer-events-none data-[state=checked]:bg-red-600 data-[state=checked]:border-red-600 border-white/20"
                                />
                              </div>

                              <div className="flex flex-col justify-center flex-1 w-0 min-w-0">
                                <span className={`text-sm truncate ${p.selected ? 'text-gray-200 font-medium' : 'text-gray-400'}`}>
                                  {p.name}
                                </span>
                                <span className="text-[10px] text-gray-500 font-mono truncate">
                                  {p.profile_id}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </ScrollArea>

      <div className="flex-shrink-0 pt-4 border-t border-white/10 mt-4">
        {error && (
          <div className="text-sm text-red-500 font-medium bg-red-500/10 p-3 rounded-md mb-4 border border-red-500/20">{error}</div>
        )}

        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onCancel} disabled={saving} className="bg-transparent border border-white/10 text-gray-300 hover:bg-white/10 hover:text-white transition-all shadow-none">
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving} className="border-none bg-gradient-to-r from-red-600 to-orange-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.4)] hover:shadow-[0_0_25px_rgba(239,68,68,0.6)] hover:from-red-500 hover:to-orange-400 transition-all font-medium">
            {saving ? 'Saving...' : mode === 'create' ? 'Create List' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </div>
  )
}
