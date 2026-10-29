import test from 'node:test'
import assert from 'node:assert/strict'
import { rootCertificates } from 'node:tls'
import mysql from 'mysql2/promise'
import { databaseConnectionOptions, databaseConnectionError } from '@/server/database-connection'
import { getPool, closePool, testConnection } from '@/server/database'
import { requiresDatabaseTls, validateDatabaseCa, MAX_DATABASE_CA_BYTES } from '@/lib/database-tls'
import type { DatabaseConnection } from '@/lib/types'

const ca = rootCertificates[0]!
const rotatedCa = rootCertificates[1]!
const connection: DatabaseConnection = {
  id: 'tls-offline-fixture', name: 'TLS fixture', host: 'database.aivencloud.com',
  port: 3306, user: 'fixture', password: 'synthetic-secret', database: 'demo', env: 'dev', createdAt: '2026-10-29',
}

function preset(t: { after: (callback: () => void) => void }, host?: string, certificate?: string) {
  const previousHost = process.env.DB_SSL_CA_HOST
  const previousCa = process.env.DB_SSL_CA
  if (host === undefined) delete process.env.DB_SSL_CA_HOST
  else process.env.DB_SSL_CA_HOST = host
  if (certificate === undefined) delete process.env.DB_SSL_CA
  else process.env.DB_SSL_CA = certificate
  t.after(() => {
    if (previousHost === undefined) delete process.env.DB_SSL_CA_HOST
    else process.env.DB_SSL_CA_HOST = previousHost
    if (previousCa === undefined) delete process.env.DB_SSL_CA
    else process.env.DB_SSL_CA = previousCa
  })
}

test('Aiven host detection handles case and trailing dots without trusting lookalike suffixes', () => {
  assert.equal(requiresDatabaseTls(' Database.AIVENcloud.com. '), true)
  assert.equal(requiresDatabaseTls('database.aivencloud.com.attacker.example'), false)
  assert.equal(requiresDatabaseTls('localhost'), false)
})

test('TLS stays optional for existing local databases and uses system trust for public CAs', (t) => {
  preset(t)
  const local = { ...connection, host: 'localhost' }
  assert.equal(databaseConnectionOptions(local).ssl, undefined)
  assert.deepEqual(databaseConnectionOptions({ ...local, ssl: {} }).ssl, {
    rejectUnauthorized: true, verifyIdentity: true, minVersion: 'TLSv1.2',
  })
})

test('a deployment CA is selected only for its exact configured host; visitors need not upload it', (t) => {
  preset(t, 'DATABASE.AIVENcloud.com.', ca.replaceAll('\n', '\\n'))
  const options = databaseConnectionOptions(connection)
  assert.equal(typeof options.ssl, 'object')
  assert.equal((options.ssl as { ca: string }).ca, ca.trim())
  assert.equal(databaseConnectionOptions({ ...connection, host: 'database.aivencloud.com.attacker.example' }).ssl, undefined)
  assert.throws(() => databaseConnectionOptions({ ...connection, host: 'other.aivencloud.com' }), { code: 'DATABASE_AIVEN_CA_REQUIRED' })
})

test('a client cannot disable certificate verification or override TLS policy through extra fields', (t) => {
  preset(t)
  const options = databaseConnectionOptions({
    ...connection,
    ssl: { ca, rejectUnauthorized: false, verifyIdentity: false, minVersion: 'TLSv1' } as { ca: string },
  })
  assert.deepEqual(options.ssl, { ca: ca.trim(), rejectUnauthorized: true, verifyIdentity: true, minVersion: 'TLSv1.2' })
})

test('missing, malformed and oversized Aiven CAs fail before a database connection is opened', async (t) => {
  preset(t)
  const poolMock = t.mock.method(mysql, 'createPool', () => { throw new Error('unexpected network access') })
  const missing = await testConnection(connection)
  assert.equal(missing.success, false)
  assert.match(missing.error!, /预置|导入/)
  assert.throws(() => getPool({ ...connection, ssl: { ca: 'not a certificate' } }), { code: 'DATABASE_CA_INVALID' })
  assert.throws(() => getPool({ ...connection, ssl: { ca: 'x'.repeat(MAX_DATABASE_CA_BYTES + 1) } }), { code: 'DATABASE_CA_INVALID' })
  assert.throws(() => getPool({ ...connection, ssl: { ca: '-----BEGIN CERTIFICATE-----\nZmFrZQ==\n-----END CERTIFICATE-----' } }), { code: 'DATABASE_CA_INVALID' })
  assert.equal(poolMock.mock.callCount(), 0)
})

test('PEM bundles accept real public certificates and reject private keys and appended data', () => {
  assert.equal(validateDatabaseCa(`${ca}\n${rotatedCa}`), undefined)
  assert.match(validateDatabaseCa('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----')!, /PEM/)
  assert.match(validateDatabaseCa(`${ca}\nuntrusted extra content`)!, /PEM/)
})

test('CA rotation invalidates a previously opened pool, including server preset rotation', async (t) => {
  preset(t, connection.host, ca)
  const options: unknown[] = []
  let closed = 0
  t.mock.method(mysql, 'createPool', (config: unknown) => {
    options.push(config)
    return { end: async () => { closed++ } } as any
  })
  try {
    const first = getPool(connection)
    assert.equal(getPool(connection), first)
    process.env.DB_SSL_CA = rotatedCa
    assert.notEqual(getPool(connection), first)
    assert.equal(options.length, 2)
    assert.equal(closed, 1)
    assert.equal((options[1] as { ssl: { ca: string } }).ssl.ca, rotatedCa.trim())
  } finally { await closePool(connection.id) }
})

test('connection failures distinguish transport, authentication and TLS without leaking driver messages', () => {
  const error = (code: string, message = 'sensitive driver details: synthetic-secret') => databaseConnectionError(Object.assign(new Error(message), { code }))
  assert.match(error('ETIMEDOUT'), /超时/)
  assert.match(error('ENOTFOUND'), /主机/)
  assert.match(error('ER_ACCESS_DENIED_ERROR'), /认证或授权/)
  assert.match(error('ERR_TLS_CERT_ALTNAME_INVALID'), /证书校验/)
  assert.match(error('HANDSHAKE_SSL_ERROR', 'self-signed certificate'), /证书校验/)
  assert.match(error('HANDSHAKE_SSL_ERROR', 'read ECONNRESET'), /TLS 握手/)
  for (const code of ['UNKNOWN', 'HANDSHAKE_SSL_ERROR', 'ER_ACCESS_DENIED_ERROR', 'ECONNRESET']) {
    assert.doesNotMatch(error(code), /synthetic-secret|sensitive driver/)
  }
})
