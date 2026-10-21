import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAnswerCheck } from '../src/lib/answer-check'

test('failed or malformed answer checks remain unknown instead of reporting no hallucination', () => {
  for (const text of ['', '{', '{"hasFakeResult":"false"}', '{"other":true}']) {
    assert.deepEqual(parseAnswerCheck(text), { hasFakeResult: null, status: 'unavailable' })
  }
  assert.deepEqual(parseAnswerCheck('{"hasFakeResult":false}'), { hasFakeResult: false, status: 'not_detected' })
  assert.deepEqual(parseAnswerCheck('{"hasFakeResult":true}'), { hasFakeResult: true, status: 'suspected' })
})
