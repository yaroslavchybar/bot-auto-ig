import { useState } from 'react'
import { useMutation } from 'convex/react'
import { toast } from 'sonner'
import { UserCheck } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import type { Profile } from '../types'
import { cn } from '@/lib/utils'

export function IgStateToggles({ profile }: { profile: Profile }) {
  const update = useMutation(api.profiles.mutations.setIgState)
  const [busy, setBusy] = useState(false)
  const active = profile.igLoggedIn ?? false
  return (
    <label className="flex items-center gap-1.5" title="Logged in" onClick={e => e.stopPropagation()}>
      <Switch
        aria-label={`Logged in: ${profile.name}`}
        checked={active}
        disabled={busy || profile.status === 'deleting'}
        onCheckedChange={async checked => {
          setBusy(true)
          try {
            await update({ profileId: profile.id as Id<'profiles'>, igLoggedIn: checked })
          } catch (error) {
            toast.error(String(error))
          } finally {
            setBusy(false)
          }
        }}
      />
      <UserCheck aria-hidden className={cn('h-4 w-4', active ? 'text-status-success' : 'text-muted-copy')} />
    </label>
  )
}
