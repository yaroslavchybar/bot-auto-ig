import { createHash } from 'node:crypto'
import { appendFileSync, readFileSync } from 'node:fs'

const commonInputs = ['.dockerignore', '.github/workflows', '.github/scripts/image-cache.ts']
const jsInputs = ['package.json', 'bun.lock', 'server/package.json', 'frontend/package.json']
const rustInputs = [
  'Cargo.toml',
  'Cargo.lock',
  '.cargo',
  'tools/runtime/Cargo.toml',
  'tools/spoofer/Cargo.toml',
  'tools/service-common',
]

export const imageInputs = {
  server: [...commonInputs, ...jsInputs, ...rustInputs, 'server', 'tools/runtime'],
  frontend: [
    ...commonInputs,
    ...jsInputs,
    'frontend',
    'convex',
    'server/shared',
    'tsconfig.json',
    'vite.config.ts',
    '.node-version',
  ],
  spoofer: [...commonInputs, ...rustInputs, 'tools/spoofer'],
} as const

type Service = keyof typeof imageInputs
type Run = (args: string[]) => string

// Include external COPY images as well as FROM images. Stage aliases and named
// local contexts are not registry images.
export function baseImages(dockerfile: string): string[] {
  const stages = new Set(['repo_root', 'convex_src'])
  const images = new Set<string>()
  for (const line of dockerfile.split('\n')) {
    const from = /^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/i.exec(line)
    const copy = /^COPY\s+--from=(\S+)/i.exec(line)
    const image = from?.[1] ?? copy?.[1]
    if (image && !stages.has(image)) images.add(image)
    if (from?.[2]) stages.add(from[2])
  }
  return [...images]
}

function digest(value: string): string {
  const result = value.trim()
  if (!/^sha256:[a-f0-9]{64}$/.test(result)) throw new Error('Invalid registry digest')
  return result
}

interface CacheOptions {
  service: Service
  dockerfile: string
  imageName: string
  revision: string
  apiUrl?: string
  convexUrl?: string
  run: Run
}

// Reuse requires identical tracked inputs, public frontend config, and current
// base-image digests. Registry failures fall back to the normal build.
export function reuseImage(options: CacheOptions): { reused: boolean; cacheTag?: string } {
  const { service, dockerfile, imageName, revision, run } = options
  let cacheTag: string | undefined
  try {
    const tree = run(['git', 'ls-tree', '-rz', 'HEAD', '--', ...imageInputs[service]])
    const bases = baseImages(dockerfile).map((image) => [
      image,
      digest(
        run([
          'docker',
          'buildx',
          'imagetools',
          'inspect',
          image,
          '--format',
          '{{.Manifest.Digest}}',
        ]),
      ),
    ])
    const hash = createHash('sha256')
      .update(
        JSON.stringify({
          service,
          tree,
          bases,
          config: service === 'frontend' ? [options.apiUrl ?? '', options.convexUrl ?? ''] : [],
        }),
      )
      .digest('hex')
    cacheTag = `${imageName}:${service}-inputs-${hash}`
    const cachedDigest = digest(
      run([
        'docker',
        'buildx',
        'imagetools',
        'inspect',
        cacheTag,
        '--format',
        '{{.Manifest.Digest}}',
      ]),
    )
    // Copy the existing manifest by digest, including its attestations. The VPS
    // still pulls an immutable commit tag, never a mutable cache tag.
    run([
      'docker',
      'buildx',
      'imagetools',
      'create',
      '--prefer-index=false',
      '--tag',
      `${imageName}:${service}-${revision}`,
      `${imageName}@${cachedDigest}`,
    ])
    return { reused: true, cacheTag }
  } catch {
    return { reused: false, cacheTag }
  }
}

if (import.meta.main) {
  const { SERVICE, DOCKERFILE, IMAGE_NAME, GITHUB_SHA, GITHUB_OUTPUT } = process.env
  if (
    !SERVICE ||
    !Object.hasOwn(imageInputs, SERVICE) ||
    !DOCKERFILE ||
    !IMAGE_NAME ||
    !GITHUB_SHA ||
    !GITHUB_OUTPUT
  ) {
    throw new Error('Missing or invalid image-cache environment')
  }
  const result = reuseImage({
    service: SERVICE as Service,
    dockerfile: readFileSync(DOCKERFILE, 'utf8'),
    imageName: IMAGE_NAME,
    revision: GITHUB_SHA,
    apiUrl: process.env.VITE_API_URL,
    convexUrl: process.env.VITE_CONVEX_URL,
    run(args) {
      const command = Bun.spawnSync(args, { stdout: 'pipe', stderr: 'pipe' })
      if (command.exitCode !== 0) throw new Error(`Command failed: ${args[0]}`)
      return command.stdout.toString()
    },
  })
  appendFileSync(GITHUB_OUTPUT, `reused=${result.reused}\ncache-tag=${result.cacheTag ?? ''}\n`)
  console.log(
    result.reused ? `Reused ${SERVICE} image for this commit` : `Building ${SERVICE} image`,
  )
}
