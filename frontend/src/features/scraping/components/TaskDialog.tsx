import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
      <DialogContent className="bg-panel border-line text-ink max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="page-title-gradient text-xl font-bold">
            {title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-2">
            <Label
              htmlFor={`${idPrefix}_task_name`}
              className="text-muted-copy"
            >
              Task name
            </Label>
            <Input
              id={`${idPrefix}_task_name`}
              placeholder="Followers scrape"
              value={taskName}
              onChange={(e) => onTaskNameChange(e.target.value)}
              className="brand-focus bg-field border-line text-ink"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor={`${idPrefix}_kind`} className="text-muted-copy">
              Scraping type
            </Label>
            <Select
              value={kind}
              onValueChange={(v) =>
                onKindChange(v as 'followers' | 'following')
              }
            >
              <SelectTrigger
                id={`${idPrefix}_kind`}
                className="brand-focus bg-field border-line text-ink"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="panel-dropdown">
                <SelectItem
                  value="followers"
                  className="focus:bg-panel-hover focus:text-ink"
                >
                  Followers
                </SelectItem>
                <SelectItem
                  value="following"
                  className="focus:bg-panel-hover focus:text-ink"
                >
                  Following
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-muted-copy">Assignment</Label>
              <div className="border-line bg-panel-muted text-muted-copy rounded-md border px-3 py-2 text-sm">
                Tasks are distributed automatically across eligible profiles.
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-muted-copy">Eligibility</Label>
              <div className="border-line bg-panel-muted text-muted-copy rounded-md border px-3 py-2 text-sm">
                {eligibleLoading
                  ? 'Loading...'
                  : `${eligibleProfiles.length} eligible profile(s)`}
              </div>
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label
                htmlFor={`${idPrefix}_target_usernames`}
                className="text-muted-copy"
              >
                Target usernames
              </Label>
              <Textarea
                id={`${idPrefix}_target_usernames`}
                placeholder={'instagram\nnatgeo\nnasa'}
                value={targetUsername}
                onChange={(e) => onTargetUsernameChange(e.target.value)}
                className="brand-focus bg-field border-line min-h-[140px] font-mono text-sm text-ink"
              />
              <div className="text-subtle-copy text-xs">
                One username per line. Task runs each one.
              </div>
            </div>
          </div>

          <div className="mt-6 flex items-center gap-4">
            <Button
              variant="outline"
              onClick={onCancel}
              disabled={disabled}
              className="border-line text-copy hover:bg-panel-muted flex-1 bg-transparent hover:text-ink"
            >
              Cancel
            </Button>
            <Button
              onClick={onSubmit}
              disabled={submitDisabled || disabled}
              className="brand-button flex-1 disabled:shadow-none"
            >
              {submitLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}


