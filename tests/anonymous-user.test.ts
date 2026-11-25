import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ANONYMOUS_USER_COOKIE,
  createAnonymousUserId,
  ensureAnonymousUserCookie,
  isValidAnonymousUserId,
  parseAnonymousUserIdFromCookieHeader,
} from '../src/lib/anonymous-user'
import { resolveUserId } from '../src/server/langfuse'

test('createAnonymousUserId generates valid anon-prefixed identifiers', () => {
  const first = createAnonymousUserId()
  const second = createAnonymousUserId()
  assert.ok(isValidAnonymousUserId(first))
  assert.ok(isValidAnonymousUserId(second))
  assert.notEqual(first, second)
})

test('parseAnonymousUserIdFromCookieHeader extracts valid cookie and rejects invalid values', () => {
  assert.equal(
    parseAnonymousUserIdFromCookieHeader(`theme=dark; ${ANONYMOUS_USER_COOKIE}=anon_550e8400-e29b-41d4-a716-446655440000; other=1`),
    'anon_550e8400-e29b-41d4-a716-446655440000',
  )
  assert.equal(parseAnonymousUserIdFromCookieHeader(`${ANONYMOUS_USER_COOKIE}=alice@example.com`), undefined)
  assert.equal(parseAnonymousUserIdFromCookieHeader(`${ANONYMOUS_USER_COOKIE}=anon_short`), undefined)
  assert.equal(parseAnonymousUserIdFromCookieHeader(`${ANONYMOUS_USER_COOKIE}=anon_123`), undefined)
  assert.equal(parseAnonymousUserIdFromCookieHeader(`${ANONYMOUS_USER_COOKIE}=anon_${'a'.repeat(100)}`), undefined)
  assert.equal(parseAnonymousUserIdFromCookieHeader(''), undefined)
  assert.equal(parseAnonymousUserIdFromCookieHeader(null), undefined)
})

test('ensureAnonymousUserCookie reuses valid cookie and sets a new cookie when absent', () => {
  const existingDoc = { cookie: `${ANONYMOUS_USER_COOKIE}=anon_existing_1234` }
  assert.equal(ensureAnonymousUserCookie(existingDoc, { protocol: 'http:' }), 'anon_existing_1234')
  assert.equal(existingDoc.cookie, `${ANONYMOUS_USER_COOKIE}=anon_existing_1234`)

  const freshDoc = { cookie: '' }
  const created = ensureAnonymousUserCookie(freshDoc, { protocol: 'https:' })
  assert.ok(created && isValidAnonymousUserId(created))
  assert.ok(freshDoc.cookie.startsWith(`${ANONYMOUS_USER_COOKIE}=${created}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`))

  const httpDoc = { cookie: '' }
  const createdHttp = ensureAnonymousUserCookie(httpDoc, { protocol: 'http:' })
  assert.ok(createdHttp && isValidAnonymousUserId(createdHttp))
  assert.equal(httpDoc.cookie.includes('; Secure'), false)
})

test('resolveUserId reads anonymous cookie from Request and returns undefined outside request context', () => {
  const req = new Request('http://localhost:3000/api', {
    headers: { cookie: `foo=bar; ${ANONYMOUS_USER_COOKIE}=anon_trace_user_001` },
  })
  assert.equal(resolveUserId(req), 'anon_trace_user_001')

  const invalidReq = new Request('http://localhost:3000/api', {
    headers: { cookie: `${ANONYMOUS_USER_COOKIE}=not-valid` },
  })
  assert.equal(resolveUserId(invalidReq), undefined)

  assert.equal(resolveUserId(), undefined)
})
