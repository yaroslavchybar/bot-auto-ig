import { useUser, useClerk } from '@clerk/clerk-react'
import { Settings, LogOut } from 'lucide-react'
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

export function UserMenu() {
    const { user } = useUser()
    const clerk = useClerk()

    if (!user) return null

    const email = user.primaryEmailAddress?.emailAddress ?? ''
    const initials = user.firstName && user.lastName
        ? `${user.firstName[0]}${user.lastName[0]}`
        : email.substring(0, 2).toUpperCase()

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-8 w-8 rounded-full border border-white/5 hover:bg-white/5 data-[state=open]:bg-white/10 transition-colors">
                    <Avatar className="h-8 w-8 ring-1 ring-white/10 transition-shadow hover:shadow-[0_0_15px_rgba(255,255,255,0.05)] text-gray-200">
                        <AvatarImage src={user.imageUrl} alt={user.fullName ?? 'User'} />
                        <AvatarFallback className="bg-gradient-to-r from-red-600 to-orange-500 text-white font-medium text-[10px]">
                            {initials}
                        </AvatarFallback>
                    </Avatar>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56 bg-[#0a0a0a] border border-white/10 text-gray-200 rounded-xl shadow-2xl backdrop-blur-xl" align="end" forceMount>
                <DropdownMenuLabel className="font-normal py-3 px-3">
                    <div className="flex items-center gap-3">
                        <Avatar className="h-10 w-10 ring-1 ring-white/10">
                            <AvatarImage src={user.imageUrl} alt={user.fullName ?? 'User'} />
                            <AvatarFallback className="bg-gradient-to-r from-red-600 to-orange-500 text-white font-medium text-[12px]">
                                {initials}
                            </AvatarFallback>
                        </Avatar>
                        <span className="text-sm font-medium text-gray-200 truncate">{email}</span>
                    </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-white/10 mx-1" />
                <div className="p-1">
                    <DropdownMenuItem
                        className="cursor-pointer gap-3 py-2 text-gray-300 focus:bg-white/10 focus:text-white rounded-lg transition-colors"
                        onClick={() => clerk.openUserProfile()}
                    >
                        <Settings className="h-4 w-4 text-gray-400" />
                        <span>Manage account</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        className="cursor-pointer gap-3 py-2 text-gray-300 focus:bg-white/10 focus:text-white rounded-lg transition-colors"
                        onClick={() => clerk.signOut({ redirectUrl: '/sign-in' })}
                    >
                        <LogOut className="h-4 w-4 text-gray-400" />
                        <span>Sign out</span>
                    </DropdownMenuItem>
                </div>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
