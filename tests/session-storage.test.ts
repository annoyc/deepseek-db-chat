import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeSessionChanges } from '../src/lib/session-storage'

test('full history persists beyond former 100/80-message limits and preserves other tabs', async () => {
  const untouched = { id: 'another-tab', messages: ['keep'] }
  const old = { id: 'active', messages: ['old'] }
  const removed = { id: 'removed', messages: ['delete'] }
  const rows = new Map([untouched, old, removed].map((s) => [s.id, s]))
  const updated = { id: 'active', messages: Array.from({ length: 250 }, (_, i) => String(i)) }
  const next = await writeSessionChanges({
    bulkPut: async (sessions) => { for (const session of sessions) rows.set(session.id, session) },
    bulkDelete: async (ids) => { for (const id of ids) rows.delete(id) },
  }, new Map([old, removed].map((s) => [s.id, s])), [updated])
  assert.equal(rows.get('active')?.messages.length, 250)
  assert.equal(rows.get('active')?.messages[0], '0')
  assert.equal(rows.get('another-tab'), untouched)
  assert.equal(rows.has('removed'), false)
  assert.equal(next.get('active'), updated)
})

test('failed persistence propagates for visible retry and does not mutate baseline', async () => {
  const old = { id: 'a', messages: ['old'] }
  const previous = new Map([['a', old]])
  await assert.rejects(writeSessionChanges({
    bulkPut: async () => { throw new Error('quota exceeded') }, bulkDelete: async () => {},
  }, previous, [{ id: 'a', messages: ['new'] }]), /quota/)
  assert.equal(previous.get('a'), old)
})
