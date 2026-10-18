import { useState } from 'react'
import { useMutation } from 'convex/react'
import { toast } from 'sonner'
import { UserCheck } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import type { Profile } from '../types'
import { cn } from '@/lib/utils'

export function IgLoginStatus({ profile }: { profile: Profile }) {
  const label = profile.igLoggedIn ? 'Logged in' : 'Not logged in'
  return <span role="img" aria-label={label} title={label}>
    <UserCheck aria-hidden className={cn('h-4 w-4', profile.igLoggedIn ? 'text-status-success' : 'text-muted-copy')} />
  </span>
}

export function IgStateToggles({ profile, disabled = false }: { profile: Profile; disabled?: boolean }) {
  const update = useMutation(api.profiles.mutations.setIgState)
  const [busy, setBusy] = useState(false)
  const active = profile.igLoggedIn ?? false
  return (
    <label className="flex items-center gap-1.5" title="Logged in" onClick={e => e.stopPropagation()}>
      <Switch
        aria-label={`Logged in: ${profile.name}`}
        checked={active}
        disabled={disabled || busy || profile.status === 'deleting' || Boolean(profile.pendingRenameFrom)}
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
