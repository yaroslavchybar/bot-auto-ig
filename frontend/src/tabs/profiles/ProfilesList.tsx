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
import { Badge } from "@/components/ui/badge"
import { MoreHorizontal, Play, Square, Terminal, Pencil, Trash2, LogIn, Info } from "lucide-react"
import type { Profile } from './types'

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
    return <div className="p-8 text-center text-muted-foreground">Loading profiles...</div>
  }

  if (profiles.length === 0) {
    return <div className="p-8 text-center text-muted-foreground">No profiles found. Create one to get started.</div>
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Proxy</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {profiles.map((profile) => (
            <TableRow
              key={profile.id}
              className={`cursor-pointer ${selectedId === profile.id ? "bg-muted/50" : ""}`}
              onClick={() => onSelect(profile)}
            >
              <TableCell className="font-medium">
                <div className="flex flex-col">
                  <span>{profile.name}</span>
                  <span className="text-xs text-muted-foreground">{profile.id}</span>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex gap-2 items-center">
                  <Badge variant={profile.using ? "default" : "secondary"} className={profile.using ? "bg-green-600 hover:bg-green-700" : ""}>
                    {profile.using ? 'Running' : 'Idle'}
                  </Badge>
                  {profile.login && <Badge variant="outline">Login</Badge>}
                </div>
              </TableCell>
              <TableCell>{profile.type}</TableCell>
              <TableCell>
                {profile.proxy ? (
                  <span className="max-w-[150px] truncate block" title={profile.proxy}>
                    {profile.proxy}
                  </span>
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="h-8 w-8 p-0" onClick={(e) => {
                      e.stopPropagation()
                    }}>
                      <span className="sr-only">Open menu</span>
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenuLabel>Actions</DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => onDetails(profile)}>
                      <Info className="mr-2 h-4 w-4" /> More details
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onToggleStatus(profile)}>
                      {profile.using ? (
                        <>
                          <Square className="mr-2 h-4 w-4" /> Stop
                        </>
                      ) : (
                        <>
                          <Play className="mr-2 h-4 w-4" /> Start
                        </>
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onEdit(profile)}>
                      <Pencil className="mr-2 h-4 w-4" /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onLogs(profile)}>
                      <Terminal className="mr-2 h-4 w-4" /> Logs
                    </DropdownMenuItem>
                    {!profile.login && (
                      <>
                        <DropdownMenuItem onClick={() => onLogin(profile)}>
                          <LogIn className="mr-2 h-4 w-4" /> Login Automation
                        </DropdownMenuItem>
                      </>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onDelete(profile)} className="text-destructive focus:text-destructive">
                      <Trash2 className="mr-2 h-4 w-4" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
