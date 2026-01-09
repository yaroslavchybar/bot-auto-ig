import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

type EligibleProfile = { id: string; name: string }

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  idPrefix: string
  taskName: string
  onTaskNameChange: (next: string) => void
  autoMode: boolean
  onAutoModeChange: (next: boolean) => void
  selectedProfileId: string
  onSelectedProfileIdChange: (next: string) => void
  targetUsername: string
  onTargetUsernameChange: (next: string) => void
  limit: string
  onLimitChange: (next: string) => void
  limitPerProfile: string
  onLimitPerProfileChange: (next: string) => void
  eligibleProfiles: EligibleProfile[]
  eligibleSet: Set<string>
  eligibleLoading: boolean
  submitLabel: string
  submitDisabled: boolean
  disabled: boolean
  onCancel: () => void
  onSubmit: () => void
}

export function TaskDialog({
  open,
  onOpenChange,
  title,
  idPrefix,
  taskName,
  onTaskNameChange,
  autoMode,
  onAutoModeChange,
  selectedProfileId,
  onSelectedProfileIdChange,
  targetUsername,
  onTargetUsernameChange,
  limit,
  onLimitChange,
  limitPerProfile,
  onLimitPerProfileChange,
  eligibleProfiles,
  eligibleSet,
  eligibleLoading,
  submitLabel,
  submitDisabled,
  disabled,
  onCancel,
  onSubmit,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor={`${idPrefix}_task_name`}>Task name</Label>
            <Input
              id={`${idPrefix}_task_name`}
              placeholder="Followers scrape"
              value={taskName}
              onChange={(e) => onTaskNameChange(e.target.value)}
            />
          </div>

          <div className="rounded-md border bg-background p-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">Auto distribution</div>
              <div className="text-xs text-muted-foreground mt-1">Split work across all eligible profiles.</div>
            </div>
            <Checkbox checked={autoMode} onCheckedChange={(v) => onAutoModeChange(Boolean(v))} />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Profile</Label>
              <Select value={selectedProfileId} onValueChange={onSelectedProfileIdChange} disabled={autoMode}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      autoMode
                        ? 'Auto distribution enabled'
                        : eligibleLoading
                          ? 'Loading eligible profiles...'
                          : 'Select a profile'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {eligibleProfiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!autoMode && selectedProfileId && !eligibleSet.has(selectedProfileId) && (
                <div className="text-xs text-destructive">Selected profile is not eligible.</div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Eligibility</Label>
              <div className="rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground">
                {eligibleLoading ? 'Loading...' : `${eligibleProfiles.length} eligible profile(s)`}
              </div>
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor={`${idPrefix}_target_usernames`}>Target usernames</Label>
              <Textarea
                id={`${idPrefix}_target_usernames`}
                placeholder={'instagram\nnatgeo\nnasa'}
                value={targetUsername}
                onChange={(e) => onTargetUsernameChange(e.target.value)}
                className="min-h-[140px]"
              />
              <div className="text-xs text-muted-foreground">One username per line. Task runs each one.</div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}_limit`}>Limit</Label>
              <Input
                id={`${idPrefix}_limit`}
                inputMode="numeric"
                placeholder="200"
                value={limit}
                onChange={(e) => onLimitChange(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}_limit_per_profile`}>Limit per profile</Label>
              <Input
                id={`${idPrefix}_limit_per_profile`}
                inputMode="numeric"
                placeholder={autoMode ? '200' : 'Auto distribution only'}
                value={limitPerProfile}
                onChange={(e) => onLimitPerProfileChange(e.target.value)}
                disabled={!autoMode}
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={onCancel} disabled={disabled}>
              Cancel
            </Button>
            <Button onClick={onSubmit} disabled={submitDisabled || disabled}>
              {submitLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
