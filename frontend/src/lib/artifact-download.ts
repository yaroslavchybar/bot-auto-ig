export type ArtifactDownloadTarget = {
  storageId?: string | null
  workflowId?: string
  artifactId?: string
}

export function artifactDownloadPath(target: ArtifactDownloadTarget, fileName: string): string {
  const query = new URLSearchParams({ fileName })
  if (target.storageId) query.set('storageId', target.storageId)
  else if (target.workflowId && target.artifactId) {
    query.set('workflowId', target.workflowId)
    query.set('artifactId', target.artifactId)
  } else throw new Error('Artifact file is not available')
  return `/api/workflows/artifacts/download?${query}`
}
