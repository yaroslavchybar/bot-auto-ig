import { LogOut, ShieldCheck } from 'lucide-react'
import { useNavigate } from '@/lib/router'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAppAuth, useAppUser } from '@/lib/auth'
import { AUTH_ROUTES } from '@/lib/auth-routing'
import { env } from '@/lib/env'
import { clearUserChatCache } from '@/features/chat/cache'

export function UserMenu() {
  const user = useAppUser()
  const { signOut } = useAppAuth()
  const navigate = useNavigate()

  if (!user) return null

  const displayName = user.username ? `@${user.username}` : user.fullName
  const initials =
    user.firstName && user.lastName
      ? `${user.firstName[0]}${user.lastName[0]}`
      : user.firstName.substring(0, 2).toUpperCase()

  const handleSignOut = async () => {
    await signOut()
    await clearUserChatCache(user.id)
    navigate(AUTH_ROUTES.login, { replace: true })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="relative rounded-full border border-line-soft hover:bg-panel-muted data-[state=open]:bg-panel-hover"
        >
          <Avatar className="h-8 w-8 text-ink ring-1 ring-line hover:shadow-xs">
            <AvatarImage src={user.photoUrl} alt={user.fullName ?? 'User'} />
            <AvatarFallback className="brand-avatar text-[10px] font-medium">
              {initials}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-56 rounded-xl border border-line bg-panel text-ink shadow-2xl"
        align="end"
      >
        <DropdownMenuLabel className="px-3 py-3 font-normal">
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10 ring-1 ring-line">
              <AvatarImage src={user.photoUrl} alt={user.fullName ?? 'User'} />
              <AvatarFallback className="brand-avatar text-[12px] font-medium">
                {initials}
              </AvatarFallback>
            </Avatar>
            <span className="truncate text-sm font-medium text-ink">{displayName}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="mx-1 bg-panel-hover" />
        <div className="p-1">
          {env.disableAuth ? (
            <DropdownMenuItem disabled>Local development auth bypass</DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem
                className="cursor-pointer gap-3 rounded-lg py-2 text-copy focus:bg-panel-hover focus:text-ink"
                disabled
              >
                <ShieldCheck className="h-4 w-4 text-muted-copy" />
                <span>Admin session</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer gap-3 rounded-lg py-2 text-copy focus:bg-panel-hover focus:text-ink"
                onClick={handleSignOut}
              >
                <LogOut className="h-4 w-4 text-muted-copy" />
                <span>Sign out</span>
              </DropdownMenuItem>
            </>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
