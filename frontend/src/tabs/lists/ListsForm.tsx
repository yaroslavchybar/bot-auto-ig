import { useState, useEffect } from 'react'
import type { List, ProfileRow } from './types'
import { fetchProfilesForEdit } from './api'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Users, Search, AlertCircle } from 'lucide-react'

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
    if (mode === 'edit' && initialData) {
      setLoadingProfiles(true)
      fetchProfilesForEdit(initialData.id)
        .then(setProfiles)
        .catch((e) => setLocalError(e instanceof Error ? e.message : String(e)))
        .finally(() => setLoadingProfiles(false))
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

  // Filter profiles by search query
  const filteredProfiles = profiles
    .map((p, i) => ({ ...p, originalIndex: i }))
    .filter((p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.profile_id.toLowerCase().includes(searchQuery.toLowerCase())
    )

  const selectedCount = profiles.filter((p) => p.selected).length

  return (
    <div className="flex flex-col gap-6">
      {/* Name Input */}
      <div className="space-y-2">
        <Label htmlFor="name" className="text-sm font-medium">
          List Name
        </Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={saving}
          placeholder="Enter list name..."
          autoFocus
          className="h-10"
        />
      </div>

      {mode === 'edit' && (
        <>
          <Separator />

          {/* Profiles Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <Label className="text-sm font-medium">Profiles</Label>
              </div>
              <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-full">
                {selectedCount} selected
              </span>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search profiles..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9"
                disabled={loadingProfiles}
              />
            </div>

            {/* Profiles List */}
            {loadingProfiles ? (
              <div className="space-y-2 p-1">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-lg border bg-card">
                    <Skeleton className="h-4 w-4 rounded" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-48" />
                    </div>
                  </div>
                ))}
              </div>
            ) : profiles.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
                <Users className="h-10 w-10 mb-2 opacity-50" />
                <p className="text-sm">No profiles available</p>
              </div>
            ) : (
              <ScrollArea className="h-[280px] rounded-lg border bg-card/50">
                <div className="p-2 space-y-1">
                  {filteredProfiles.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
                      <Search className="h-8 w-8 mb-2 opacity-50" />
                      <p className="text-sm">No profiles match your search</p>
                    </div>
                  ) : (
                    filteredProfiles.map((p, i) => (
                      <div
                        key={p.profile_id}
                        className={`
                          flex items-center gap-3 p-3 rounded-lg cursor-pointer
                          transition-all duration-150 ease-in-out
                          ${p.selected
                            ? 'bg-primary/10 border border-primary/30 hover:bg-primary/15'
                            : 'hover:bg-muted/50 border border-transparent'
                          }
                        `}
                        onClick={() => handleToggle(i)}
                      >
                        <Checkbox
                          checked={p.selected}
                          onCheckedChange={() => { }}
                          className="pointer-events-none data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {p.name}
                          </p>
                          <p className="text-xs text-muted-foreground truncate font-mono">
                            {p.profile_id}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            )}
          </div>
        </>
      )}

      {/* Error Message */}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Footer Buttons */}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  )
}
