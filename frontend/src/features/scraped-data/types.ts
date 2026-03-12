import type { Id } from '../../../../../convex/_generated/dataModel'

export type WorkflowArtifact = {
  _id: Id<'workflowArtifacts'>
  workflowId: Id<'workflows'>
  workflowName: string
  nodeId: string
  nodeLabel?: string | null
  name: string
  kind: 'followers' | 'following'
  targetUsername?: string | null
  targets?: string[]
  status?: string | null
  imported?: boolean
  sourceProfileName?: string | null
  lastRunAt?: number | null
  storageId?: Id<'_storage'> | null
  manifestStorageId?: Id<'_storage'> | null
  exportStorageId?: Id<'_storage'> | null
  stats?: {
    scraped?: number
    deduped?: number
    chunksCompleted?: number
    targetsCompleted?: number
  } | null
  createdAt?: number
  updatedAt?: number
}
