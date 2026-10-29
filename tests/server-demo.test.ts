import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { rootCertificates } from 'node:tls'
import mysql from 'mysql2/promise'
import { DEMO_CONNECTION_ID } from '@/lib/demo-connection'
import type { DatabaseConnection } from '@/lib/types'
import { encrypt } from '@/server/crypto'
import {
  getDemoDatabaseConnection,
  getPublicDemoConnection,
  isDemoDatabaseTarget,
  resolveManagedDatabaseConnection,
} from '@/server/demo-database'
import { resolveDatabaseConnection } from '@/server/resolve-connection'
import { databaseConnectionOptions } from '@/server/database-connection'
import { executeQuery, getPool, closePool } from '@/server/database'
import { resolveSqlPermission } from '@/server/sql-policy'

const certificate = rootCertificates[0]!
const host = 'synthetic-demo.aivencloud.com'
const user = 'synthetic_demo_reader'
const password = 'synthetic-server-only-password'
const database = 'demo_store'
const variables = [
  'DEMO_DB_ENABLED', 'DEMO_DB_HOST', 'DEMO_DB_PORT', 'DEMO_DB_USER', 'DEMO_DB_PASSWORD',
  'DEMO_DB_DATABASE', 'DEMO_DB_NAME', 'DB_SSL_CA_HOST', 'DB_SSL_CA', 'ENCRYPTION_KEY',
  'SQL_WRITE_ENABLED', 'SQL_WRITE_ALLOWLIST',
]

