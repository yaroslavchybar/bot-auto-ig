import { KeyRound, LogOut, MoreVertical, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { Profile } from '@/features/profiles/types'
import type { useChatPage } from '../hooks/useChatPage'

// Profile switch + connection status + actions. Rendered in the app header
// (via portal) on desktop. On mobile only the profile switch moves to the
// header; status and actions render inline in the page when a profile is set.
export function ChatProfileSelect({
  chat,
  className,
}: {
  chat: ReturnType<typeof useChatPage>
  className?: string
}) {
  const busy = chat.sending || chat.connecting || chat.loggingOut
  return (
    <Select
      value={chat.activeProfileId || undefined}
      onValueChange={chat.selectProfile}
      disabled={chat.profilesLoading || busy}
    >
      <SelectTrigger
        aria-label="Instagram profile"
        className={cn(
          'bg-field brand-focus h-8 w-32 min-w-0 max-w-full shadow-xs min-[400px]:w-36 sm:w-44 lg:w-52',
          className,
        )}
      >
        <SelectValue placeholder="Select a profile" />
      </SelectTrigger>
      <SelectContent className="panel-dropdown">
        <SelectItem value="all">All profiles</SelectItem>
        {chat.profiles.map((profile: Profile) => (
          <SelectItem key={profile.id} value={profile.id}>
            {profile.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function ChatStatusActions({
  chat,
  className,
}: {
  chat: ReturnType<typeof useChatPage>
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {chat.activeProfileId !== 'all' && (
        <ConnectionBadge connected={chat.connected} />
      )}

      <div className="ml-auto flex items-center gap-2">
        {chat.connected === false && chat.activeProfile && (
          <Button
            size="sm"
            onClick={() => chat.setConnectOpen(true)}
            className="brand-button h-8"
          >
            <KeyRound /> Connect
          </Button>
        )}
        {chat.activeProfile && chat.connected && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                aria-label="Chat options"
                className="size-8"
              >
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onSelect={() => chat.setConnectOpen(true)}>
                <RefreshCw /> Reconnect Chat
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => chat.logout()}
                disabled={chat.loggingOut || chat.connecting || chat.sending}
                className="text-status-danger focus:text-status-danger"
              >
                <LogOut /> {chat.loggingOut ? 'Logging out...' : 'Log out'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}

export function ChatHeaderControls({
  chat,
  className,
}: {
  chat: ReturnType<typeof useChatPage>
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <ChatProfileSelect chat={chat} />
      <ChatStatusActions chat={chat} className="contents" />
    </div>
  )
}

function ConnectionBadge({ connected }: { connected: boolean | null }) {
  if (connected === null) {
    return (
      <Badge variant="secondary" className="gap-1.5">
        <span className="bg-panel-muted size-1.5 rounded-full" /> Checking...
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      <span
        className={cn(
          'size-1.5 rounded-full',
          connected ? 'status-dot-success' : 'status-dot-danger',
        )}
      />
      {connected ? 'Connected' : 'Disconnected'}
    </Badge>
  )
}
