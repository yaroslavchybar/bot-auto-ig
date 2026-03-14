import type { ElementType, ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'

type MetricTone = {
  badgeClassName: string
  indicatorClassName: string
  progressClassName: string
  valueClassName: string
  label: 'Healthy' | 'Warning' | 'Critical'
}

export function getMetricTone(percent: number): MetricTone {
  if (percent >= 80) {
    return {
      badgeClassName:
        'bg-status-danger-soft text-status-danger border-status-danger-border',
      indicatorClassName: 'status-dot-danger',
      progressClassName:
        'bg-panel-muted [&>div]:bg-status-danger [&>div]:status-glow-danger',
      valueClassName: 'text-status-danger',
      label: 'Critical',
    }
  }

  if (percent >= 60) {
    return {
      badgeClassName:
        'bg-status-warning-soft text-status-warning border-status-warning-border',
      indicatorClassName: 'status-dot-warning',
      progressClassName:
        'bg-panel-muted [&>div]:bg-status-warning [&>div]:status-glow-warning',
      valueClassName: 'text-status-warning',
      label: 'Warning',
    }
  }

  return {
    badgeClassName:
      'bg-status-success-soft text-status-success border-status-success-border',
    indicatorClassName: 'status-dot-success',
    progressClassName:
      'bg-panel-muted [&>div]:bg-status-success [&>div]:status-glow-success',
    valueClassName: 'text-status-success',
    label: 'Healthy',
  }
}

export function SectionCard({
  title,
  icon: Icon,
  description,
  children,
}: {
  title: string
  icon: ElementType
  description?: string
  children: ReactNode
}) {
  return (
    <Card className="border-line-soft bg-panel-subtle rounded-2xl border shadow-xs backdrop-blur-xs">
      <CardHeader className="border-line-soft gap-3 border-b pb-4">
        <div className="flex items-start gap-3">
          <div className="border-line bg-panel-soft text-copy flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border">
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-ink text-sm font-medium">
              {title}
            </CardTitle>
            {description ? (
              <p className="text-subtle-copy mt-1 text-sm">{description}</p>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-5">{children}</CardContent>
    </Card>
  )
}

/* ── Metric Card Header ── */

function MetricCardHeader({
  title,
  icon: Icon,
  detail,
  tone,
}: {
  title: string
  icon: ElementType
  detail: string
  tone: MetricTone
}) {
  return (
    <CardHeader className="gap-4 pb-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="border-line bg-panel-soft text-copy flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border">
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-ink text-sm font-medium">
              {title}
            </CardTitle>
            <p className="text-subtle-copy mt-1 text-xs">{detail}</p>
          </div>
        </div>
        <Badge
          className={`shrink-0 border text-xs font-medium ${tone.badgeClassName}`}
        >
          {tone.label}
        </Badge>
      </div>
    </CardHeader>
  )
}

/* ── Metric Card Stats ── */

function MetricCardStats({
  used,
  free,
  total,
}: {
  used: string
  free: string
  total: string
}) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {[
        { label: 'Used', value: used },
        { label: 'Free', value: free },
        { label: 'Total', value: total },
      ].map((item) => (
        <div
          key={item.label}
          className="border-line-soft bg-panel-muted rounded-xl border px-3 py-3"
        >
          <div className="text-subtle-copy text-[11px] tracking-[0.16em] uppercase">
            {item.label}
          </div>
          <div className="text-ink mt-2 text-sm font-medium">
            {item.value}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ── Main MetricCard ── */

export function MetricCard({
  title,
  icon,
  percent,
  used,
  free,
  total,
  detail,
}: {
  title: string
  icon: ElementType
  percent: number
  used: string
  free: string
  total: string
  detail: string
}) {
  const tone = getMetricTone(percent)

  return (
    <Card className="border-line-soft bg-panel-subtle rounded-2xl border shadow-xs backdrop-blur-xs">
      <MetricCardHeader title={title} icon={icon} detail={detail} tone={tone} />
      <CardContent className="space-y-4 pt-0">
        <div className="flex items-end justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className={`text-4xl font-semibold tracking-tight tabular-nums ${tone.valueClassName}`}
            >
              {percent}%
            </span>
            <span
              className={`h-2.5 w-2.5 rounded-full ${tone.indicatorClassName}`}
            />
          </div>
        </div>
        <Progress
          value={percent}
          className={`h-2.5 rounded-full ${tone.progressClassName}`}
        />
        <MetricCardStats used={used} free={free} total={total} />
      </CardContent>
    </Card>
  )
}
