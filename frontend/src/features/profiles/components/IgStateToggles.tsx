import { useState } from 'react'
import { useMutation } from 'convex/react'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import type { Profile } from '../types'

export function IgStateToggles({ profile }: { profile: Profile }) {
  const update = useMutation(api.profiles.mutations.setIgState)
  const [busy, setBusy] = useState(false)
  return (
    <div
      className="flex flex-wrap gap-3 py-1"
      onClick={(e) => e.stopPropagation()}
    >
      {(['igLoggedIn', 'outreachReady'] as const).map((key) => (
        <label
          key={key}
          className="flex items-center gap-2 text-xs font-normal"
        >
          <Switch
            aria-label={`${key === 'igLoggedIn' ? 'Logged in' : 'Ready for outreach'}: ${profile.name}`}
            checked={profile[key] ?? false}
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
          {key === 'igLoggedIn' ? 'Logged in' : 'Ready for outreach'}
        </label>
      ))}
    </div>
  )
}
