import test from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { closePool, executeQuery, listTables } from '@/server/database'
import type { DatabaseConnection } from '@/lib/types'

const connection: DatabaseConnection = {
  id: 'security-offline-fixture', name: 'offline mock', host: 'never-connect.invalid',
  port: 3306, user: 'fixture', password: 'synthetic', database: 'sandbox', env: 'prod', createdAt: '2026-10-21',
}

test('final database boundary denies forbidden writes before opening a pool', async (t) => {
  const poolMock = t.mock.method(mysql, 'createPool', () => { throw new Error('unexpected database access') })
  await assert.rejects(executeQuery(connection, 'UPDATE users SET active=0', 'write'), /不允许/)
  await assert.rejects(executeQuery(connection, 'SELECT 1 /*!50000 , SLEEP(1) */'), /可执行注释/)
  assert.equal(poolMock.mock.callCount(), 0)
})

test('query results are capped, carry executed SQL, and report actual truncation', async (t) => {
  let returnedRows = Array.from({ length: 501 }, (_, id) => ({ id: String(id) }))
  let actualSql = ''
  let poolOptions: any
  let releases = 0
  const fakeConnection = {
    query: async (options: { sql: string }) => {
      actualSql = options.sql
      return [returnedRows, [{ name: 'id' }]]
    },
    release: () => { releases++ },
  }
  t.mock.method(mysql, 'createPool', (options: unknown) => {
    poolOptions = options
    return { getConnection: async () => fakeConnection, end: async () => {} } as any
  })
  try {
    const result = await executeQuery(connection, '/* report */ SELECT id FROM users LIMIT 99999')
    assert.equal(result.rowCount, 500)
    assert.equal(result.rows.length, 500)
    assert.equal(result.truncated, true)
    assert.equal(result.maxRows, 500)
    assert.equal(result.resultLimitApplied, true)
    assert.equal(result.executedSql, actualSql)
    assert.match(actualSql, /LIMIT 501$/)
    assert.equal(poolOptions.supportBigNumbers, true)
    assert.equal(poolOptions.bigNumberStrings, true)
    returnedRows = returnedRows.slice(0, 500)
    const exact = await executeQuery(connection, 'SELECT id FROM users')
    assert.equal(exact.truncated, false)
    assert.equal(exact.rowCount, 500)
    assert.equal(releases, 2)
  } finally {
    await closePool(connection.id)
  }
})

test('aborted queries destroy their connection rather than release it into the pool', async (t) => {
  const abort = new AbortController()
  let onStarted: () => void = () => {}
  const started = new Promise<void>(resolve => { onStarted = resolve })
  let destroyed = 0
  let released = 0
  const conn = { ...connection, id: 'security-cancel-fixture' }
  t.mock.method(mysql, 'createPool', () => ({
    getConnection: async () => ({
      // Match mysql2's behavior: closing a connection need not settle the pending query.
      query: async () => new Promise(() => { onStarted() }),
      destroy: () => { destroyed++ },
      release: () => { released++ },
    }),
    end: async () => {},
  }) as any)
  try {
    const result = executeQuery(conn, 'SELECT * FROM users', 'readonly', abort.signal)
    const rejected = assert.rejects(result, /SQL 请求已取消/)
    await started
    abort.abort()
    await rejected
    assert.equal(destroyed, 1)
    assert.equal(released, 0)
  } finally {
    await closePool(conn.id)
  }
})

test('a timed out query destroys its connection', async (t) => {
  let destroyed = 0
  let released = 0
  const conn = { ...connection, id: 'security-timeout-fixture' }
  t.mock.method(mysql, 'createPool', () => ({
    getConnection: async () => ({
      query: async () => { throw Object.assign(new Error('mock timeout'), { code: 'PROTOCOL_SEQUENCE_TIMEOUT' }) },
      destroy: () => { destroyed++ },
      release: () => { released++ },
    }),
    end: async () => {},
  }) as any)
  try {
    await assert.rejects(executeQuery(conn, 'SELECT * FROM users'), /mock timeout/)
    assert.equal(destroyed, 1)
    assert.equal(released, 0)
  } finally {
    await closePool(conn.id)
  }
})

test('metadata queries use the shared deadline and dispose of timed out connections', async (t) => {
  let destroyed = 0
  let released = 0
  const conn = { ...connection, id: 'security-metadata-timeout-fixture' }
  t.mock.method(mysql, 'createPool', () => ({
    getConnection: async () => ({
      query: async (options: { sql: string; timeout: number }) => {
        assert.equal(options.sql, 'SHOW TABLES')
        assert.equal(options.timeout, 30_000)
        throw Object.assign(new Error('mock metadata timeout'), { code: 'PROTOCOL_SEQUENCE_TIMEOUT' })
      },
      destroy: () => { destroyed++ },
      release: () => { released++ },
    }),
    end: async () => {},
  }) as any)
  try {
    await assert.rejects(listTables(conn), /mock metadata timeout/)
    assert.equal(destroyed, 1)
    assert.equal(released, 0)
  } finally {
    await closePool(conn.id)
  }
})

test('an aborted write explicitly reports that rollback is not guaranteed', async (t) => {
  const previousEnabled = process.env.SQL_WRITE_ENABLED
  const previousAllowlist = process.env.SQL_WRITE_ALLOWLIST
  process.env.SQL_WRITE_ENABLED = 'true'
  process.env.SQL_WRITE_ALLOWLIST = 'never-connect.invalid:3306/sandbox'
  const abort = new AbortController()
  const conn = { ...connection, id: 'security-write-cancel-fixture', env: 'dev' as const }
  t.mock.method(mysql, 'createPool', () => ({
    getConnection: async () => ({
      query: async () => {
        abort.abort()
        return [{ affectedRows: 1, insertId: 0, changedRows: 1 }, undefined]
      },
      destroy: () => {},
      release: () => { throw new Error('aborted connection must not be released') },
    }),
    end: async () => {},
  }) as any)
  try {
    await assert.rejects(executeQuery(conn, 'UPDATE users SET active=0 WHERE id=1', 'write', abort.signal), /不代表回滚/)
  } finally {
    await closePool(conn.id)
    if (previousEnabled === undefined) delete process.env.SQL_WRITE_ENABLED
    else process.env.SQL_WRITE_ENABLED = previousEnabled
    if (previousAllowlist === undefined) delete process.env.SQL_WRITE_ALLOWLIST
    else process.env.SQL_WRITE_ALLOWLIST = previousAllowlist
  }
})
