import { useState } from 'react'
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
import { AccountDialog } from '@/components/account-dialog'

export function UserMenu() {
    const { user } = useUser()
    const { signOut } = useClerk()
    const [accountDialogOpen, setAccountDialogOpen] = useState(false)

    if (!user) return null

    const email = user.primaryEmailAddress?.emailAddress ?? ''
    const initials = user.firstName && user.lastName
        ? `${user.firstName[0]}${user.lastName[0]}`
        : email.substring(0, 2).toUpperCase()

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                        <Avatar className="h-8 w-8">
                            <AvatarImage src={user.imageUrl} alt={user.fullName ?? 'User'} />
                            <AvatarFallback className="bg-violet-500 text-white">
                                {initials}
                            </AvatarFallback>
                        </Avatar>
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56" align="end" forceMount>
                    <DropdownMenuLabel className="font-normal">
                        <div className="flex items-center gap-3">
                            <Avatar className="h-10 w-10">
                                <AvatarImage src={user.imageUrl} alt={user.fullName ?? 'User'} />
                                <AvatarFallback className="bg-violet-500 text-white">
                                    {initials}
                                </AvatarFallback>
                            </Avatar>
                            <span className="text-sm font-medium truncate">{email}</span>
                        </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                        className="cursor-pointer gap-3 py-2"
                        onClick={() => setAccountDialogOpen(true)}
                    >
                        <Settings className="h-4 w-4 text-muted-foreground" />
                        <span>Manage account</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        className="cursor-pointer gap-3 py-2"
                        onClick={() => signOut({ redirectUrl: '/sign-in' })}
                    >
                        <LogOut className="h-4 w-4 text-muted-foreground" />
                        <span>Sign out</span>
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            <AccountDialog
                open={accountDialogOpen}
                onOpenChange={setAccountDialogOpen}
            />
        </>
    )
}
