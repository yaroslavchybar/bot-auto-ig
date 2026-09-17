import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import {
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Download,
  FileArchive,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  File as FileIcon,
  Folder,
  Inbox,
  LayoutGrid,
  List as ListIcon,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ConfirmDeleteDialog } from '@/components/shared/ConfirmDeleteDialog'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { useFiles, type FilesState } from './hooks/useFiles'
import type { FileEntry } from './types'

export function FilesPage() {
  const state = useFiles()
  const { clearSelection } = state

  // Escape clears the selection (outside text inputs).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      clearSelection()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [clearSelection])

  return (
    <div className="bg-shell text-ink animate-in fade-in relative flex h-full min-h-0 flex-col duration-300">
      <div className="flex min-h-0 flex-1 gap-0">
        <FilesSidebar state={state} />
        <div className="flex min-w-0 flex-1 flex-col">
          <FilesToolbar state={state} />
          <FilesSelectionBar state={state} />
          <FilesMain state={state} />
          <FilesStatusBar state={state} />
        </div>
      </div>
      <FilesDialogs state={state} />
    </div>
  )
}

// Finder-style selection: plain click selects one, Cmd/Ctrl-click
// toggles, Shift-click extends from the anchor.
function handleSelectClick(state: FilesState, e: MouseEvent, name: string) {
  if (e.shiftKey) state.selectRange(name)
  else if (e.metaKey || e.ctrlKey) state.toggleOne(name)
  else state.selectOne(name)
}

// Keyboard parity for mouse activation: Enter opens a folder (or
// renames a file, like Finder), Space toggles selection.
function handleEntryKeyDown(
  state: FilesState,
  e: ReactKeyboardEvent,
  entry: FileEntry,
) {
  // Let focused controls (checkbox, row buttons) handle their own keys.
  const target = e.target as HTMLElement | null
  if (target && target.closest('button, input, a, [role="checkbox"]')) return
  if (e.key === 'Enter') {
    e.preventDefault()
    if (entry.isDir) {
      state.openFolder(entry.name)
    } else {
      state.selectOne(entry.name)
      FilesDialogEvents.openRename(entry.name)
    }
  } else if (e.key === ' ') {
    e.preventDefault()
    state.toggleOne(entry.name)
  }
}

/* ── Sidebar (Finder favorites + storage meter) ── */

const ROOT_ICONS: Record<string, typeof Inbox> = {
  general: Inbox,
  profiles: Users,
}

