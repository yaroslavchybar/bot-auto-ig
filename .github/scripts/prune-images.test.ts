import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const hash = (digit: string) => digit.repeat(40)
const repository = 'ghcr.io/yaroslavchybar/bot-auto-ig'

function prune(images: string, containers = '', inspectFails = false) {
  const root = mkdtempSync(path.join(tmpdir(), 'ig-prune-test-'))
  if (path.dirname(path.resolve(root)) !== path.resolve(tmpdir()))
    throw new Error('Unexpected test directory')
  const file = path.join(root, 'commands.log')
  const shell = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/sh'
  const result = spawnSync(
    shell,
    [
      '-c',
      `
    docker() {
      printf '%s\n' "$*" >> "$TEST_LOG"
      case "$*" in
        'image ls '*) printf '%s\n' "$TEST_IMAGES" ;;
        'container ls --all --quiet') printf '%s\n' "$TEST_CONTAINERS" ;;
        'container inspect '*) [ "$TEST_INSPECT_FAILS" = false ] || return 1; printf 'sha256:busy\n' ;;
        'image rm '*) return 0 ;;
        *) return 1 ;;
      esac
    }
    . "$PRUNE_SCRIPT"
  `,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        TEST_LOG: file,
        TEST_IMAGES: images,
        TEST_CONTAINERS: containers,
        TEST_INSPECT_FAILS: String(inspectFails),
        PRUNE_SCRIPT: path.resolve('.github/scripts/prune-images.sh'),
      },
    },
  )
  try {
    return { ...result, commands: readFileSync(file, 'utf8').trim().split(/\r?\n/) }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('image cleanup keeps two distinct release images per service and untags old aliases individually', () => {
  const images = ['server', 'frontend', 'spoofer']
    .flatMap((service) => [
      `sha256:${service}-new ${service}-${hash('a')}`,
      `sha256:${service}-new ${service}-${hash('b')}`,
      `sha256:${service}-new ${service}-inputs-${'a'.repeat(64)}`,
      `sha256:${service}-previous ${service}-${hash('c')}`,
      `sha256:${service}-old ${service}-${hash('d')}`,
      `sha256:${service}-old ${service}-inputs-${'d'.repeat(64)}`,
    ])
    .join('\n')
  const result = prune(images)
  expect(result.status).toBe(0)
  expect(result.commands.filter((command) => command.startsWith('image rm '))).toEqual(
    ['server', 'frontend', 'spoofer'].flatMap((service) => [
      `image rm ${repository}:${service}-${hash('d')}`,
      `image rm ${repository}:${service}-inputs-${'d'.repeat(64)}`,
    ]),
  )
})

test('running and stopped container images are preserved, and unknown tags stay untouched', () => {
  const result = prune(
    `sha256:new server-${hash('a')}\nsha256:previous server-${hash('b')}\nsha256:busy server-${hash('c')}\nsha256:custom server-manual-keep`,
    'stopped-container',
  )
  expect(result.status).toBe(0)
  expect(result.commands).toContain('container ls --all --quiet')
  expect(result.commands.some((command) => command.startsWith('image rm '))).toBe(false)
})

test('empty inventory, missing release tags, and failed container inspection never delete images', () => {
  for (const [images, containers, fails] of [
    ['', '', false],
    ['sha256:cache server-inputs-abc', '', false],
    [
      `sha256:new server-${hash('a')}\nsha256:previous server-${hash('b')}\nsha256:old server-${hash('c')}`,
      'broken-container',
      true,
    ],
  ] as const) {
    const result = prune(images, containers, fails)
    expect(result.status).toBe(fails ? 1 : 0)
    expect(result.commands.some((command) => command.startsWith('image rm '))).toBe(false)
  }
})
