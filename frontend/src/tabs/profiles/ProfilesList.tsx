import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { MoreHorizontal, Play, Square, Terminal, Pencil, Trash2, LogIn, Info, Monitor, Cpu, Globe } from "lucide-react"
import type { Profile } from './types'
import { cn } from "@/lib/utils"

interface ProfilesListProps {
  profiles: Profile[]
  selectedId: string | null
  loading: boolean
  onSelect: (profile: Profile) => void
  onDetails: (profile: Profile) => void
  onEdit: (profile: Profile) => void
  onDelete: (profile: Profile) => void
  onLogs: (profile: Profile) => void
  onToggleStatus: (profile: Profile) => void
  onLogin: (profile: Profile) => void
}

export function ProfilesList({
  profiles,
  selectedId,
  loading,
  onSelect,
  onDetails,
  onEdit,
  onDelete,
  onLogs,
  onToggleStatus,
  onLogin
}: ProfilesListProps) {
  if (loading && profiles.length === 0) {
    return <div className="p-12 text-center text-sm text-muted-foreground animate-pulse">Loading profiles...</div>
  }

  if (profiles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center border border-dashed rounded-lg bg-muted/5">
        <Monitor className="h-10 w-10 text-muted-foreground/50 mb-4" />
        <h3 className="text-lg font-medium">No profiles</h3>
        <p className="text-sm text-muted-foreground mt-1">Create a new profile to get started.</p>
      </div>
    )
  }

  return (
    <div className="bg-white/[0.02] border border-white/[0.05] rounded-2xl backdrop-blur-sm shadow-sm overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-transparent hover:bg-transparent border-b border-white/[0.05]">
            <TableHead className="w-[300px] pl-4 text-gray-400 font-medium h-12">Name</TableHead>
            <TableHead className="w-[120px] text-gray-400 font-medium h-12">Status</TableHead>
            <TableHead className="w-[180px] text-gray-400 font-medium h-12">Config</TableHead>
            <TableHead className="text-gray-400 font-medium h-12">Proxy</TableHead>
            <TableHead className="w-[140px] text-right pr-4 text-gray-400 font-medium h-12">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {profiles.map((profile) => (
            <TableRow
              key={profile.id}
              className={cn(
                "group cursor-pointer transition-colors h-14 border-b border-white/[0.05]",
                selectedId === profile.id ? "bg-white/[0.04]" : "hover:bg-white/[0.02]"
              )}
              onClick={() => onSelect(profile)}
            >
              <TableCell className="font-medium pl-4">
                <div className="flex flex-col gap-0.5">
                  <span className="truncate text-gray-200">{profile.name}</span>
                  <span className="text-[10px] text-gray-500 font-mono truncate max-w-[200px]">
                    {profile.id}
                  </span>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <div className={cn(
                    "flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-xs font-medium",
                    profile.using
                      ? "bg-green-500/10 text-green-400 border-green-500/20 shadow-[0_0_10px_rgba(34,197,94,0.2)]"
                      : "bg-white/5 text-gray-300 border-white/10"
                  )}>
                    <span
                      className={cn(
                        "flex h-1.5 w-1.5 rounded-full",
                        profile.using ? "bg-green-400 shadow-[0_0_4px_rgba(34,197,94,0.8)]" : "bg-gray-400"
                      )}
                    />
                    {profile.using ? 'Active' : 'Idle'}
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <div className="flex items-center gap-1 bg-white/5 px-1.5 py-0.5 rounded border border-white/10 text-gray-300">
                    <Cpu className="h-3 w-3" />
                    {profile.fingerprint_os === 'mac' ? 'macOS' : 'Win'}
                  </div>
                  {profile.login && (
                    <div className="flex items-center gap-1 bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded border border-blue-500/20">
                      <LogIn className="h-3 w-3" />
                      <span className="hidden sm:inline">Auto-Login</span>
                    </div>
                  )}
                </div>
              </TableCell>
              <TableCell>
                {profile.proxy ? (
                  <div className="flex items-center gap-1.5 text-xs text-gray-400 max-w-[200px]" title={profile.proxy}>
                    <Globe className="h-3 w-3 shrink-0" />
                    <span className="truncate font-mono">{profile.proxy}</span>
                  </div>
                ) : (
                  <span className="text-xs text-gray-500/50">-</span>
                )}
              </TableCell>
              <TableCell className="text-right pr-4">
                <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-gray-400 hover:text-white hover:bg-white/5"
                    onClick={(e) => {
                      e.stopPropagation()
                      onToggleStatus(profile)
                    }}
                    title={profile.using ? "Stop Browser" : "Start Browser"}
                  >
                    {profile.using ? <Square className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-gray-400 hover:text-white hover:bg-white/5"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDetails(profile)
                    }}
                    title="Details"
                  >
                    <Info className="h-4 w-4" />
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" className="h-8 w-8 p-0 text-gray-400 hover:text-white hover:bg-white/5" onClick={(e) => e.stopPropagation()}>
                        <span className="sr-only">Open menu</span>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48 bg-[#0f0f0f] border-white/10 text-gray-200" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenuLabel className="text-gray-400">Actions</DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => onToggleStatus(profile)} className="hover:bg-white/10 focus:bg-white/10 cursor-pointer">
                        {profile.using ? (
                          <>
                            <Square className="mr-2 h-4 w-4" /> Stop Browser
                          </>
                        ) : (
                          <>
                            <Play className="mr-2 h-4 w-4" /> Start Browser
                          </>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onEdit(profile)} className="hover:bg-white/10 focus:bg-white/10 cursor-pointer">
                        <Pencil className="mr-2 h-4 w-4" /> Edit Configuration
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onLogs(profile)} className="hover:bg-white/10 focus:bg-white/10 cursor-pointer">
                        <Terminal className="mr-2 h-4 w-4" /> View Logs
                      </DropdownMenuItem>
                      <DropdownMenuSeparator className="bg-white/5" />
                      {!profile.login && (
                        <DropdownMenuItem onClick={() => onLogin(profile)} className="hover:bg-white/10 focus:bg-white/10 cursor-pointer">
                          <LogIn className="mr-2 h-4 w-4" /> Run Login Script
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => onDelete(profile)} className="text-red-400 focus:text-red-400 focus:bg-red-500/10 hover:bg-red-500/10 cursor-pointer">
                        <Trash2 className="mr-2 h-4 w-4" /> Delete Profile
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
