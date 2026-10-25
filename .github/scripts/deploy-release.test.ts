import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

function deploy(failure = '') {
  const root = mkdtempSync(path.join(tmpdir(), 'ig-release-test-'))
  const resolved = path.resolve(root)
  assert.equal(path.dirname(resolved), path.resolve(tmpdir()))
  assert.ok(path.basename(resolved).startsWith('ig-release-test-'))
  const appRoot = path.join(root, 'ig-bot')
  const active = path.join(appRoot, 'app')
  const staged = path.join(appRoot, 'app.new')
  const caddy = path.join(root, 'caddy/conf.d/ig-bot.caddy')
  const token = path.join(appRoot, 'secrets/axiom-token')
  const log = path.join(root, 'commands.log')
  for (const dir of [active, staged, path.dirname(caddy), path.dirname(token), path.join(appRoot, 'data')])
    mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(active, '.env'), 'IMAGE_TAG=old\n')
  writeFileSync(path.join(active, 'docker-compose.prod.yml'), 'old compose')
  writeFileSync(path.join(active, 'release'), 'old')
  writeFileSync(path.join(staged, '.env'), 'IMAGE_TAG=new\n')
  writeFileSync(path.join(staged, '.axiom-token'), 'new-token')
  writeFileSync(path.join(staged, 'docker-compose.prod.yml'), 'new compose')
  mkdirSync(path.join(staged, 'deploy'))
  writeFileSync(path.join(staged, 'deploy/ig-bot.caddy'), 'new caddy')
  mkdirSync(path.join(staged, '.github/scripts'), { recursive: true })
  writeFileSync(path.join(staged, '.github/scripts/prune-images.sh'), 'exit 0\n')
  writeFileSync(caddy, 'old caddy')
  writeFileSync(token, 'old-token')
  writeFileSync(path.join(appRoot, 'data/preserved'), 'persistent data')
  if (failure === 'interrupted') mkdirSync(path.join(appRoot, 'app.prev'))
  const shell = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/sh'
  try {
    const result = spawnSync(shell, ['-c', `
      docker() {
        printf '%s\n' "$*" >> "$TEST_LOG"
        case "$*" in
          compose*' pull') [ "$TEST_FAILURE" != pull ] ;;
          compose*' up '*)
            if [ "$TEST_FAILURE" = up ] && grep -q IMAGE_TAG=new "$release/.env"; then return 1; fi ;;
          run*) [ "$TEST_FAILURE" != validate ] ;;
          'exec caddy '*)
            if [ "$TEST_FAILURE" = reload ] && grep -q IMAGE_TAG=new "$release/.env"; then return 1; fi ;;
          'volume create '*) printf 'volume\n' ;;
          *) return 1 ;;
        esac
      }
      curl() { printf 'health\n' >> "$TEST_LOG"; [ "$TEST_FAILURE" != health ]; }
      set -- "$TEST_APP_ROOT"
      . "$DEPLOY_SCRIPT"
    `], {
      encoding: 'utf8',
      env: {
        ...process.env,
        TEST_APP_ROOT: appRoot.replaceAll('\\', '/'),
        TEST_LOG: log.replaceAll('\\', '/'), TEST_FAILURE: failure,
        DEPLOY_SCRIPT: path.resolve('.github/scripts/deploy-release.sh').replaceAll('\\', '/'),
      },
    })
    return {
      ...result,
      env: readFileSync(path.join(active, '.env'), 'utf8'),
      token: readFileSync(token, 'utf8'), caddy: readFileSync(caddy, 'utf8'),
      commands: existsSync(log) ? readFileSync(log, 'utf8') : '',
      previous: existsSync(path.join(appRoot, 'app.prev')),
      persistent: readFileSync(path.join(appRoot, 'data/preserved'), 'utf8'),
    }
  } finally {
    rmSync(resolved, { recursive: true, force: true })
  }
}

for (const failure of ['pull', 'validate', 'up', 'reload', 'health'])
  test(`failed ${failure} preserves or restores the previous release and configuration`, () => {
    const result = deploy(failure)
    assert.notEqual(result.status, 0, result.stderr)
    assert.equal(result.env, 'IMAGE_TAG=old\n')
    assert.equal(result.token, 'old-token')
    assert.equal(result.caddy, 'old caddy')
    assert.equal(result.persistent, 'persistent data')
    if (['up', 'reload', 'health'].includes(failure)) {
      assert.match(result.commands, /up -d --remove-orphans --pull never --force-recreate/)
      assert.equal(result.previous, false)
    } else assert.doesNotMatch(result.commands, / up /)
  })

test('healthy activation uses one Compose project and removes backups only after health', () => {
  const result = deploy()
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.env, 'IMAGE_TAG=new\n')
  assert.equal(result.token, 'new-token')
  assert.equal(result.caddy, 'new caddy')
  assert.equal(result.previous, false)
  assert.equal(result.persistent, 'persistent data')
  const calls = result.commands.split('\n').filter(line => line.startsWith('compose'))
  assert.ok(calls.every(line => line.startsWith('compose --project-name app ')))
  assert.match(calls[0], /app\.new.* pull$/)
  assert.ok(result.commands.includes('health'))
})

test('an interrupted release backup is preserved for recovery', () => {
  const result = deploy('interrupted')
  assert.notEqual(result.status, 0)
  assert.equal(result.env, 'IMAGE_TAG=old\n')
  assert.equal(result.previous, true)
  assert.equal(result.commands, '')
})
