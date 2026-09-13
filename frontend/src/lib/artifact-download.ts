export type ArtifactDownloadTarget = {
  workflowId: string
  artifactId: string
}

export function artifactDownloadPath(target: ArtifactDownloadTarget, fileName: string): string {
  const query = new URLSearchParams({ fileName })
  if (target.workflowId && target.artifactId) {
    query.set('workflowId', target.workflowId)
    query.set('artifactId', target.artifactId)
  } else throw new Error('Artifact file is not available')
  return `/api/workflows/artifacts/download?${query}`
}
