import { useState, useEffect } from 'react'
import type { List, ProfileRow } from './types'
import { fetchProfilesForEdit } from './api'
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"

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
    setProfiles((prev) => {
      const next = [...prev]
      const item = next[index]
      if (item) {
        next[index] = { ...item, selected: !item.selected }
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

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{mode === 'create' ? 'Create List' : 'Edit List'}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
              autoFocus
            />
          </div>
        </div>

        {mode === 'edit' && (
          <div className="space-y-4">
            <Label>Profiles</Label>
            {loadingProfiles ? (
              <div className="text-sm text-muted-foreground">Loading profiles...</div>
            ) : (
              <ScrollArea className="h-[300px] border rounded-md p-4">
                <div className="space-y-2">
                  {profiles.map((p, i) => (
                    <div
                      key={p.profile_id}
                      className="flex items-center space-x-2 cursor-pointer hover:bg-muted/50 p-2 rounded"
                      onClick={() => handleToggle(i)}
                    >
                      <Checkbox
                        checked={p.selected}
                        onCheckedChange={() => {}}
                        className="pointer-events-none"
                      />
                      <div className="grid gap-1.5 leading-none pointer-events-none">
                        <label
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                        >
                          {p.name}
                        </label>
                        <p className="text-xs text-muted-foreground">
                          {p.profile_id}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        )}

        {error && <div className="text-sm text-destructive">{error}</div>}
      </CardContent>
      <CardFooter className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </CardFooter>
    </Card>
  )
}
