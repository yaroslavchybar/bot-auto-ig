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
    navigate(AUTH_ROUTES.login, { replace: true })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="border-line-soft hover:bg-panel-muted data-[state=open]:bg-panel-hover relative h-8 w-8 rounded-full border transition-colors"
        >
          <Avatar className="ring-line text-ink h-8 w-8 ring-1 transition-shadow hover:shadow-xs">
            <AvatarImage src={user.photoUrl} alt={user.fullName ?? 'User'} />
            <AvatarFallback className="brand-avatar text-[10px] font-medium">
              {initials}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="bg-panel border-line text-ink w-56 rounded-xl border shadow-2xl backdrop-blur-xl"
        align="end"
        forceMount
      >
        <DropdownMenuLabel className="px-3 py-3 font-normal">
          <div className="flex items-center gap-3">
            <Avatar className="ring-line h-10 w-10 ring-1">
              <AvatarImage src={user.photoUrl} alt={user.fullName ?? 'User'} />
              <AvatarFallback className="brand-avatar text-[12px] font-medium">
                {initials}
              </AvatarFallback>
            </Avatar>
            <span className="text-ink truncate text-sm font-medium">
              {displayName}
            </span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-panel-hover mx-1" />
        <div className="p-1">
          {env.disableAuth ? (
            <DropdownMenuItem disabled>
              Local development auth bypass
            </DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem
                className="text-copy focus:bg-panel-hover cursor-pointer gap-3 rounded-lg py-2 transition-colors focus:text-ink"
                disabled
              >
                <ShieldCheck className="text-muted-copy h-4 w-4" />
                <span>Admin session</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-copy focus:bg-panel-hover cursor-pointer gap-3 rounded-lg py-2 transition-colors focus:text-ink"
                onClick={handleSignOut}
              >
                <LogOut className="text-muted-copy h-4 w-4" />
                <span>Sign out</span>
              </DropdownMenuItem>
            </>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
