import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

// Execute the real deployment script against a fake Docker CLI. Never contact Docker.
function simulateDeployment(scenario: string) {
  const dir = mkdtempSync(join(tmpdir(), 'dbpilot-deploy-test-'))
  mkdirSync(join(dir, '.output'))
  mkdirSync(join(dir, 'bin'))
  writeFileSync(join(dir, '.env'), 'PREVIOUS_CONFIGURATION=keep\n')
  writeFileSync(join(dir, 'bin', 'docker'), `#!/bin/sh
printf '%s\\n' "$*" >> "$DEPLOY_DIR/calls.log"
case "$*" in
  'inspect --format={{.Image}} db-pilot') echo 'sha256:previous';;
  'compose build') [ "$SCENARIO" != 'build-failed' ];;
  'inspect --format={{.State.Health.Status}} db-pilot')
    if [ "$SCENARIO" = 'health-failed' ]; then echo unhealthy; else echo healthy; fi;;
  *) exit 0;;
esac
`, { mode: 0o755 })
  writeFileSync(join(dir, 'bin', 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  const result = spawnSync('bash', ['deploy.sh'], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 10_000,
    env: { PATH: `${join(dir, 'bin')}:${process.env.PATH}`, DEPLOY_DIR: dir, SCENARIO: scenario },
  })
  try {
    return { status: result.status, calls: readFileSync(join(dir, 'calls.log'), 'utf8'), config: readFileSync(join(dir, '.env'), 'utf8') }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

test('deployment builds before replacing the container and retains rollback images', () => {
  const result = simulateDeployment('success')
  assert.equal(result.status, 0)
  assert.ok(result.calls.indexOf('compose build') < result.calls.indexOf('compose up -d --no-build'))
  assert.equal(result.calls.includes('compose down'), false)
  assert.equal(result.calls.includes('image prune'), false)
  assert.ok(result.config.includes('APP_BIND_HOST=127.0.0.1'))
  assert.ok(result.config.includes('SQL_WRITE_ENABLED=false'))
})

test('failed image builds restore configuration without stopping or replacing the running container', () => {
  const result = simulateDeployment('build-failed')
  assert.equal(result.status, 1)
  assert.equal(result.calls.includes('compose up'), false)
  assert.equal(result.calls.includes('compose down'), false)
  assert.equal(result.config, 'PREVIOUS_CONFIGURATION=keep\n')
})

test('failed health checks attempt rollback to the prior image and configuration', () => {
  const result = simulateDeployment('health-failed')
  assert.equal(result.status, 1)
  assert.ok(result.calls.includes('tag sha256:previous db-pilot:latest'))
  assert.ok(result.calls.includes('compose up -d --no-build --force-recreate'))
  assert.equal(result.config, 'PREVIOUS_CONFIGURATION=keep\n')
})
