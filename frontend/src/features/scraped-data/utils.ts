import type { WorkflowArtifact } from './types'

export function formatDateTime(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-'
  return new Date(value).toLocaleString()
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value)
}

export function getArtifactTargets(artifact: WorkflowArtifact) {
  if (Array.isArray(artifact.targets) && artifact.targets.length > 0) {
    return artifact.targets
  }
  return String(artifact.targetUsername || '')
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
}

export function getArtifactRowCount(artifact: WorkflowArtifact) {
  const deduped = Number(artifact.stats?.deduped ?? NaN)
  if (Number.isFinite(deduped)) return Math.max(0, deduped)
  const scraped = Number(artifact.stats?.scraped ?? NaN)
  if (Number.isFinite(scraped)) return Math.max(0, scraped)
  return 0
}

export function getArtifactSortTimestamp(artifact: WorkflowArtifact) {
  return Math.max(
    Number.isFinite(Number(artifact.updatedAt)) ? Number(artifact.updatedAt) : 0,
    Number.isFinite(Number(artifact.createdAt)) ? Number(artifact.createdAt) : 0,
  )
}
