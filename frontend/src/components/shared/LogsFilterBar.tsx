import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Filter,
  Clock,
  ArrowDownToLine,
  Bug,
  Hash,
  Type,
} from 'lucide-react'
import type { LogLevel } from './useLogsState'

interface LogsFilterBarProps {
  filterQuery: string
  onFilterQueryChange: (value: string) => void
  levelFilter: LogLevel
  onLevelFilterChange: (value: LogLevel) => void
  showTime: boolean
  onToggleTime: () => void
  showSource: boolean
  onToggleSource: () => void
  showProfile: boolean
  onToggleProfile: () => void
  autoScroll: boolean
  onToggleAutoScroll: () => void
  feedDebugOnly: boolean
  onToggleFeedDebug: () => void
}

export function LogsFilterBar({
  filterQuery,
  onFilterQueryChange,
  levelFilter,
  onLevelFilterChange,
  showTime,
  onToggleTime,
  showSource,
  onToggleSource,
  showProfile,
  onToggleProfile,
  autoScroll,
  onToggleAutoScroll,
  feedDebugOnly,
  onToggleFeedDebug,
}: LogsFilterBarProps) {
  return (
    <div className="flex flex-col justify-between gap-2 bg-transparent px-2 py-1 md:flex-row md:items-center md:gap-0">
      <div className="flex flex-wrap items-center gap-2">
        <FilterInput value={filterQuery} onChange={onFilterQueryChange} />

        <LevelSelect value={levelFilter} onChange={onLevelFilterChange} />

        <div className="bg-panel-hover mx-1 hidden h-3.5 w-px sm:block" />

        <ColumnToggles
          showTime={showTime}
          onToggleTime={onToggleTime}
          showSource={showSource}
          onToggleSource={onToggleSource}
          showProfile={showProfile}
          onToggleProfile={onToggleProfile}
        />

        <div className="bg-panel-hover mx-1 hidden h-3.5 w-px sm:block" />

        <FeedDebugToggle active={feedDebugOnly} onToggle={onToggleFeedDebug} />
      </div>

      <div>
        <AutoScrollToggle active={autoScroll} onToggle={onToggleAutoScroll} />
      </div>
    </div>
  )
}

function FilterInput({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="relative flex w-full items-center sm:w-auto">
      <Filter className="text-subtle-copy absolute left-1.5 h-3 w-3" />
      <Input
        placeholder="Filter output..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="brand-focus border-line bg-field text-ink h-6 w-full rounded-[3px] pl-6 text-[11px] focus-visible:ring-1 focus-visible:ring-offset-0 sm:w-48"
      />
    </div>
  )
}

function LevelSelect({
  value,
  onChange,
}: {
  value: LogLevel
  onChange: (value: LogLevel) => void
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as LogLevel)}>
      <SelectTrigger className="border-line bg-field text-ink h-6 w-28 rounded-[3px] px-2 py-0 text-[11px] focus:ring-0">
        <SelectValue placeholder="Severity" />
      </SelectTrigger>
      <SelectContent className="bg-panel border-line text-ink">
        <SelectItem
          value="all"
          className="hover:bg-panel-hover focus:bg-panel-hover py-1 text-[11px]"
        >
          All Levels
        </SelectItem>
        <SelectItem
          value="info"
          className="text-status-info hover:bg-panel-hover focus:bg-panel-hover py-1 text-[11px]"
        >
          Info
        </SelectItem>
        <SelectItem
          value="warn"
          className="text-status-warning hover:bg-panel-hover focus:bg-panel-hover py-1 text-[11px]"
        >
          Warning
        </SelectItem>
        <SelectItem
          value="error"
          className="text-status-danger hover:bg-panel-hover focus:bg-panel-hover py-1 text-[11px]"
        >
          Error
        </SelectItem>
        <SelectItem
          value="success"
          className="text-status-success hover:bg-panel-hover focus:bg-panel-hover py-1 text-[11px]"
        >
          Success
        </SelectItem>
        <SelectItem
          value="debug"
          className="text-subtle-copy hover:bg-panel-hover focus:bg-panel-hover py-1 text-[11px]"
        >
          Debug
        </SelectItem>
      </SelectContent>
    </Select>
  )
}

function ColumnToggles({
  showTime,
  onToggleTime,
  showSource,
  onToggleSource,
  showProfile,
  onToggleProfile,
}: {
  showTime: boolean
  onToggleTime: () => void
  showSource: boolean
  onToggleSource: () => void
  showProfile: boolean
  onToggleProfile: () => void
}) {
  return (
    <div className="hidden items-center gap-1 sm:flex">
      <ToggleButton active={showTime} onClick={onToggleTime} icon={Clock} label="Time" />
      <ToggleButton active={showSource} onClick={onToggleSource} icon={Hash} label="Source" />
      <ToggleButton active={showProfile} onClick={onToggleProfile} icon={Type} label="Profile" />
    </div>
  )
}

function ToggleButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ComponentType<{ className?: string }>
  label: string
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      title={`Toggle ${label} Column`}
      className={`border-line bg-field h-6 rounded-[3px] px-2 py-0 text-[11px] shadow-none transition-none ${
        active
          ? 'border-line-strong bg-panel-hover text-ink font-medium'
          : 'text-copy hover:bg-panel-hover hover:text-ink'
      }`}
    >
      <Icon className="mr-1 h-3 w-3" /> {label}
    </Button>
  )
}

function FeedDebugToggle({
  active,
  onToggle,
}: {
  active: boolean
  onToggle: () => void
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onToggle}
      title="Filter UI feed-specific debug logic"
      className={`border-line bg-field h-6 rounded-[3px] px-2 py-0 text-[11px] shadow-none transition-none ${
        active
          ? 'border-line-strong bg-panel-hover text-ink font-medium'
          : 'text-copy hover:bg-panel-hover hover:text-ink'
      }`}
    >
      <Bug
        className={`mr-1 h-3 w-3 ${active ? 'text-status-warning' : 'text-subtle-copy'}`}
      />{' '}
      Feed Debug
    </Button>
  )
}

function AutoScrollToggle({
  active,
  onToggle,
}: {
  active: boolean
  onToggle: () => void
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onToggle}
      className={`border-line bg-field h-6 rounded-[3px] px-2 py-0 text-[11px] shadow-none transition-none ${
        active
          ? 'border-line-strong bg-panel-hover text-ink font-medium'
          : 'text-copy hover:bg-panel-hover hover:text-ink'
      }`}
    >
      <ArrowDownToLine className="mr-1 h-3 w-3" />
      Auto-tail
    </Button>
  )
}
