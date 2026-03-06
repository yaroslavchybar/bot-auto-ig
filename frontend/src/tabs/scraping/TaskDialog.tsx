import { Button } from '@/components/ui/button'
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
  kind: 'followers' | 'following'
  onKindChange: (next: 'followers' | 'following') => void
  targetUsername: string
  onTargetUsernameChange: (next: string) => void
  eligibleProfiles: EligibleProfile[]
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
  kind,
  onKindChange,
  targetUsername,
  onTargetUsernameChange,
  eligibleProfiles,
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

          <div className="grid gap-2">
            <Label htmlFor={`${idPrefix}_kind`}>Scraping type</Label>
            <Select value={kind} onValueChange={(v) => onKindChange(v as 'followers' | 'following')}>
              <SelectTrigger id={`${idPrefix}_kind`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="followers">Followers</SelectItem>
                <SelectItem value="following">Following</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Assignment</Label>
              <div className="rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground">
                Tasks are distributed automatically across eligible profiles.
              </div>
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
