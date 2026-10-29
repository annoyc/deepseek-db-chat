import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import mysql from 'mysql2'
import { probeDatabaseConnection } from '@/server/connection-probe'

const options: mysql.ConnectionOptions = {
  host: 'never-connect.invalid', user: 'fixture', password: 'synthetic', database: 'sandbox',
  ssl: { ca: 'synthetic-ca', rejectUnauthorized: true, verifyIdentity: true },
}

class FakeConnection extends EventEmitter {
  destroyed = 0
  pingCalls = 0
  connectReply: (error: Error | null) => void = () => {}
  pingReply: (error: Error | null) => void = () => {}

  connect(callback: (error: Error | null) => void) { this.connectReply = callback }
  ping(callback: (error: Error | null) => void) { this.pingCalls++; this.pingReply = callback }
  destroy() { this.destroyed++ }
  end() { throw new Error('A stalled graceful close must never be awaited') }
}

test('successful probes use the supplied TLS options and dispose of their one-off connection', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const connection = new FakeConnection()
  t.mock.method(mysql, 'createConnection', (received: mysql.ConnectionOptions) => {
    assert.strictEqual(received, options)
    return connection as unknown as mysql.Connection
  })
  const result = probeDatabaseConnection(options, 10)
  connection.connectReply(null)
  assert.equal(connection.pingCalls, 1)
  connection.pingReply(null)
  await result
  assert.equal(connection.destroyed, 1)
  t.mock.timers.tick(100)
  assert.doesNotThrow(() => {
    connection.emit('error', new Error('late socket error'))
    connection.emit('error', new Error('another late socket error'))
    connection.connectReply(null)
    connection.pingReply(new Error('late ping failure'))
  })
  assert.equal(connection.pingCalls, 1)
  assert.equal(connection.destroyed, 1)
})

test('a stalled handshake is destroyed at the total deadline and late completion is ignored', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const connection = new FakeConnection()
  t.mock.method(mysql, 'createConnection', () => connection as unknown as mysql.Connection)
  const result = probeDatabaseConnection(options, 10)
  const rejected = assert.rejects(result, { code: 'ETIMEDOUT' })
  t.mock.timers.tick(9)
  assert.equal(connection.destroyed, 0)
  t.mock.timers.tick(1)
  await rejected
  assert.equal(connection.destroyed, 1)
  assert.doesNotThrow(() => {
    connection.connectReply(null)
    connection.emit('error', new Error('late authentication failure'))
    connection.emit('error', new Error('late transport failure'))
  })
  assert.equal(connection.pingCalls, 0)
  assert.equal(connection.destroyed, 1)
})

test('the ping shares the original handshake deadline rather than starting a new timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const connection = new FakeConnection()
  t.mock.method(mysql, 'createConnection', () => connection as unknown as mysql.Connection)
  const result = probeDatabaseConnection(options, 10)
  const rejected = assert.rejects(result, { code: 'ETIMEDOUT' })
  t.mock.timers.tick(8)
  connection.connectReply(null)
  assert.equal(connection.pingCalls, 1)
  t.mock.timers.tick(2)
  await rejected
  assert.equal(connection.destroyed, 1)
  connection.pingReply(null)
  assert.equal(connection.destroyed, 1)
})

test('authentication failures retain their driver error and dispose of the connection', async (t) => {
  const connection = new FakeConnection()
  t.mock.method(mysql, 'createConnection', () => connection as unknown as mysql.Connection)
  const failure = Object.assign(new Error('Authentication failed'), { code: 'ER_ACCESS_DENIED_ERROR' })
  const result = probeDatabaseConnection(options)
  const rejected = assert.rejects(result, error => error === failure)
  connection.connectReply(failure)
  await rejected
  assert.equal(connection.destroyed, 1)
  assert.equal(connection.pingCalls, 0)
})

test('ping failures retain their driver error and dispose of the connection', async (t) => {
  const connection = new FakeConnection()
  t.mock.method(mysql, 'createConnection', () => connection as unknown as mysql.Connection)
  const failure = Object.assign(new Error('Connection lost during ping'), { code: 'ECONNRESET' })
  const result = probeDatabaseConnection(options)
  const rejected = assert.rejects(result, error => error === failure)
  connection.connectReply(null)
  connection.pingReply(failure)
  await rejected
  assert.equal(connection.destroyed, 1)
})

test('socket errors settle stalled probes and disposal errors cannot replace the original error', async (t) => {
  const connection = new FakeConnection()
  connection.destroy = () => { connection.destroyed++; throw new Error('Disposal failure') }
  t.mock.method(mysql, 'createConnection', () => connection as unknown as mysql.Connection)
  const failure = Object.assign(new Error('TLS socket reset'), { code: 'HANDSHAKE_SSL_ERROR' })
  const result = probeDatabaseConnection(options)
  const rejected = assert.rejects(result, error => error === failure)
  connection.emit('error', failure)
  await rejected
  assert.doesNotThrow(() => connection.emit('error', new Error('Late socket error')))
  assert.equal(connection.destroyed, 1)
})

test('synchronous constructor failures clear the pending deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const cleared = t.mock.method(globalThis, 'clearTimeout')
  const failure = new Error('Invalid connection configuration')
  t.mock.method(mysql, 'createConnection', () => { throw failure })
  await assert.rejects(probeDatabaseConnection(options, 10), error => error === failure)
  assert.equal(cleared.mock.callCount(), 1)
  t.mock.timers.tick(100)
})

test('synchronous connect and ping errors also dispose of their connections', async (t) => {
  for (const stage of ['connect', 'ping'] as const) {
    const connection = new FakeConnection()
    const failure = new Error(`Synchronous ${stage} failure`)
    connection[stage] = () => { throw failure }
    t.mock.method(mysql, 'createConnection', () => connection as unknown as mysql.Connection)
    const result = probeDatabaseConnection(options)
    const rejected = assert.rejects(result, error => error === failure)
    if (stage === 'ping') connection.connectReply(null)
    await rejected
    assert.equal(connection.destroyed, 1)
  }
})
