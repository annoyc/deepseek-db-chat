import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatTokenCount,
  formatUsageCost,
  formatUsageTooltip,
  normalizeModelUsage,
  sumTokenUsage,
} from '../src/lib/usage'
import { createChatEventMapper } from '../src/server/chat-events'

test('normalizeModelUsage handles DeepSeek, OpenAI/OpenRouter, and empty payloads', () => {
  assert.equal(normalizeModelUsage(undefined), null)
  assert.equal(normalizeModelUsage({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }), null)

  assert.deepEqual(
    normalizeModelUsage({
      prompt_tokens: 8200,
      completion_tokens: 1400,
      total_tokens: 9600,
      prompt_cache_hit_tokens: 6000,
      completion_tokens_details: { reasoning_tokens: 520 },
    }),
    {
      promptTokens: 8200,
      completionTokens: 1400,
      totalTokens: 9600,
      cachedTokens: 6000,
      reasoningTokens: 520,
    },
  )

  assert.deepEqual(
    normalizeModelUsage({
      prompt_tokens: 1000,
      completion_tokens: 500,
      prompt_tokens_details: { cached_tokens: 400 },
      cost: 0.0042,
    }),
    {
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
      cachedTokens: 400,
      cost: 0.0042,
      costCurrency: 'USD',
    },
  )
})

test('sumTokenUsage aggregates multi-step usage and guards mixed currencies', () => {
  assert.equal(sumTokenUsage([undefined, null]), undefined)

  const summed = sumTokenUsage([
    { promptTokens: 2000, completionTokens: 300, totalTokens: 2300, cachedTokens: 1000, cost: 0.001, costCurrency: 'USD' },
    { promptTokens: 3500, completionTokens: 700, totalTokens: 4200, reasoningTokens: 250, cost: 0.0025, costCurrency: 'USD' },
  ])
  assert.ok(summed)
  assert.equal(summed.promptTokens, 5500)
  assert.equal(summed.completionTokens, 1000)
  assert.equal(summed.totalTokens, 6500)
  assert.equal(summed.cachedTokens, 1000)
  assert.equal(summed.reasoningTokens, 250)
  assert.ok(Math.abs((summed.cost ?? 0) - 0.0035) < 1e-9)
  assert.equal(summed.costCurrency, 'USD')

  const mixed = sumTokenUsage([
    { promptTokens: 100, completionTokens: 50, totalTokens: 150, cost: 0.01, costCurrency: 'USD' },
    { promptTokens: 100, completionTokens: 50, totalTokens: 150, cost: 0.05, costCurrency: 'CNY' },
  ])
  assert.equal(mixed?.totalTokens, 300)
  assert.equal(mixed?.cost, undefined)
})

test('token, cost, and tooltip formatters produce concise human-readable output', () => {
  assert.equal(formatTokenCount(856), '856')
  assert.equal(formatTokenCount(1000), '1k')
  assert.equal(formatTokenCount(12450), '12.5k')
  assert.equal(formatTokenCount(128400), '128k')
  assert.equal(formatTokenCount(1_250_000), '1.25M')

  assert.equal(formatUsageCost(0.00004, 'USD'), '<$0.0001')
  assert.equal(formatUsageCost(0.0042, 'USD'), '$0.0042')
  assert.equal(formatUsageCost(0.125, 'CNY'), '¥0.125')
  assert.equal(formatUsageCost(1.5, 'USD'), '$1.50')

  const tip = formatUsageTooltip({
    promptTokens: 10820,
    completionTokens: 1580,
    totalTokens: 12400,
    cachedTokens: 6400,
    reasoningTokens: 620,
    cost: 0.0042,
    costCurrency: 'USD',
  })
  assert.equal(tip, '输入 10,820（缓存命中 6,400） · 输出 1,580（含思考 620） · 合计 12,400 tokens · 费用 $0.0042')
})

test('createChatEventMapper emits usage once before sql-confirm and skips empty usage', () => {
  const map = createChatEventMapper()
  const suspendedState = {
    messages: [],
    pending: [{ toolCallId: 'c1', name: 'execute_sql', arguments: '{}', payload: { sql: 'SELECT 1', explanation: 'test' } }],
  }

  const suspendChunks = map({
    type: 'suspend',
    step: 1,
    state: suspendedState,
    usage: { prompt_tokens: 1200, completion_tokens: 200, total_tokens: 1400 },
  })
  assert.equal(suspendChunks[0]?.type, 'usage')
  assert.equal(suspendChunks[1]?.type, 'agent-suspended')
  assert.equal(suspendChunks[2]?.type, 'sql-confirm')

  // Trailing finish after suspend must not emit a duplicate usage chunk.
  const suspendedFinish = map({
    type: 'finish',
    suspended: suspendedState,
    usage: { prompt_tokens: 1200, completion_tokens: 200, total_tokens: 1400 },
  })
  assert.deepEqual(suspendedFinish, [])

  // Normal finish with usage emits one usage chunk; empty usage emits nothing.
  const normalFinish = map({
    type: 'finish',
    usage: { prompt_tokens: 3000, completion_tokens: 500, total_tokens: 3500 },
  })
  assert.equal(normalFinish.length, 1)
  assert.equal(normalFinish[0]?.type, 'usage')

  const emptyFinish = map({
    type: 'finish',
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  })
  assert.deepEqual(emptyFinish, [])
})
