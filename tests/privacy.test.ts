import { test } from 'node:test'
import assert from 'node:assert/strict'
import { maskPII, sanitizeModelData, sanitizeModelMessages } from '../src/lib/masking'

test('structured samples remove sensitive columns and PII without changing measures', () => {
  const sample = { email: 'alice@example.com', phone: 13812345678, amount: 123.45, note: '联系 bob@example.org', nested: { password: 'secret-value' } }
  const masked = sanitizeModelData(sample) as Record<string, unknown>
  assert.equal(masked.amount, 123.45)
  assert.equal(masked.email, '[已脱敏]')
  assert.equal(masked.phone, '[已脱敏]')
  assert.equal(JSON.stringify(masked).includes('secret-value'), false)
  assert.equal(JSON.stringify(masked).includes('bob@example.org'), false)
  assert.equal(sample.email, 'alice@example.com')
})

test('model message sanitization preserves tool protocol and masks arguments/results', () => {
  const original = [
    { role: 'assistant', tool_calls: [{ id: 'call_13812345678', type: 'function', function: { name: 'execute_sql', arguments: JSON.stringify({ sql: "SELECT * FROM people WHERE email='alice@example.com'" }) } }] },
    { role: 'tool', tool_call_id: 'call_13812345678', content: 'alice@example.com 13812345678' },
  ]
  const masked = sanitizeModelMessages(original)
  assert.equal(masked[0].tool_calls?.[0].id, 'call_13812345678')
  assert.equal(masked[0].tool_calls?.[0].function.name, 'execute_sql')
  assert.equal(masked[1].tool_call_id, 'call_13812345678')
  assert.equal(masked[1].content?.includes('alice@example.com'), false)
  assert.equal(masked[0].tool_calls?.[0].function.arguments.includes('alice@example.com'), false)
  assert.equal(original[1].content, 'alice@example.com 13812345678')
})

test('masking is stable when applied repeatedly at multiple boundaries', () => {
  const value = '13812345678 alice@example.com 110101199001011234'
  assert.equal(maskPII(maskPII(value)), maskPII(value))
})

test('JSON and nested JSON tool outputs redact sensitive field values at the model boundary', () => {
  const content = JSON.stringify({ success: true, data: JSON.stringify({ password: 'secret-value', amount: 12.3, token: 'ordinary-code' }) })
  const output = sanitizeModelMessages([{ role: 'tool', tool_call_id: 'call_safe', content }])[0]
  assert.equal(output.content.includes('secret-value'), false)
  assert.equal(output.tool_call_id, 'call_safe')
  assert.equal(JSON.parse(JSON.parse(output.content).data).amount, 12.3)
})
