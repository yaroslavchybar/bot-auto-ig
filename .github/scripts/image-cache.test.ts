import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { baseImages, imageInputs, reuseImage } from './image-cache'

const baseDigest = `sha256:${'a'.repeat(64)}`
const cachedDigest = `sha256:${'b'.repeat(64)}`

function fixture(
  overrides: { tree?: string; base?: string; missing?: boolean; createFails?: boolean } = {},
) {
  const calls: string[][] = []
  const options = {
    service: 'server' as const,
    dockerfile: 'FROM rust:1.98.1-bookworm AS build\nFROM build AS deps\nFROM debian:bookworm-slim',
    imageName: 'ghcr.io/test/app',
    revision: 'current-commit',
    run(args: string[]) {
      calls.push(args)
      if (args[0] === 'git') return overrides.tree ?? 'tracked-input-tree'
      if (args[3] === 'create') {
        if (overrides.createFails) throw new Error('Registry unavailable')
        return ''
      }
      if (args[4].includes('-inputs-')) {
        if (overrides.missing) throw new Error('Image not found')
        return cachedDigest
      }
      return overrides.base ?? baseDigest
    },
  }
  return { options, calls }
}

describe('image reuse', () => {
  test('finds all current base images without inspecting local stages or contexts', () => {
    expect(baseImages(readFileSync('server/Dockerfile', 'utf8'))).toEqual([
      'rust:1.98.1-bookworm',
      'oven/bun:1.4.2-debian',
    ])
    expect(baseImages(readFileSync('frontend/Dockerfile', 'utf8'))).toEqual([
      'node:24.21.0-bookworm-slim',
      'oven/bun:1.4.2-slim',
      'nginx:alpine',
    ])
    expect(baseImages(readFileSync('tools/spoofer/Dockerfile', 'utf8'))).toEqual([
      'rust:1.98.1-bookworm',
      'debian:bookworm-slim',
    ])
  })

  test('retags an identical image by digest under the current commit', () => {
    const { options, calls } = fixture()
    expect(reuseImage(options).reused).toBe(true)
    expect(calls.at(-1)).toEqual([
      'docker',
      'buildx',
      'imagetools',
      'create',
      '--prefer-index=false',
      '--tag',
      'ghcr.io/test/app:server-current-commit',
      `ghcr.io/test/app@${cachedDigest}`,
    ])
  })

  test('changed inputs, deletions, or base images invalidate reuse', () => {
    const initial = reuseImage(fixture().options).cacheTag
    expect(reuseImage(fixture({ tree: 'modified-tree' }).options).cacheTag).not.toBe(initial)
    expect(reuseImage(fixture({ tree: '' }).options).cacheTag).not.toBe(initial)
    expect(reuseImage(fixture({ base: cachedDigest }).options).cacheTag).not.toBe(initial)
  })

  test('frontend configuration invalidates reuse independently of source', () => {
    const options = { ...fixture().options, service: 'frontend' as const }
    const initial = reuseImage(options).cacheTag
    expect(reuseImage({ ...options, apiUrl: 'https://new-api' }).cacheTag).not.toBe(initial)
    expect(reuseImage({ ...options, convexUrl: 'https://new-convex' }).cacheTag).not.toBe(initial)
  })

  test('cache misses and retag failures keep the normal build and cache tag', () => {
    for (const overrides of [{ missing: true }, { createFails: true }]) {
      const result = reuseImage(fixture(overrides).options)
      expect(result.reused).toBe(false)
      expect(result.cacheTag).toMatch(/:server-inputs-[a-f0-9]{64}$/)
    }
  })

  test('a base-image lookup failure disables reuse and publishing a cache tag', () => {
    expect(reuseImage(fixture({ base: 'invalid' }).options)).toEqual({
      reused: false,
      cacheTag: undefined,
    })
  })

  test('spoofer source inputs exclude runtime source but include workspace manifests', () => {
    expect(imageInputs.spoofer).not.toContain('tools/runtime')
    expect(imageInputs.spoofer).toContain('tools/runtime/Cargo.toml')
    expect(imageInputs.spoofer).toContain('tools/service-common')
    expect(imageInputs.frontend).toContain('convex')
    expect(imageInputs.frontend).toContain('server/shared')
    expect(imageInputs.server).toContain('frontend/package.json')
  })
})

test('production deploys wait for checks and every image; PRs keep release validation', () => {
  const workflow = Bun.YAML.parse(readFileSync('.github/workflows/deploy.yml', 'utf8')) as {
    jobs: Record<
      string,
      {
        needs?: string | string[]
        if?: string
        steps: { run?: string; if?: string }[]
      }
    >
    concurrency: { 'cancel-in-progress': boolean }
  }
  expect(workflow.jobs['build-images'].needs).toBeUndefined()
  expect(workflow.jobs['build-images'].if).toBe("github.event_name == 'push'")
  expect(workflow.jobs['deploy-convex'].needs).toEqual(['verify', 'build-images'])
  expect(workflow.jobs['deploy-vps'].needs).toEqual(['verify', 'deploy-convex', 'build-images'])
  expect(workflow.concurrency['cancel-in-progress']).toBe(false)
  expect(workflow.jobs.verify.steps.find((step) => step.run === 'bun run build:rust')?.if).toBe(
    "github.event_name == 'pull_request'",
  )
})
