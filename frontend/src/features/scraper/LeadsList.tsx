import { ExternalLink, Users } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useIsMobile } from '@/hooks/use-mobile'
import type { Id } from '../../../../convex/_generated/dataModel'

type Lead = {
  _id: Id<'leads'>
  username: string
  igId?: string
  fullName?: string
  profilePicDescription?: string
  classification?: 'male' | 'female' | 'business'
  enrichmentStatus?: 'pending' | 'describing' | 'ready' | 'error'
  dmSent: boolean
  followed: boolean
  followDate?: number
  senderName?: string
  createdAt: number
}

function Username({ lead }: { lead: Lead }) {
  return <a href={`https://www.instagram.com/${lead.username}/`} target="_blank" rel="noreferrer" className="brand-link inline-flex items-center gap-2 font-medium">
    @{lead.username}<ExternalLink className="h-3 w-3 shrink-0" />
  </a>
}

const details = (lead: Lead) => [
  ['ID', lead.igId ?? '—'],
  ['Full name', lead.fullName ?? '—'],
  ['Type', lead.classification ?? lead.enrichmentStatus ?? 'pending'],
  ['Picture', lead.profilePicDescription ?? '—'],
  ['DM sent', lead.dmSent ? 'Yes' : 'No'],
  ['Followed', lead.followed ? 'Yes' : 'No'],
  ['Follow date', lead.followDate ? new Date(lead.followDate).toLocaleDateString() : '—'],
  ['Sender', lead.senderName ?? '—'],
  ['Saved', new Date(lead.createdAt).toLocaleDateString()],
]

export function LeadsList({ leads, loading, hasActiveFilter }: { leads: Lead[]; loading: boolean; hasActiveFilter: boolean }) {
  const mobile = useIsMobile()
  if (loading) return <p className="text-muted-copy p-12 text-center">Loading accounts...</p>
  if (!leads.length) return <div className="border-line bg-panel-subtle rounded-2xl border p-12 text-center">
    <Users className="text-subtle-copy mx-auto mb-3 h-8 w-8" />
    <p>{hasActiveFilter ? 'No matching accounts' : 'Add source profiles to start scraping.'}</p>
  </div>
  if (mobile) return <div className="space-y-3">{leads.map(lead => <div key={lead._id} className="bg-panel-strong border-line rounded-2xl border p-4">
    <Username lead={lead} />
    <dl className="mt-3 space-y-2 text-xs">{details(lead).map(([label, value]) => <div key={label} className="flex justify-between gap-3"><dt className="text-subtle-copy">{label}</dt><dd className="truncate">{value}</dd></div>)}</dl>
  </div>)}</div>
  return <div className="bg-panel-subtle border-line overflow-hidden rounded-2xl border"><Table>
    <TableHeader><TableRow>{['Username', 'ID', 'Full name', 'Type', 'Picture', 'DM sent', 'Followed', 'Follow date', 'Sender', 'Saved'].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader>
    <TableBody>{leads.map(lead => <TableRow key={lead._id}><TableCell><Username lead={lead} /></TableCell>{details(lead).map(([label, value]) => <TableCell key={label} title={value} className="max-w-56 truncate text-xs whitespace-nowrap">{value}</TableCell>)}</TableRow>)}</TableBody>
  </Table></div>
}
