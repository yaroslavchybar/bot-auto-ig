import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { useIsMobile } from '@/hooks/use-mobile'
import {
  MoreHorizontal,
  Play,
  Square,
  Terminal,
  Pencil,
  Trash2,
  LogIn,
  Info,
  Monitor,
  Cpu,
  Globe,
} from 'lucide-react'
import type { Profile } from '../types'
import { cn } from '@/lib/utils'

interface ProfilesListProps {
  profiles: Profile[]
  loading: boolean
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
  const label = profile.using
    ? 'ACTIVE'
    : String(profile.status ?? 'IDLE').toUpperCase()

  if (profile.using) {
    return {
      label,
      className: 'text-status-success font-bold',
    }
  }

  if (label === 'ERROR' || label === 'FAILED') {
    return {
      label,
      className: 'text-status-danger font-bold',
    }
  }

  return {
    label,
    className: 'text-copy',
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
        <Button
          variant="ghost"
          className="text-muted-copy hover:bg-panel-muted h-8 w-8 p-0 hover:text-ink"
        >
          <span className="sr-only">Open menu</span>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="panel-dropdown w-48">
        <DropdownMenuLabel className="text-muted-copy">
          Actions
        </DropdownMenuLabel>
        <DropdownMenuItem
          onClick={() => onToggleStatus(profile)}
          className="hover:bg-panel-hover focus:bg-panel-hover cursor-pointer"
        >
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
        <DropdownMenuItem
          onClick={() => onDetails(profile)}
          className="hover:bg-panel-hover focus:bg-panel-hover cursor-pointer"
        >
          <Info className="mr-2 h-4 w-4" /> View Details
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onEdit(profile)}
          className="hover:bg-panel-hover focus:bg-panel-hover cursor-pointer"
        >
          <Pencil className="mr-2 h-4 w-4" /> Edit Configuration
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onLogs(profile)}
          className="hover:bg-panel-hover focus:bg-panel-hover cursor-pointer"
        >
          <Terminal className="mr-2 h-4 w-4" /> View Logs
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-panel-muted" />
        {!profile.login && (
          <DropdownMenuItem
            onClick={() => onLogin(profile)}
            className="hover:bg-panel-hover focus:bg-panel-hover cursor-pointer"
          >
            <LogIn className="mr-2 h-4 w-4" /> Run Login Script
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={() => onDelete(profile)}
          className="text-status-danger focus:text-status-danger focus:bg-status-danger-soft hover:bg-status-danger-soft cursor-pointer"
        >
          <Trash2 className="mr-2 h-4 w-4" /> Delete Profile
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ProfilesList({
  profiles,
  loading,
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
    return (
      <div className="text-muted-foreground animate-pulse p-12 text-center text-sm">
        Loading profiles...
      </div>
    )
  }

  if (profiles.length === 0) {
    return (
      <div className="bg-muted/5 flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
        <Monitor className="text-muted-foreground/50 mb-4 h-10 w-10" />
        <h3 className="text-lg font-medium">{emptyTitle}</h3>
        <p className="text-muted-foreground mt-1 text-sm">{emptyDescription}</p>
      </div>
    )
  }

  if (isMobile) {
    return (
      <div className="space-y-4">
        {profiles.map((profile) => {
          const osLabel = getOsLabel(profile.fingerprint_os)
          const statusMeta = getStatusMeta(profile)
          const dailyUsage =
            typeof profile.daily_scraping_limit === 'number'
              ? `${profile.daily_scraping_used ?? 0}/${profile.daily_scraping_limit}`
              : null

          return (
            <div
              key={profile.id}
              className={cn(
                'bg-panel-strong rounded-2xl border p-4 shadow-xs transition-colors',
                'border-line hover:border-line-strong',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="text-ink truncate text-base font-semibold">
                    {profile.name}
                  </h3>
                  <p className="text-subtle-copy mt-1 truncate font-mono text-[11px]">
                    {profile.id}
                  </p>
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

              <div className="text-muted-copy mt-4 space-y-3 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="border-line bg-panel-muted text-ink flex items-center gap-1 rounded-md border px-2 py-1">
                    <Cpu className="h-3.5 w-3.5" />
                    {osLabel}
                  </div>
                  {profile.login && (
                    <div className="brand-surface brand-text-soft flex items-center gap-1 rounded-md border px-2 py-1">
                      <LogIn className="h-3.5 w-3.5" />
                      Auto Login
                    </div>
                  )}
                  {dailyUsage && (
                    <div className="border-line bg-panel-muted text-copy rounded-md border px-2 py-1">
                      Daily {dailyUsage}
                    </div>
                  )}
                </div>

                <div className="flex items-start gap-2">
                  <Globe className="text-subtle-copy mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="text-copy truncate">
                    {profile.proxy ? profile.proxy : 'Direct connection'}
                  </span>
                </div>
              </div>

              <div className="border-line mt-4 flex items-center justify-between gap-3 border-t pt-3">
                <div className="min-w-0">
                  <div className="text-subtle-copy text-[11px] font-semibold tracking-[0.18em] uppercase">
                    Status
                  </div>
                  <div className={cn('mt-1 text-xs', statusMeta.className)}>
                    {statusMeta.label}
                  </div>
                </div>

                <div
                  className="flex items-center gap-2"
                  onClick={(event) => event.stopPropagation()}
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    className="border-line text-ink hover:bg-panel-muted h-9 rounded-full border px-3"
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
                        ? 'border-status-danger-border bg-status-danger-soft text-status-danger hover:bg-status-danger hover:text-inverse border'
                        : 'border-status-success-border bg-status-success-soft text-status-success hover:bg-status-success hover:text-inverse border',
                    )}
                    onClick={() => onToggleStatus(profile)}
                  >
                    {profile.using ? (
                      <Square className="h-4 w-4 fill-current" />
                    ) : (
                      <Play className="h-4 w-4 fill-current" />
                    )}
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
    <div className="bg-panel-subtle border-line-soft overflow-hidden rounded-2xl border shadow-xs backdrop-blur-xs">
      <Table>
        <TableHeader>
          <TableRow className="border-line-soft border-b bg-transparent hover:bg-transparent">
            <TableHead className="text-muted-copy h-12 w-[300px] pl-4 font-medium">
              Name
            </TableHead>
            <TableHead className="text-muted-copy h-12 w-[120px] font-medium">
              Status
            </TableHead>
            <TableHead className="text-muted-copy h-12 w-[180px] font-medium">
              Config
            </TableHead>
            <TableHead className="text-muted-copy h-12 font-medium">
              Proxy
            </TableHead>
            <TableHead className="text-muted-copy h-12 w-[140px] pr-4 text-right font-medium">
              Actions
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {profiles.map((profile) => (
            <TableRow
              key={profile.id}
              className={cn(
                'group border-line-soft h-14 border-b transition-colors hover:bg-panel-subtle',
              )}
            >
              <TableCell className="pl-4 font-medium">
                <div className="flex flex-col gap-0.5">
                  <span className="text-ink truncate">{profile.name}</span>
                  <span className="text-subtle-copy max-w-[200px] truncate font-mono text-[10px]">
                    {profile.id}
                  </span>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      'flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium',
                      profile.using
                        ? 'status-glow-success bg-status-success-soft text-status-success border-status-success-border'
                        : 'bg-panel-muted text-copy border-line',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-1.5 w-1.5 rounded-full',
                        profile.using
                          ? 'status-dot-success-tight'
                          : 'bg-subtle-copy',
                      )}
                    />
                    {profile.using ? 'Active' : 'Idle'}
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <div className="text-subtle-copy flex items-center gap-2 text-xs">
                  <div className="bg-panel-muted border-line text-copy flex items-center gap-1 rounded-sm border px-1.5 py-0.5">
                    <Cpu className="h-3 w-3" />
                    {profile.fingerprint_os === 'mac' ? 'macOS' : 'Win'}
                  </div>
                  {profile.login && (
                    <div className="brand-surface brand-text flex items-center gap-1 rounded-sm border px-1.5 py-0.5">
                      <LogIn className="h-3 w-3" />
                      <span className="hidden sm:inline">Auto-Login</span>
                    </div>
                  )}
                </div>
              </TableCell>
              <TableCell>
                {profile.proxy ? (
                  <div
                    className="text-muted-copy flex max-w-[200px] items-center gap-1.5 text-xs"
                    title={profile.proxy}
                  >
                    <Globe className="h-3 w-3 shrink-0" />
                    <span className="truncate font-mono">{profile.proxy}</span>
                  </div>
                ) : (
                  <span className="text-subtle-copy/50 text-xs">-</span>
                )}
              </TableCell>
              <TableCell className="pr-4 text-right">
                <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-copy hover:bg-panel-muted h-8 w-8 hover:text-ink"
                    onClick={(e) => {
                      e.stopPropagation()
                      onToggleStatus(profile)
                    }}
                    title={profile.using ? 'Stop Browser' : 'Start Browser'}
                  >
                    {profile.using ? (
                      <Square className="h-4 w-4 fill-current" />
                    ) : (
                      <Play className="h-4 w-4 fill-current" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-copy hover:bg-panel-muted h-8 w-8 hover:text-ink"
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


