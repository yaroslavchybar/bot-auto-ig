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
import { useIsMobile } from '@/hooks/use-mobile'
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
  emptyTitle?: string
  emptyDescription?: string
}

interface ProfileActionsMenuProps {
  profile: Profile
  onDetails: (profile: Profile) => void
  onEdit: (profile: Profile) => void
  onLogs: (profile: Profile) => void
  onLogin: (profile: Profile) => void
  onDelete: (profile: Profile) => void
  onToggleStatus: (profile: Profile) => void
}

function getOsLabel(fingerprintOs?: string) {
  switch ((fingerprintOs ?? '').toLowerCase()) {
    case 'mac':
    case 'macos':
      return 'macOS'
    case 'windows':
    case 'win':
      return 'Windows'
    default:
      return fingerprintOs ? fingerprintOs : 'Windows'
  }
}

function getStatusMeta(profile: Profile) {
  const label = profile.using ? 'ACTIVE' : String(profile.status ?? 'IDLE').toUpperCase()

  if (profile.using) {
    return {
      label,
      className: 'text-green-400 font-bold',
    }
  }

  if (label === 'ERROR' || label === 'FAILED') {
    return {
      label,
      className: 'text-red-400 font-bold',
    }
  }

  return {
    label,
    className: 'text-gray-300',
  }
}

function ProfileActionsMenu({
  profile,
  onDetails,
  onEdit,
  onLogs,
  onLogin,
  onDelete,
  onToggleStatus,
}: ProfileActionsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-8 w-8 p-0 text-gray-400 hover:text-white hover:bg-white/5">
          <span className="sr-only">Open menu</span>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48 bg-[#0f0f0f] border-white/10 text-gray-200">
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
        <DropdownMenuItem onClick={() => onDetails(profile)} className="hover:bg-white/10 focus:bg-white/10 cursor-pointer">
          <Info className="mr-2 h-4 w-4" /> View Details
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
  )
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
  onLogin,
  emptyTitle = 'No profiles',
  emptyDescription = 'Create a new profile to get started.',
}: ProfilesListProps) {
  const isMobile = useIsMobile()

  if (loading && profiles.length === 0) {
    return <div className="p-12 text-center text-sm text-muted-foreground animate-pulse">Loading profiles...</div>
  }

  if (profiles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center border border-dashed rounded-lg bg-muted/5">
        <Monitor className="h-10 w-10 text-muted-foreground/50 mb-4" />
        <h3 className="text-lg font-medium">{emptyTitle}</h3>
        <p className="text-sm text-muted-foreground mt-1">{emptyDescription}</p>
      </div>
    )
  }

  if (isMobile) {
    return (
      <div className="space-y-4">
        {profiles.map((profile) => {
          const osLabel = getOsLabel(profile.fingerprint_os)
          const statusMeta = getStatusMeta(profile)
          const dailyUsage = typeof profile.daily_scraping_limit === 'number'
            ? `${profile.daily_scraping_used ?? 0}/${profile.daily_scraping_limit}`
            : null

          return (
            <div
              key={profile.id}
              className={cn(
                'rounded-2xl border bg-[#141414] p-4 shadow-xs transition-colors',
                selectedId === profile.id ? 'border-orange-500/60 bg-white/[0.04]' : 'border-white/10 hover:border-white/20'
              )}
              onClick={() => onSelect(profile)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-base font-semibold text-gray-100">{profile.name}</h3>
                  <p className="mt-1 truncate font-mono text-[11px] text-gray-500">{profile.id}</p>
                </div>
                <div onClick={(event) => event.stopPropagation()}>
                  <ProfileActionsMenu
                    profile={profile}
                    onDetails={onDetails}
                    onEdit={onEdit}
                    onLogs={onLogs}
                    onLogin={onLogin}
                    onDelete={onDelete}
                    onToggleStatus={onToggleStatus}
                  />
                </div>
              </div>

              <div className="mt-4 space-y-3 text-xs text-gray-400">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-gray-200">
                    <Cpu className="h-3.5 w-3.5" />
                    {osLabel}
                  </div>
                  {profile.login && (
                    <div className="flex items-center gap-1 rounded-md border border-blue-500/20 bg-blue-500/10 px-2 py-1 text-blue-300">
                      <LogIn className="h-3.5 w-3.5" />
                      Auto Login
                    </div>
                  )}
                  {dailyUsage && (
                    <div className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-gray-300">
                      Daily {dailyUsage}
                    </div>
                  )}
                </div>

                <div className="flex items-start gap-2">
                  <Globe className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-500" />
                  <span className="truncate text-gray-300">
                    {profile.proxy ? profile.proxy : 'Direct connection'}
                  </span>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/10 pt-3">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
                    Status
                  </div>
                  <div className={cn('mt-1 text-xs', statusMeta.className)}>
                    {statusMeta.label}
                  </div>
                </div>

                <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-9 rounded-full border border-white/10 px-3 text-gray-200 hover:bg-white/5"
                    onClick={() => onDetails(profile)}
                  >
                    <Info className="h-4 w-4" />
                    Details
                  </Button>
                  <Button
                    size="sm"
                    className={cn(
                      'h-9 rounded-full px-4 text-xs font-semibold tracking-[0.14em]',
                      profile.using
                        ? 'border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500 hover:text-white'
                        : 'border border-orange-500/40 bg-orange-500/10 text-orange-300 hover:bg-orange-500 hover:text-white'
                    )}
                    onClick={() => onToggleStatus(profile)}
                  >
                    {profile.using ? <Square className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
                    {profile.using ? 'STOP' : 'START'}
                  </Button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="bg-white/[0.02] border border-white/[0.05] rounded-2xl backdrop-blur-xs shadow-xs overflow-hidden">
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
                  <div className="flex items-center gap-1 bg-white/5 px-1.5 py-0.5 rounded-sm border border-white/10 text-gray-300">
                    <Cpu className="h-3 w-3" />
                    {profile.fingerprint_os === 'mac' ? 'macOS' : 'Win'}
                  </div>
                  {profile.login && (
                    <div className="flex items-center gap-1 bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded-sm border border-blue-500/20">
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

                  <div onClick={(e) => e.stopPropagation()}>
                    <ProfileActionsMenu
                      profile={profile}
                      onDetails={onDetails}
                      onEdit={onEdit}
                      onLogs={onLogs}
                      onLogin={onLogin}
                      onDelete={onDelete}
                      onToggleStatus={onToggleStatus}
                    />
                  </div>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