function FilesSidebar({ state }: { state: FilesState }) {
  const usedPercent = state.usage?.usedPercent ?? 0
  return (
    <aside className="border-line-soft bg-panel-subtle hidden w-56 shrink-0 flex-col border-r md:flex">
      <div className="px-3 pt-4 pb-2">
        <p className="text-muted-copy/80 px-1 text-[10px] font-medium tracking-widest uppercase">
          Favorites
        </p>
        <nav className="mt-1 space-y-0.5">
          {state.roots.map((root) => {
            const Icon = ROOT_ICONS[root.kind] ?? Inbox
            const active = state.loc.root === root.id
            return (
              <button
                key={root.id}
                type="button"
                onClick={() => state.openRoot(root.id)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors',
                  active
                    ? 'bg-panel-selected text-ink font-medium'
                    : 'text-muted-copy hover:text-ink hover:bg-panel-subtle',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{root.label}</span>
              </button>
            )
          })}
        </nav>
      </div>
      <div className="mt-auto border-t border-line-soft p-3">
        <p className="text-muted-copy/80 px-1 text-[10px] font-medium tracking-widest uppercase">
          Storage
        </p>
        <div className="mt-2 px-1">
          <div className="bg-field-alt h-1.5 overflow-hidden rounded-full">
            <div
              className={cn(
                'h-full rounded-full transition-all',
                usedPercent > 90 ? 'bg-status-danger' : 'bg-primary',
              )}
              style={{ width: `${Math.min(100, usedPercent)}%` }}
            />
          </div>
          <p className="text-subtle-copy mt-1.5 text-[11px] leading-tight">
            {state.usage
              ? `${formatBytes(state.usage.free)} free of ${formatBytes(state.usage.total)}`
              : 'Checking disk…'}
          </p>
          {state.usage ? (
            <p className="text-subtle-copy mt-0.5 text-[11px]">
              {state.usage.uploadsCount} files · {formatBytes(state.usage.uploadsBytes)} in Uploads
            </p>
          ) : null}
        </div>
      </div>
    </aside>
  )
}

/* ── Toolbar: nav, breadcrumb, search, view, actions ── */

function FilesToolbar({ state }: { state: FilesState }) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const rootLabel =
    state.roots.find((r) => r.id === state.loc.root)?.label ?? 'Files'
  return (
    <div className="border-line-soft bg-panel-subtle flex-none border-b">
      {/* Mobile roots */}
      <div className="flex gap-1.5 overflow-x-auto px-3 pt-2 md:hidden">
        {state.roots.map((root) => (
          <button
            key={root.id}
            type="button"
            onClick={() => state.openRoot(root.id)}
            className={cn(
              'shrink-0 rounded-full border px-3 py-1 text-xs',
              state.loc.root === root.id
                ? 'border-transparent brand-button font-medium'
                : 'border-line bg-panel text-muted-copy',
            )}
          >
            {root.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5 px-3 py-2 md:px-4">
        <div className="flex shrink-0 items-center">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={!state.canBack}
            onClick={state.goBack}
            title="Back"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={!state.canForward}
            onClick={state.goForward}
            title="Forward"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={!state.canUp}
            onClick={state.goUp}
            title="Up one folder"
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={state.refresh}
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Breadcrumb path */}
        <nav
          aria-label="Path"
          className="bg-field border-line flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto rounded-md border px-2 py-1 text-[13px] shadow-sm"
        >
          <BreadcrumbButton
            label={rootLabel}
            active={state.segments.length === 0}
            onClick={() => state.openPathIndex(-1)}
          />
          {state.segments.map((part, i) => (
            <span key={`${i}-${part}`} className="flex shrink-0 items-center gap-0.5">
              <span className="text-subtle-copy">/</span>
              <BreadcrumbButton
                label={part}
                active={i === state.segments.length - 1}
                onClick={() => state.openPathIndex(i)}
              />
            </span>
          ))}
        </nav>

        <div className="relative hidden w-44 shrink-0 lg:block">
          <Search className="text-muted-copy pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2" />
          <Input
            value={state.search}
            onChange={(e) => state.setSearch(e.target.value)}
            placeholder="Search"
            className="bg-field border-line brand-focus h-8 rounded-md pr-2 pl-8 text-[13px]"
          />
        </div>

        <div className="bg-field border-line hidden shrink-0 items-center rounded-md border p-0.5 sm:flex">
          <ViewButton
            active={state.view === 'list'}
            onClick={() => state.setView('list')}
            title="List view"
          >
            <ListIcon className="h-3.5 w-3.5" />
          </ViewButton>
          <ViewButton
            active={state.view === 'grid'}
            onClick={() => state.setView('grid')}
            title="Icon view"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </ViewButton>
        </div>

        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = e.target.files
            e.target.value = ''
            if (files && files.length > 0) void state.uploadFiles(files)
          }}
        />
        <Button
          variant="outline"
          size="sm"
          className="h-8 shrink-0"
          onClick={() => inputRef.current?.click()}
          disabled={state.uploading}
          title="Upload files to this folder"
        >
          <Upload className="mr-1.5 h-3.5 w-3.5" />
          <span className="hidden xl:inline">
            {state.uploading ? 'Uploading…' : 'Upload'}
          </span>
        </Button>
        <Button
          size="sm"
          className="brand-button h-8 shrink-0 font-medium"
          onClick={() => FilesDialogEvents.openNewFolder()}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          <span className="hidden xl:inline">New Folder</span>
        </Button>
      </div>
      {/* Mobile search */}
      <div className="px-3 pb-2 lg:hidden">
        <div className="relative">
          <Search className="text-muted-copy pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2" />
          <Input
            value={state.search}
            onChange={(e) => state.setSearch(e.target.value)}
            placeholder="Search in folder"
            className="bg-field border-line brand-focus h-8 rounded-md pr-2 pl-8 text-[13px]"
          />
        </div>
      </div>
    </div>
  )
}

function BreadcrumbButton({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'max-w-40 truncate rounded px-1.5 py-0.5 whitespace-nowrap',
        active ? 'text-ink font-medium' : 'text-muted-copy hover:text-ink hover:bg-panel-hover',
      )}
      title={label}
    >
      {label}
    </button>
  )
}

function ViewButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  title: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'rounded p-1.5 transition-colors',
        active ? 'bg-panel-selected text-ink shadow-xs' : 'text-muted-copy hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

/* ── Bulk selection bar ── */

function FilesSelectionBar({ state }: { state: FilesState }) {
  const count = state.selected.length
  if (count < 2) return null
  const fileNames = state.selectedEntries
    .filter((e) => !e.isDir)
    .map((e) => e.name)
  return (
    <div className="border-line-soft bg-panel-selected flex flex-none items-center gap-2 border-b px-3 py-1.5 text-xs md:px-4">
      <span className="text-ink font-medium">{count} selected</span>
      <span className="text-subtle-copy tabular-nums">{formatBytes(state.selectedSize)}</span>
      <span className="ml-auto flex items-center gap-1">
        {fileNames.length > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7"
            onClick={() => void state.downloadEntries(fileNames)}
            title="Download selected files"
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Download
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          className="text-status-danger hover:text-status-danger h-7"
          onClick={() => FilesDialogEvents.openDeleteMany(state.selected)}
          title="Delete selected"
        >
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          Delete
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7"
          onClick={state.clearSelection}
        >
          Clear
        </Button>
      </span>
    </div>
  )
}

/* ── Main listing ── */

function FilesMain({ state }: { state: FilesState }) {
  if (state.loading) {
    return (
      <div className="min-h-0 flex-1 overflow-auto p-3 md:p-4">
        <div className="space-y-1.5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-field-alt h-10 animate-pulse rounded-lg" />
          ))}
        </div>
      </div>
    )
  }

  if (state.error) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <div className="bg-panel border-line max-w-sm rounded-2xl border p-6 text-center shadow-xs">
          <p className="text-ink text-sm font-medium">Could not load folder</p>
          <p className="text-subtle-copy mt-1 text-xs">{state.error}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={state.refresh}>
            Try Again
          </Button>
        </div>
      </div>
    )
  }

  if (state.entries.length === 0) {
    const filtering = state.search.trim() !== ''
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <div className="text-center">
          <Folder className="text-subtle-copy mx-auto h-10 w-10" strokeWidth={1.25} />
          <p className="text-ink mt-3 text-sm font-medium">
            {filtering ? 'No matches' : 'Folder is empty'}
          </p>
          <p className="text-subtle-copy mt-1 text-xs">
            {filtering
              ? 'Try a different search.'
              : 'Upload files or create a new folder.'}
          </p>
        </div>
      </div>
    )
  }

  return state.view === 'list' ? (
    <FilesListView state={state} />
  ) : (
    <FilesGridView state={state} />
  )
}