function configureDemo(t: TestContext, overrides: Record<string, string | undefined> = {}) {
  const previous = new Map(variables.map(name => [name, process.env[name]]))
  const defaults: Record<string, string> = {
    DEMO_DB_ENABLED: 'true', DEMO_DB_HOST: host, DEMO_DB_PORT: '26286', DEMO_DB_USER: user,
    DEMO_DB_PASSWORD: password, DEMO_DB_DATABASE: database, DEMO_DB_NAME: 'Built-in demo',
    DB_SSL_CA_HOST: host, DB_SSL_CA: certificate, ENCRYPTION_KEY: '21'.repeat(32),
    SQL_WRITE_ENABLED: 'false', SQL_WRITE_ALLOWLIST: '',
  }
  for (const name of variables) {
    const value = Object.hasOwn(overrides, name) ? overrides[name] : defaults[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  t.after(() => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })
}

function personalConnection(overrides: Partial<DatabaseConnection> = {}): DatabaseConnection {
  return {
    id: 'personal-offline-fixture', name: 'Personal database', host: 'personal.example',
    port: 3306, user: 'personal_reader', password: 'personal-password', database: 'personal_schema',
    env: 'dev', createdAt: '2026-10-29', ...overrides,
  }
}

test('public demo references expose display information without usable connection credentials', (t) => {
  configureDemo(t)
  const profile = getPublicDemoConnection()!
  assert.equal(profile.id, DEMO_CONNECTION_ID)
  assert.equal(profile.name, 'Built-in demo')
  assert.equal(profile.database, database)
  assert.equal(profile.env, 'prod')
  assert.equal(profile.managed, 'demo')
  assert.equal(profile.readOnly, true)
  assert.equal(profile.host, '')
  assert.equal(profile.port, 0)
  assert.equal(profile.user, '')
  assert.equal(Object.hasOwn(profile, 'password'), false)
  assert.equal(profile.ssl, undefined)
  const serialized = JSON.stringify(profile)
  for (const sensitive of [host, user, password, certificate, encrypt(password)]) {
    assert.equal(serialized.includes(sensitive), false)
  }
})

test('a reserved demo ID ignores forged host, credentials, environment, TLS and display flags', (t) => {
  configureDemo(t)
  const forged = personalConnection({
    id: DEMO_CONNECTION_ID, name: 'Forged target', password: 'visitor-supplied-password',
    managed: undefined, readOnly: false, ssl: { ca: 'visitor-supplied-invalid-CA' },
  })
  for (const resolved of [resolveDatabaseConnection(forged), resolveManagedDatabaseConnection(forged)]) {
    assert.equal(resolved.id, DEMO_CONNECTION_ID)
    assert.equal(resolved.name, 'Built-in demo')
    assert.equal(resolved.host, host)
    assert.equal(resolved.port, 26286)
    assert.equal(resolved.user, user)
    assert.equal(resolved.password, password)
    assert.equal(resolved.database, database)
    assert.equal(resolved.env, 'prod')
    assert.equal(resolved.managed, 'demo')
    assert.equal(resolved.readOnly, true)
    const options = databaseConnectionOptions(resolved)
    assert.deepEqual(options.ssl, {
      ca: certificate.trim(), rejectUnauthorized: true, verifyIdentity: true, minVersion: 'TLSv1.2',
    })
  }
})

test('disabled presets disappear publicly and cannot be enabled by a visitor reference', async (t) => {
  configureDemo(t, { DEMO_DB_ENABLED: 'false' })
  const pool = t.mock.method(mysql, 'createPool', () => { throw new Error('unexpected database access') })
  assert.equal(getDemoDatabaseConnection(), null)
  assert.equal(getPublicDemoConnection(), null)
  const forged = personalConnection({ id: DEMO_CONNECTION_ID, managed: 'demo', readOnly: false })
  assert.throws(() => resolveDatabaseConnection(forged), /演示库暂不可用/)
  await assert.rejects(executeQuery(forged, 'SELECT 1'), /演示库暂不可用/)
  assert.equal(pool.mock.callCount(), 0)
})

test('incomplete or malformed server configuration fails closed without exposing configuration values', (t) => {
  configureDemo(t)
  for (const missing of ['DEMO_DB_HOST', 'DEMO_DB_USER', 'DEMO_DB_PASSWORD', 'DEMO_DB_DATABASE']) {
    const value = process.env[missing]
    delete process.env[missing]
    for (const read of [getDemoDatabaseConnection, getPublicDemoConnection]) {
      assert.throws(read, error => {
        assert.match((error as Error).message, /演示库暂不可用/)
        assert.equal((error as Error).message.includes(password), false)
        assert.equal((error as Error).message.includes(host), false)
        return true
      })
    }
    process.env[missing] = value
  }
  for (const port of ['0', '-1', '65536', 'not-a-port', '3306.5']) {
    process.env.DEMO_DB_PORT = port
    assert.throws(getDemoDatabaseConnection, /演示库暂不可用/)
  }
  process.env.DEMO_DB_PORT = '26286'
  process.env.DEMO_DB_HOST = 'mysql://user:secret@database.example'
  assert.throws(getDemoDatabaseConnection, /演示库暂不可用/)
  process.env.DEMO_DB_HOST = host
  process.env.DB_SSL_CA = 'not a CA'
  assert.throws(getDemoDatabaseConnection, /演示库暂不可用/)
})

test('personal connections retain their own encrypted or legacy plaintext password', (t) => {
  configureDemo(t)
  const ciphertext = encrypt('personal-only-secret')
  const encrypted = personalConnection({ password: ciphertext, ssl: { ca: certificate } })
  const resolved = resolveDatabaseConnection(encrypted)
  assert.equal(resolved.password, 'personal-only-secret')
  assert.equal(resolved.host, encrypted.host)
  assert.equal(resolved.database, encrypted.database)
  assert.deepEqual(resolved.ssl, encrypted.ssl)
  assert.equal(encrypted.password, ciphertext)
  const legacy = personalConnection({ password: 'legacy-plaintext' })
  assert.equal(resolveDatabaseConnection(legacy).password, 'legacy-plaintext')
})

test('client-supplied managed flags do not grant access to the server preset', (t) => {
  configureDemo(t)
  const forged = personalConnection({ managed: 'demo', readOnly: true })
  const resolved = resolveDatabaseConnection(forged)
  assert.equal(resolved.id, forged.id)
  assert.equal(resolved.host, forged.host)
  assert.equal(resolved.user, forged.user)
  assert.equal(resolved.password, forged.password)
  assert.equal(resolved.managed, undefined)
  assert.equal(resolved.readOnly, undefined)
  assert.equal(isDemoDatabaseTarget(resolved), false)
})

test('demo references and target aliases remain read-only even if global write policy allows their target', (t) => {
  configureDemo(t, {
    SQL_WRITE_ENABLED: 'true', SQL_WRITE_ALLOWLIST: `${host}:26286/${database},personal.example:3306/personal_schema`,
  })
  const alias = personalConnection({ host: ` ${host.toUpperCase()}. `, port: 26286, database, env: 'dev' })
  assert.equal(isDemoDatabaseTarget(alias), true)
  assert.equal(resolveSqlPermission(alias, 'write'), 'readonly')
  assert.equal(resolveSqlPermission(personalConnection({ id: DEMO_CONNECTION_ID, env: 'dev' }), 'write'), 'readonly')
  assert.equal(resolveSqlPermission(personalConnection({ host, port: 26286, database, env: 'dev' }), 'write'), 'readonly')
  // The preset policy does not silently disable independently authorized personal targets.
  assert.equal(resolveSqlPermission(personalConnection(), 'write'), 'write')
  assert.equal(isDemoDatabaseTarget(personalConnection({ host, port: 26286, database: 'Demo_Store' })), false)
})

test('writes and database deletion are rejected at the final boundary before opening a pool', async (t) => {
  configureDemo(t, { SQL_WRITE_ENABLED: 'true', SQL_WRITE_ALLOWLIST: `${host}:26286/${database}` })
  const pool = t.mock.method(mysql, 'createPool', () => { throw new Error('unexpected database access') })
  const references = [
    personalConnection({ id: DEMO_CONNECTION_ID, env: 'dev', readOnly: false }),
    personalConnection({ id: 'target-alias', host, port: 26286, database, env: 'dev', readOnly: false }),
  ]
  for (const reference of references) {
    for (const sql of ['UPDATE orders SET order_status=40 WHERE id=1', 'DELETE FROM orders WHERE id=1', `DROP DATABASE ${database}`]) {
      await assert.rejects(executeQuery(reference, sql, 'write'), /不允许|禁止|只读/)
    }
  }
  assert.equal(pool.mock.callCount(), 0)
})

test('the pool boundary resolves a public stub to the server target with verified TLS', async (t) => {
  configureDemo(t)
  let options: mysql.PoolOptions | undefined
  let ended = 0
  t.mock.method(mysql, 'createPool', (config: mysql.PoolOptions) => {
    options = config
    return { end: async () => { ended++ } } as any
  })
  try {
    const stub = { ...getPublicDemoConnection()!, password: '' }
    getPool(stub)
    assert.equal(options!.host, host)
    assert.equal(options!.port, 26286)
    assert.equal(options!.user, user)
    assert.equal(options!.password, password)
    assert.equal(options!.database, database)
    assert.deepEqual(options!.ssl, {
      ca: certificate.trim(), rejectUnauthorized: true, verifyIdentity: true, minVersion: 'TLSv1.2',
    })
  } finally { await closePool(DEMO_CONNECTION_ID) }
  assert.equal(ended, 1)
})
