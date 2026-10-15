import type { SessionDecision } from '../../../../../server/shared/sessionDecision'
import { cn } from '@/lib/utils'

export function SessionDecisionBadge({
  decision,
}: {
  decision: SessionDecision | null | undefined
}) {
  if (!decision) return null
  const text =
    decision.kind === 'interest'
      ? decision.status === 'complete'
        ? `Interest ${Math.round(decision.confidence * 100)}%`
        : decision.status === 'checking'
          ? 'Matching interests…'
          : 'Match unavailable'
      : decision.status === 'complete'
        ? `AI: ${decision.category[0].toUpperCase()}${decision.category.slice(1)} ${Math.round(decision.confidence * 100)}%`
        : decision.status === 'checking'
          ? 'Screening profile…'
          : 'Screening unavailable'
  const title =
    decision.kind === 'interest'
      ? 'AI confidence that this content matches at least one selected Interest'
      : `AI profile classification for @${decision.username}`
  return (
    <span
      role="status"
      title={title}
      className={cn(
        'max-w-[40vw] shrink-0 truncate rounded-full border px-2.5 py-1 text-xs',
        decision.kind === 'interest' && decision.status === 'complete' && decision.related
          ? 'border-status-success/30 bg-status-success/10 text-status-success'
          : 'border-line-soft bg-panel-subtle text-muted-copy',
      )}
    >
      {text}
    </span>
  )
}
