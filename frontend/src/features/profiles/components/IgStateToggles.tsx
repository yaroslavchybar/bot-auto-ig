import { useState } from 'react'
import { useMutation } from 'convex/react'
import { toast } from 'sonner'
import { UserCheck, Send } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import type { Profile } from '../types'
import { cn } from '@/lib/utils'

const TOGGLES = [
  {
    key: 'igLoggedIn' as const,
    icon: UserCheck,
    label: 'Logged in',
  },
  {
    key: 'outreachReady' as const,
    icon: Send,
    label: 'Ready for outreach',
  },
] as const

export function IgStateToggles({ profile }: { profile: Profile }) {
  const update = useMutation(api.profiles.mutations.setIgState)
  const [busy, setBusy] = useState(false)
  return (
    <div
      className="flex items-center gap-3"
      onClick={(e) => e.stopPropagation()}
    >
      {TOGGLES.map(({ key, icon: Icon, label }) => {
        const active = profile[key] ?? false
        return (
          <label
            key={key}
            className="flex items-center gap-1.5"
            title={label}
          >
            <Switch
              aria-label={`${label}: ${profile.name}`}
              checked={active}
              disabled={busy || profile.status === 'deleting'}
              onCheckedChange={async (checked) => {
                setBusy(true)
                try {
                  await update({
                    profileId: profile.id as Id<'profiles'>,
                    [key]: checked,
                  })
                } catch (e) {
                  toast.error(String(e))
                } finally {
                  setBusy(false)
                }
              }}
            />
            <Icon
              aria-hidden
              className={cn(
                'h-4 w-4',
                active ? 'text-status-success' : 'text-muted-copy',
              )}
            />
          </label>
        )
      })}
    </div>
  )
}
