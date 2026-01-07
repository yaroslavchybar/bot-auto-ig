import { useState } from 'react'
import { useUser } from '@clerk/clerk-react'
import { User, Shield, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogTitle,
} from '@/components/ui/dialog'

type Tab = 'profile' | 'security'

interface AccountDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

export function AccountDialog({ open, onOpenChange }: AccountDialogProps) {
    const { user } = useUser()
    const [activeTab, setActiveTab] = useState<Tab>('profile')

    if (!user) return null

    const email = user.primaryEmailAddress?.emailAddress ?? ''
    const initials = user.firstName && user.lastName
        ? `${user.firstName[0]}${user.lastName[0]}`
        : email.substring(0, 2).toUpperCase()

    const isVerified = user.primaryEmailAddress?.verification?.status === 'verified'

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl p-0 gap-0 overflow-hidden">
                <DialogTitle className="sr-only">Account Settings</DialogTitle>
                <div className="flex min-h-[500px]">
                    {/* Sidebar */}
                    <div className="w-56 border-r bg-muted/30 p-6 flex flex-col">
                        <div className="mb-6">
                            <h2 className="text-xl font-semibold">Account</h2>
                            <p className="text-sm text-muted-foreground mt-1">
                                Manage your account info.
                            </p>
                        </div>

                        <nav className="space-y-1">
                            <button
                                onClick={() => setActiveTab('profile')}
                                className={cn(
                                    "flex items-center gap-3 w-full px-3 py-2 rounded-md text-sm font-medium transition-colors",
                                    activeTab === 'profile'
                                        ? "bg-violet-500/20 text-violet-400"
                                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                )}
                            >
                                <User className="h-4 w-4" />
                                Profile
                            </button>
                            <button
                                onClick={() => setActiveTab('security')}
                                className={cn(
                                    "flex items-center gap-3 w-full px-3 py-2 rounded-md text-sm font-medium transition-colors",
                                    activeTab === 'security'
                                        ? "bg-violet-500/20 text-violet-400"
                                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                )}
                            >
                                <Shield className="h-4 w-4" />
                                Security
                            </button>
                        </nav>
                    </div>

                    {/* Content */}
                    <div className="flex-1 p-6">
                        {activeTab === 'profile' && (
                            <div className="space-y-6">
                                <h3 className="text-lg font-medium">Profile details</h3>

                                {/* Profile Section */}
                                <div className="border-b pb-6">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-muted-foreground">Profile</span>
                                        <div className="flex items-center gap-4">
                                            <Avatar className="h-12 w-12">
                                                <AvatarImage src={user.imageUrl} alt={user.fullName ?? 'User'} />
                                                <AvatarFallback className="bg-violet-500 text-white text-lg">
                                                    {initials}
                                                </AvatarFallback>
                                            </Avatar>
                                            <Button variant="link" className="text-violet-400 p-0 h-auto">
                                                Update profile
                                            </Button>
                                        </div>
                                    </div>
                                </div>

                                {/* Email Section */}
                                <div className="space-y-4">
                                    <span className="text-sm text-muted-foreground">Email addresses</span>
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm">{email}</span>
                                            <Badge variant="secondary" className="text-xs">Primary</Badge>
                                            <Badge
                                                variant={isVerified ? "default" : "outline"}
                                                className="text-xs"
                                            >
                                                {isVerified ? 'Verified' : 'Unverified'}
                                            </Badge>
                                        </div>
                                    </div>
                                    <Button
                                        variant="link"
                                        className="text-violet-400 p-0 h-auto gap-1"
                                    >
                                        <Plus className="h-4 w-4" />
                                        Add email address
                                    </Button>
                                </div>
                            </div>
                        )}

                        {activeTab === 'security' && (
                            <div className="space-y-6">
                                <h3 className="text-lg font-medium">Security</h3>

                                {/* Password Section */}
                                <div className="border-b pb-6">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <span className="text-sm font-medium">Password</span>
                                            <p className="text-sm text-muted-foreground mt-1">
                                                Set a password to secure your account
                                            </p>
                                        </div>
                                        <Button variant="outline" size="sm">
                                            Set password
                                        </Button>
                                    </div>
                                </div>

                                {/* Two-factor Section */}
                                <div className="border-b pb-6">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <span className="text-sm font-medium">Two-factor authentication</span>
                                            <p className="text-sm text-muted-foreground mt-1">
                                                Add an extra layer of security to your account
                                            </p>
                                        </div>
                                        <Button variant="outline" size="sm">
                                            Enable
                                        </Button>
                                    </div>
                                </div>

                                {/* Active Sessions */}
                                <div>
                                    <span className="text-sm font-medium">Active sessions</span>
                                    <p className="text-sm text-muted-foreground mt-1">
                                        Manage your active sessions across devices
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
