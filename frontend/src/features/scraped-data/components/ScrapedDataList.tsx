import { useState } from 'react'
import {
  Download,
  Eye,
  FileSpreadsheet,
  MoreHorizontal,
  Trash2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useIsMobile } from '@/hooks/use-mobile'
import type { WorkflowArtifact } from '../types'
import { formatDateTime, formatNumber, getArtifactRowCount } from '../utils'

interface ScrapedDataListProps {
  artifacts: WorkflowArtifact[]
  loading: boolean
  onViewDetails: (artifact: WorkflowArtifact) => void
  onDownloadData: (artifact: WorkflowArtifact) => void
  onDownloadManifest: (artifact: WorkflowArtifact) => void
  onDelete: (artifact: WorkflowArtifact) => void
  emptyTitle?: string
  emptyDescription?: string
}

interface ArtifactActionsMenuProps {
  artifact: WorkflowArtifact
  onViewDetails: (artifact: WorkflowArtifact) => void
  onDownloadData: (artifact: WorkflowArtifact) => void
  onDownloadManifest: (artifact: WorkflowArtifact) => void
  onDelete: (artifact: WorkflowArtifact) => void
}

function ArtifactActionsMenu({
  artifact,
  onViewDetails,
  onDownloadData,
  onDownloadManifest,
  onDelete,
}: ArtifactActionsMenuProps) {
  const [open, setOpen] = useState(false)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-copy hover:text-ink hover:bg-panel-muted data-[state=open]:bg-panel-muted data-[state=open]:text-ink h-8 w-8"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="panel-dropdown">
        <DropdownMenuItem onClick={() => onViewDetails(artifact)}>
          <Eye className="mr-2 h-4 w-4" />
          View Details
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => onDownloadData(artifact)}
          disabled={!artifact.exportStorageId && !artifact.storageId}
        >
          <Download className="mr-2 h-4 w-4" />
          Download Data
        </DropdownMenuItem>
        {artifact.manifestStorageId ? (
          <DropdownMenuItem onClick={() => onDownloadManifest(artifact)}>
            <Download className="mr-2 h-4 w-4" />
            Download Manifest
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => onDelete(artifact)}
          className="text-status-danger focus:text-status-danger focus:bg-status-danger-soft cursor-pointer"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ScrapedDataList({
  artifacts,
  loading,
  onViewDetails,
  onDownloadData,
  onDownloadManifest,
  onDelete,
  emptyTitle = 'No scraped artifacts',
  emptyDescription = 'Completed workflow scrape results will appear here.',
}: ScrapedDataListProps) {
  const isMobile = useIsMobile()

  if (loading && artifacts.length === 0) {
    return (
      <div className="text-muted-foreground animate-pulse p-12 text-center text-sm">
        Loading scrape artifacts...
      </div>
    )
  }

  if (artifacts.length === 0) {
    return (
      <div className="bg-muted/5 flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
        <FileSpreadsheet className="text-muted-foreground/50 mb-4 h-10 w-10" />
        <h3 className="text-lg font-medium">{emptyTitle}</h3>
        <p className="text-muted-foreground mt-1 text-sm">{emptyDescription}</p>
      </div>
    )
  }

  if (isMobile) {
    return (
      <div className="space-y-4">
        {artifacts.map((artifact) => (
          <div
            key={artifact._id}
            className="bg-panel-strong border-line hover:border-line-strong rounded-2xl border p-4 shadow-xs transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="text-ink truncate text-base font-semibold">
                  {artifact.name || 'Untitled artifact'}
                </h3>
                <p className="text-subtle-copy mt-1 truncate text-[11px]">
                  {artifact.workflowName}
                </p>
              </div>
              <div onClick={(event) => event.stopPropagation()}>
                <ArtifactActionsMenu
                  artifact={artifact}
                  onViewDetails={onViewDetails}
                  onDownloadData={onDownloadData}
                  onDownloadManifest={onDownloadManifest}
                  onDelete={onDelete}
                />
              </div>
            </div>

            <div className="text-muted-copy mt-4 flex flex-wrap items-center gap-2 text-xs">
              <Badge
                variant="outline"
                className="border-line bg-panel-muted text-copy"
              >
                {artifact.kind}
              </Badge>
              {artifact.sourceProfileName && (
                <span className="text-copy truncate">
                  {artifact.sourceProfileName}
                </span>
              )}
            </div>

            <div className="border-line mt-4 flex items-center justify-between gap-3 border-t pt-3">
              <div className="min-w-0">
                <div className="text-subtle-copy text-[11px] font-semibold tracking-[0.18em] uppercase">
                  Rows
                </div>
                <div className="text-copy mt-1 text-xs">
                  {formatNumber(getArtifactRowCount(artifact))}
                </div>
              </div>
              <div className="min-w-0 text-right">
                <div className="text-subtle-copy text-[11px] font-semibold tracking-[0.18em] uppercase">
                  Updated
                </div>
                <div className="text-copy mt-1 text-xs">
                  {formatDateTime(artifact.updatedAt ?? artifact.createdAt ?? null)}
                </div>
              </div>
            </div>
          </div>
        ))}
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
            <TableHead className="text-muted-copy h-12 w-[100px] font-medium">
              Kind
            </TableHead>
            <TableHead className="text-muted-copy h-12 w-[160px] font-medium">
              Source
            </TableHead>
            <TableHead className="text-muted-copy h-12 w-[100px] font-medium">
              Rows
            </TableHead>
            <TableHead className="text-muted-copy h-12 w-[160px] font-medium">
              Updated
            </TableHead>
            <TableHead className="text-muted-copy h-12 w-[100px] pr-4 text-right font-medium">
              Actions
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {artifacts.map((artifact) => (
            <TableRow
              key={artifact._id}
              className="group border-line-soft h-14 border-b transition-colors hover:bg-panel-subtle"
            >
              <TableCell className="pl-4 font-medium">
                <div className="flex flex-col gap-0.5">
                  <span className="text-ink truncate">
                    {artifact.name || 'Untitled artifact'}
                  </span>
                  <span className="text-subtle-copy max-w-[250px] truncate text-[11px]">
                    {artifact.workflowName}
                  </span>
                </div>
              </TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  className="border-line bg-panel-muted text-copy"
                >
                  {artifact.kind}
                </Badge>
              </TableCell>
              <TableCell className="text-copy max-w-[160px] truncate text-sm">
                {artifact.sourceProfileName || '-'}
              </TableCell>
              <TableCell className="text-copy text-sm">
                {formatNumber(getArtifactRowCount(artifact))}
              </TableCell>
              <TableCell className="text-subtle-copy text-sm">
                {formatDateTime(artifact.updatedAt ?? artifact.createdAt ?? null)}
              </TableCell>
              <TableCell className="pr-4 text-right">
                <div
                  className="flex items-center justify-end gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ArtifactActionsMenu
                    artifact={artifact}
                    onViewDetails={onViewDetails}
                    onDownloadData={onDownloadData}
                    onDownloadManifest={onDownloadManifest}
                    onDelete={onDelete}
                  />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