function FilesListView({ state }: { state: FilesState }) {
  const allSelected =
    state.entries.length > 0 &&
    state.entries.every((e) => state.selected.includes(e.name))
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead className="bg-panel-subtle sticky top-0 z-10">
          <tr className="border-line-soft border-b text-left">
            <th className="w-9 pl-3 md:pl-4">
              <Checkbox
                checked={allSelected}
                onCheckedChange={() => {
                  if (allSelected) state.clearSelection()
                  else state.selectAll()
                }}
                aria-label="Select all"
                className="my-2 h-4 w-4"
              />
            </th>
            <SortHeader label="Name" sortKey="name" state={state} />
            <SortHeader label="Kind" sortKey="kind" state={state} className="hidden w-36 md:table-cell" />
            <SortHeader label="Size" sortKey="size" state={state} className="hidden w-24 text-right sm:table-cell" />
            <SortHeader label="Modified" sortKey="mtime" state={state} className="hidden w-40 lg:table-cell" />
            <th className="w-28 pr-3 md:pr-4">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {state.entries.map((entry) => {
            const isSelected = state.selected.includes(entry.name)
            return (
              <tr
                key={entry.name}
                tabIndex={0}
                aria-selected={isSelected}
                aria-label={`${entry.kind}: ${entry.name}${entry.isDir ? '. Press Enter to open.' : ''}`}
                onClick={(e) => handleSelectClick(state, e, entry.name)}
                onKeyDown={(e) => handleEntryKeyDown(state, e, entry)}
                onDoubleClick={() => {
                  if (entry.isDir) state.openFolder(entry.name)
                }}
                className={cn(
                  'border-line-soft group cursor-default border-b transition-colors outline-none select-none focus-visible:bg-panel-subtle',
                  isSelected ? 'bg-panel-selected' : 'hover:bg-panel-subtle',
                )}
              >
                <td className="w-9 pl-3 md:pl-4" onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => state.toggleOne(entry.name)}
                    aria-label={`Select ${entry.name}`}
                    className="my-2 h-4 w-4"
                  />
                </td>
                <td className="max-w-0 py-1.5 pr-2">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <EntryIcon entry={entry} />
                    <span className="truncate">{entry.name}</span>
                  </span>
                </td>
                <td className="text-subtle-copy hidden w-36 pr-2 whitespace-nowrap md:table-cell">
                  {entry.kind}
                </td>
                <td className="text-subtle-copy hidden w-24 pr-2 text-right whitespace-nowrap tabular-nums sm:table-cell">
                  {entry.isDir ? '—' : formatBytes(entry.size)}
                </td>
                <td className="text-subtle-copy hidden w-40 pr-2 whitespace-nowrap tabular-nums lg:table-cell">
                  {formatDate(entry.mtime)}
                </td>
                <td className="pr-3 md:pr-4">
                  <RowActions entry={entry} state={state} compact />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function SortHeader({
  label,
  sortKey,
  state,
  className,
}: {
  label: string
  sortKey: 'name' | 'size' | 'mtime' | 'kind'
  state: FilesState
  className?: string
}) {
  const active = state.sort.key === sortKey
  return (
    <th className={cn('px-2 py-2 font-medium', className)}>
      <button
        type="button"
        onClick={() => state.toggleSort(sortKey)}
        className={cn(
          'text-[11px] tracking-wide uppercase',
          active ? 'text-ink' : 'text-muted-copy hover:text-ink',
        )}
      >
        {label}
        {active ? (state.sort.dir === 1 ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  )
}

function FilesGridView({ state }: { state: FilesState }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto p-3 md:p-4">
      <div
        role="listbox"
        aria-label="Files"
        aria-multiselectable
        className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2"
      >
        {state.entries.map((entry) => {
          const isSelected = state.selected.includes(entry.name)
          return (
            <div
              key={entry.name}
              role="option"
              tabIndex={0}
              aria-selected={isSelected}
              aria-label={`${entry.kind}: ${entry.name}${entry.isDir ? '. Press Enter to open.' : ''}`}
              onClick={(e) => handleSelectClick(state, e, entry.name)}
              onKeyDown={(e) => handleEntryKeyDown(state, e, entry)}
              onDoubleClick={() => {
                if (entry.isDir) state.openFolder(entry.name)
              }}
              className={cn(
                'group relative flex cursor-default flex-col items-center gap-1.5 rounded-xl border p-3 text-center outline-none select-none focus-visible:bg-panel-subtle',
                isSelected
                  ? 'border-transparent bg-panel-selected'
                  : 'border-transparent hover:bg-panel-subtle',
              )}
              title={entry.name}
            >
              <span
                className={cn(
                  'absolute top-2 left-2',
                  isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
                )}
                onClick={(e) => e.stopPropagation()}
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => state.toggleOne(entry.name)}
                  aria-label={`Select ${entry.name}`}
                  className="h-4 w-4 bg-panel"
                />
              </span>
              <EntryIcon entry={entry} large />
              <span className="line-clamp-2 w-full text-xs break-words">{entry.name}</span>
              <span className="text-subtle-copy text-[11px] tabular-nums">
                {entry.isDir ? entry.kind : formatBytes(entry.size)}
              </span>
              <RowActions entry={entry} state={state} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function EntryIcon({ entry, large }: { entry: FileEntry; large?: boolean }) {
  const cls = large ? 'h-9 w-9' : 'h-[18px] w-[18px] shrink-0'
  if (entry.isDir) return <Folder className={cn(cls, 'text-amber-500')} fill="currentColor" strokeWidth={1} />
  switch (entry.kind) {
    case 'Image':
      return <FileImage className={cn(cls, 'text-subtle-copy')} strokeWidth={1.5} />
    case 'Video':
      return <FileVideo className={cn(cls, 'text-subtle-copy')} strokeWidth={1.5} />
    case 'Audio':
      return <FileAudio className={cn(cls, 'text-subtle-copy')} strokeWidth={1.5} />
    case 'Archive':
      return <FileArchive className={cn(cls, 'text-subtle-copy')} strokeWidth={1.5} />
    case 'Text':
    case 'PDF':
      return <FileText className={cn(cls, 'text-subtle-copy')} strokeWidth={1.5} />
    default:
      return <FileIcon className={cn(cls, 'text-subtle-copy')} strokeWidth={1.5} />
  }
}

function RowActions({
  entry,
  state,
  compact,
}: {
  entry: FileEntry
  state: FilesState
  compact?: boolean
}) {
  return (
    <span
      className={cn(
        'flex items-center justify-end gap-0.5',
        compact && 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
        state.selected.includes(entry.name) && compact && 'opacity-100',
      )}
    >
      {!entry.isDir ? (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title={`Download ${entry.name}`}
          onClick={(e) => {
            e.stopPropagation()
            void state.downloadEntry(entry.name)
          }}
        >
          <Download className="h-3.5 w-3.5" />
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        title={`Rename ${entry.name}`}
        onClick={(e) => {
          e.stopPropagation()
          state.selectOne(entry.name)
          FilesDialogEvents.openRename(entry.name)
        }}
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="text-status-danger hover:text-status-danger h-7 w-7"
        title={`Delete ${entry.name}`}
        onClick={(e) => {
          e.stopPropagation()
          state.selectOne(entry.name)
          FilesDialogEvents.openDelete(entry.name)
        }}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </span>
  )
}

/* ── Status bar ── */

function FilesStatusBar({ state }: { state: FilesState }) {
  const selectedCount = state.selected.length
  const firstSelected = state.selected[0]
  const selectedEntry = firstSelected
    ? state.entries.find((e) => e.name === firstSelected)
    : undefined
  const currentRoot = state.roots.find((r) => r.id === state.loc.root)
  const idleHint =
    currentRoot?.kind === 'profiles'
      ? 'Each profile only sees its own folder in the remote file dialog'
      : 'Move files into a profile folder to use them in its remote browser'
  const statusText =
    selectedCount === 0
      ? state.uploading
        ? 'Uploading…'
        : idleHint
      : selectedCount === 1 && selectedEntry
        ? selectedEntry.isDir
          ? `${selectedEntry.name} · Folder`
          : `${selectedEntry.name} · ${formatBytes(selectedEntry.size)}`
        : `${selectedCount} selected · ${formatBytes(state.selectedSize)}`
  return (
    <div className="border-line-soft bg-panel-subtle text-subtle-copy flex flex-none items-center justify-between gap-2 border-t px-3 py-1.5 text-[11px] tabular-nums md:px-4">
      <span>
        {state.totalCount === 1 ? '1 item' : `${state.totalCount} items`}
        {state.search.trim()
          ? ` · ${state.entries.length} shown`
          : ''}
      </span>
      <span className="truncate">
        {statusText}
      </span>
    </div>
  )
}

/* ── Dialogs (event-bus so row actions can open them) ── */

type DialogRequest =
  | { kind: 'new-folder' }
  | { kind: 'rename'; name: string }
  | { kind: 'delete'; names: string[] }
  | null

// Tiny event bus: row action buttons live deep in the table but the
// dialog state lives here at the page root.
const FilesDialogEvents = {
  listeners: new Set<(req: NonNullable<DialogRequest>) => void>(),
  emit(req: NonNullable<DialogRequest>) {
    for (const fn of this.listeners) fn(req)
  },
  openNewFolder() {
    this.emit({ kind: 'new-folder' })
  },
  openRename(name: string) {
    this.emit({ kind: 'rename', name })
  },
  openDelete(name: string) {
    this.emit({ kind: 'delete', names: [name] })
  },
  openDeleteMany(names: string[]) {
    this.emit({ kind: 'delete', names: [...names] })
  },
}

function FilesDialogs({ state }: { state: FilesState }) {
  const [request, setRequest] = useState<DialogRequest>(null)
  const [draft, setDraft] = useState('')
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  // Subscribe to row-action opens.
  useEffect(() => {
    const fn = (req: NonNullable<DialogRequest>) => {
      setDialogError(null)
      setDraft(req.kind === 'rename' ? req.name : '')
      setRequest(req)
    }
    FilesDialogEvents.listeners.add(fn)
    return () => {
      FilesDialogEvents.listeners.delete(fn)
    }
  }, [])

  const close = () => {
    if (working || state.saving) return
    setRequest(null)
    setDialogError(null)
  }

  const submitName = async () => {
    if (!request || (request.kind !== 'new-folder' && request.kind !== 'rename')) return
    setWorking(true)
    setDialogError(null)
    try {
      if (request.kind === 'new-folder') {
        await state.mkdir(draft)
      } else {
        await state.renameEntry(request.name, draft)
      }
      setRequest(null)
    } catch (e) {
      setDialogError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setWorking(false)
    }
  }

  const confirmDelete =
    request?.kind === 'delete'
      ? async () => {
          setWorking(true)
          setDialogError(null)
          try {
            await state.removeEntries(request.names)
            setRequest(null)
          } catch (e) {
            const message = e instanceof Error ? e.message : 'Could not delete'
            // Confirm dialog shows its own error slot.
            toast.error(message)
            setRequest(null)
          } finally {
            setWorking(false)
          }
        }
      : null

  const deleteInfo = getDeleteInfo(request, state)

  return (
    <>
      <Dialog
        open={request?.kind === 'new-folder' || request?.kind === 'rename'}
        onOpenChange={(open) => {
          if (!open) close()
        }}
      >
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="page-title-gradient">
              {request?.kind === 'rename' ? 'Rename' : 'New Folder'}
            </DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={request?.kind === 'rename' ? 'Name' : 'Untitled Folder'}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitName()
            }}
          />
          {dialogError ? (
            <p className="text-status-danger text-xs" role="alert">
              {dialogError}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={working}>
              Cancel
            </Button>
            <Button
              className="brand-button font-medium"
              onClick={() => void submitName()}
              disabled={working || !draft.trim()}
            >
              {working
                ? 'Saving…'
                : request?.kind === 'rename'
                  ? 'Rename'
                  : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {request?.kind === 'delete' && confirmDelete && deleteInfo ? (
        <ConfirmDeleteDialog
          open
          title={deleteInfo.title}
          entityLabel={deleteInfo.entityLabel}
          itemName={deleteInfo.itemName}
          confirmLabel={deleteInfo.confirmLabel}
          saving={working || state.saving}
          error={dialogError}
          onConfirm={() => void confirmDelete()}
          onCancel={close}
        />
      ) : null}
    </>
  )
}

function getDeleteInfo(
  request: DialogRequest,
  state: FilesState,
): { title: string; entityLabel: string; itemName: string; confirmLabel: string } | null {
  if (request?.kind !== 'delete') return null
  const names = request.names
  if (names.length === 1) {
    const name = names[0] ?? ''
    const entry = state.entries.find((e) => e.name === name)
    const isDir = entry?.isDir ?? false
    return {
      title: isDir ? 'Delete Folder?' : 'Delete File?',
      entityLabel: isDir ? 'and its contents' : '',
      itemName: name,
      confirmLabel: isDir ? 'Delete Folder' : 'Delete File',
    }
  }
  const preview = names.slice(0, 3).join(', ')
  const rest = names.length - 3
  return {
    title: `Delete ${names.length} items?`,
    entityLabel: 'and folder contents',
    itemName: rest > 0 ? `${preview} and ${rest} more` : preview,
    confirmLabel: `Delete ${names.length} items`,
  }
}

/* ── Formatting ── */

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatDate(mtime: number): string {
  try {
    return new Date(mtime).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return '—'
  }
}
