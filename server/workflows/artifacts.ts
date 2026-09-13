import fs from 'node:fs/promises'
import path from 'node:path'
import { NotFoundError, ValidationError } from '../shared/errors.js'
import { workflowArtifactsListByWorkflow } from '../shared/convexClient.js'
import { resolveProjectRoot } from '../shared/utils.js'

/** Resolve only a registered artifact, never a caller-supplied filesystem path. */
export async function localArtifactFile(workflowId: string, artifactId: string,
  root = path.join(resolveProjectRoot(import.meta.url), 'data', 'uploads')) {
  if (!workflowId || !artifactId) throw new ValidationError('workflowId and artifactId are required')
  const rows = await workflowArtifactsListByWorkflow(workflowId)
  const artifact = rows.find(row => row._id === artifactId)
  if (!artifact?.localArtifactPath || artifact.localArtifactDeletedAt) throw new NotFoundError('Artifact file is not available')
  if (!/^scrapes\/[a-f0-9]{64}\.json$/.test(artifact.localArtifactPath)) throw new ValidationError('Invalid artifact path')
  try {
    const realRoot = await fs.realpath(root)
    const filename = await fs.realpath(path.join(realRoot, artifact.localArtifactPath))
    const relative = path.relative(realRoot, filename)
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new ValidationError('Invalid artifact path')
    if (!(await fs.stat(filename)).isFile()) throw new NotFoundError('Artifact file is not available')
    return filename
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new NotFoundError('Artifact file is not available')
    throw error
  }
}
