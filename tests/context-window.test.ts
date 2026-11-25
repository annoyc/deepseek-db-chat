import test, { afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { z } from 'zod'
import committedIndex from '../knowledge/kb-index.json'
import { generateStream, tool, type StreamEvent } from '../src/core'
import { applyStreamUsage, emptyUsage } from '../src/core/generate/generate-utils'
import { createChatEventMapper } from '../src/server/chat-events'
import { encrypt } from '../src/server/crypto'
import { extractModelContextWindow, fetchProviderModelInfos } from '../src/server/providers'
import { createKnowledgeBase } from '../src/server/knowledge/knowledge-base'
import { runKnowledgePipeline, type KnowledgePipelineDeps } from '../src/server/knowledge/pipeline'
import type { KbIndexFile } from '../src/server/knowledge/types'
import {
  computeChatContextUsage,
  computeKnowledgeContextUsage,
  estimateTextTokens,
  formatContextPercent,
  parseContextWindowInput,
  resolveModelContextWindow,
} from '../src/lib/context-window'
import { ContextUsageIndicator, ContextUsagePopoverBody } from '../src/components/chat/ContextUsageIndicator'
import type { ChatMessage } from '../src/lib/types'
import type { KnowledgeMessage, KnowledgeStreamChunk } from '../src/lib/knowledge-types'

afterEach(() => mock.restoreAll())

test('resolveModelContextWindow follows 5-tier priority and handles updated model specs', () => {
  assert.deepEqual(
    resolveModelContextWindow('deepseek-chat', { tokens: 64_000, source: 'user' }),
    { tokens: 64_000, source: 'user' },
  )
  assert.deepEqual(
    resolveModelContextWindow('my-custom-model', { tokens: 262_144, source: 'api' }),
    { tokens: 262_144, source: 'api' },
  )
  assert.deepEqual(resolveModelContextWindow('deepseek-chat', 64_000), { tokens: 64_000, source: 'configured' })

  assert.deepEqual(resolveModelContextWindow('deepseek-flash'), { tokens: 1_000_000, source: 'known' })
  assert.deepEqual(resolveModelContextWindow('deepseek-v4-pro'), { tokens: 1_000_000, source: 'known' })
  assert.deepEqual(resolveModelContextWindow('deepseek/deepseek-chat'), { tokens: 128_000, source: 'known' })
  assert.deepEqual(resolveModelContextWindow('deepseek-v3.2'), { tokens: 128_000, source: 'known' })
  assert.deepEqual(resolveModelContextWindow('qwen-long'), { tokens: 10_000_000, source: 'known' })
  assert.deepEqual(resolveModelContextWindow('qwen3.7-plus'), { tokens: 1_000_000, source: 'known' })
  assert.deepEqual(resolveModelContextWindow('qwen3-max'), { tokens: 1_000_000, source: 'known' })
  assert.deepEqual(resolveModelContextWindow('qwen-plus-latest'), { tokens: 1_000_000, source: 'known' })
  assert.deepEqual(resolveModelContextWindow('qwen-plus'), { tokens: 128_000, source: 'known' })
  assert.deepEqual(resolveModelContextWindow('qwen-max'), { tokens: 32_000, source: 'known' })
  assert.deepEqual(resolveModelContextWindow('glm-5.2'), { tokens: 1_000_000, source: 'known' })
  assert.deepEqual(resolveModelContextWindow('glm-5'), { tokens: 200_000, source: 'known' })
  assert.deepEqual(resolveModelContextWindow('kimi-k2.7-code'), { tokens: 256_000, source: 'known' })
  assert.deepEqual(resolveModelContextWindow('kimi-k2.8'), { tokens: 1_000_000, source: 'known' })
  assert.deepEqual(resolveModelContextWindow('kimi-k3-256k'), { tokens: 256_000, source: 'known' })
  assert.deepEqual(resolveModelContextWindow('moonshot-v1-32k'), { tokens: 32_000, source: 'known' })
  assert.deepEqual(resolveModelContextWindow('openai/gpt-4.1-mini'), { tokens: 1_000_000, source: 'known' })
  assert.deepEqual(resolveModelContextWindow('gpt-5'), { tokens: 400_000, source: 'known' })
  assert.deepEqual(resolveModelContextWindow('o3-mini'), { tokens: 200_000, source: 'known' })
  assert.deepEqual(resolveModelContextWindow('gpt-4o'), { tokens: 128_000, source: 'known' })
  assert.deepEqual(resolveModelContextWindow('anthropic/claude-sonnet-4'), { tokens: 200_000, source: 'known' })
  assert.deepEqual(resolveModelContextWindow('gemini-2.5-pro'), { tokens: 1_000_000, source: 'known' })
  assert.deepEqual(resolveModelContextWindow('some-unknown-model'), { tokens: 128_000, source: 'default' })
})

test('parseContextWindowInput parses k/M/integer formats and rejects invalid values', () => {
  assert.equal(parseContextWindowInput('128k'), 128_000)
  assert.equal(parseContextWindowInput(' 256K '), 256_000)
  assert.equal(parseContextWindowInput('1M'), 1_000_000)
  assert.equal(parseContextWindowInput('1.5m'), 1_500_000)
  assert.equal(parseContextWindowInput('200,000'), 200_000)
  assert.equal(parseContextWindowInput('500'), null)
  assert.equal(parseContextWindowInput('abc'), null)
  assert.equal(parseContextWindowInput(''), null)
})

test('extractModelContextWindow and fetchProviderModelInfos extract context limits from OpenAI-compatible /models', async () => {
  assert.equal(extractModelContextWindow({ id: 'a', context_length: 131_072 }), 131_072)
  assert.equal(extractModelContextWindow({ id: 'b', top_provider: { context_length: 200_000 } }), 200_000)
  assert.equal(extractModelContextWindow({ id: 'c', max_model_len: 65_536 }), 65_536)
  assert.equal(extractModelContextWindow({ id: 'd', context_window: 256_000 }), 256_000)
  assert.equal(extractModelContextWindow({ id: 'e', limits: { context: 1_000_000 } }), 1_000_000)
  assert.equal(extractModelContextWindow({ id: 'f', context_length: 10 }), undefined)

  const prevKey = process.env.ENCRYPTION_KEY
  process.env.ENCRYPTION_KEY = '11'.repeat(32)
  try {
    mock.method(globalThis, 'fetch', async () => Response.json({
      object: 'list',
      data: [
        { id: 'z-plain', object: 'model', owned_by: 'openai' },
        { id: 'a-vllm', object: 'model', max_model_len: 32_768 },
        { id: 'a-vllm', object: 'model' },
        { id: 'm-router', object: 'model', context_length: 200_000 },
      ],
    }))

    const models = await fetchProviderModelInfos({
      provider: 'custom-gw',
      apiKey: encrypt('user-key'),
      baseURL: 'https://gateway.example/v1',
    })
    assert.deepEqual(models, [
      { id: 'a-vllm', contextWindow: 32_768 },
      { id: 'm-router', contextWindow: 200_000 },
      { id: 'z-plain' },
    ])
  } finally {
    if (prevKey === undefined) delete process.env.ENCRYPTION_KEY
    else process.env.ENCRYPTION_KEY = prevKey
  }
})

test('estimateTextTokens and formatContextPercent handle empty, sub-percent, and overflow boundaries', () => {
  assert.equal(estimateTextTokens(''), 0)
  assert.equal(estimateTextTokens('   \n\t '), 0)
  assert.ok(estimateTextTokens('查询最近30天订单销售额') > 0)
  assert.ok(estimateTextTokens('SELECT COUNT(*) FROM orders;') > 0)

  assert.equal(formatContextPercent(0, 0), '0%')
  assert.equal(formatContextPercent(0.0005, 500), '<0.1%')
  assert.equal(formatContextPercent(0.0423, 42_300), '4.2%')
  assert.equal(formatContextPercent(0.644, 644_000), '64%')
  assert.equal(formatContextPercent(1.024, 131_000), '102%')
})

test('applyStreamUsage treats cumulative SSE chunks as snapshots and ignores trailing zeros', () => {
  const usage = emptyUsage()
  // First chunk reports prompt_tokens and partial completion_tokens (like Gemini/DashScope gateways)
  applyStreamUsage(usage, { prompt_tokens: 1200, completion_tokens: 10, total_tokens: 1210 })
  applyStreamUsage(usage, { prompt_tokens: 1200, completion_tokens: 45, total_tokens: 1245 })
  applyStreamUsage(usage, { prompt_tokens: 1200, completion_tokens: 90, total_tokens: 1290, cached_tokens: 600 })
  // Trailing empty/zero chunk must not wipe earlier valid counts
  applyStreamUsage(usage, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 })

  assert.equal(usage.prompt_tokens, 1200)
  assert.equal(usage.completion_tokens, 90)
  assert.equal(usage.total_tokens, 1290)
  assert.equal(usage.cached_tokens, 600)
})

test('computeChatContextUsage handles idle, draft, thinkingStyle rules, cache rate, session total, fallback, and thresholds', () => {
  const idle = computeChatContextUsage({
    messages: [],
    draftText: '',
    modelId: 'deepseek-flash',
    configuredContextWindow: 1_000_000,
  })
  assert.equal(idle.source, 'idle')
  assert.equal(idle.usedTokens, 0)
  assert.equal(idle.percentText, '0%')
  assert.equal(idle.level, 'normal')

  const withDraft = computeChatContextUsage({
    messages: [],
    draftText: '统计上个月每个大区的电量成交均值',
    modelId: 'deepseek-flash',
    configuredContextWindow: 1_000_000,
  })
  assert.equal(withDraft.source, 'estimated')
  assert.equal(withDraft.includesDraftEstimate, true)
  assert.ok(withDraft.breakdown.draftTokens > 0)
  assert.equal(withDraft.usedTokens, withDraft.breakdown.draftTokens)

  const finishedTurnMessages: ChatMessage[] = [
    { id: 'u1', role: 'user', content: '查一下今年总电量', timestamp: '2026-11-25T00:00:00Z' },
    {
      id: 'a1',
      role: 'assistant',
      content: '今年总电量为 1,200 MWh。',
      timestamp: '2026-11-25T00:00:05Z',
      usage: { promptTokens: 4000, completionTokens: 800, totalTokens: 4800, cost: 0.002, costCurrency: 'USD' },
      contextUsage: {
        promptTokens: 3200,
        completionTokens: 600,
        totalTokens: 3800,
        cachedTokens: 1600,
        reasoningTokens: 400,
      },
      answerUsage: {
        promptTokens: 9000,
        completionTokens: 1500,
        totalTokens: 10500,
        cost: 0.005,
        costCurrency: 'USD',
      },
    },
  ]

  // Finished turn: reasoningTokens (400) excluded from context occupancy, answerUsage used for session total.
  const finishedSummary = computeChatContextUsage({
    messages: finishedTurnMessages,
    draftText: '',
    modelId: 'deepseek-chat',
    thinkingStyle: 'deepseek',
  })
  assert.equal(finishedSummary.source, 'measured')
  assert.equal(finishedSummary.usedTokens, 3200 + (600 - 400))
  assert.equal(finishedSummary.cachedTokens, 1600)
  assert.equal(finishedSummary.cacheHitRate, 0.5)
  assert.equal(finishedSummary.sessionUsage?.totalTokens, 10500)
  assert.equal(finishedSummary.sessionUsage?.cost, 0.005)
  assert.equal(finishedSummary.turnCount, 1)

  // Suspended turn (agentState present): DeepSeek replays reasoning, non-DeepSeek strips it.
  const suspendedMessages: ChatMessage[] = [
    finishedTurnMessages[0],
    { ...finishedTurnMessages[1], agentState: { state: {}, toolCallId: 'c1' } },
  ]
  const suspendedDeepSeek = computeChatContextUsage({
    messages: suspendedMessages,
    draftText: '',
    modelId: 'deepseek-chat',
    thinkingStyle: 'deepseek',
    thinkingMode: 'enabled',
  })
  assert.equal(suspendedDeepSeek.usedTokens, 3200 + 600)

  const suspendedBailian = computeChatContextUsage({
    messages: suspendedMessages,
    draftText: '',
    modelId: 'qwen3.7-plus',
    thinkingStyle: 'enable_thinking',
    thinkingMode: 'enabled',
  })
  assert.equal(suspendedBailian.usedTokens, 3200 + (600 - 400))

  // Legacy unmeasured session falls back to estimation, and warning/danger thresholds trigger accurately.
  const unmeasured = computeChatContextUsage({
    messages: [
      { id: 'u1', role: 'user', content: '你好', timestamp: '2026-11-25T00:00:00Z' },
      { id: 'a1', role: 'assistant', content: '你好，请问有什么可以帮您？', timestamp: '2026-11-25T00:00:02Z' },
    ],
    draftText: '',
    modelId: 'deepseek-chat',
  })
  assert.equal(unmeasured.source, 'estimated')
  assert.ok(unmeasured.usedTokens >= 2800)

  const warningSummary = computeChatContextUsage({
    messages: [
      { id: 'u1', role: 'user', content: '问题', timestamp: '2026-11-25T00:00:00Z' },
      {
        id: 'a1',
        role: 'assistant',
        content: '回答',
        timestamp: '2026-11-25T00:00:01Z',
        contextUsage: { promptTokens: 65_000, completionTokens: 2_000, totalTokens: 67_000 },
      },
    ],
    draftText: '',
    configuredContextWindow: 100_000,
  })
  assert.equal(warningSummary.level, 'warning')

  const dangerSummary = computeChatContextUsage({
    messages: [
      { id: 'u1', role: 'user', content: '问题', timestamp: '2026-11-25T00:00:00Z' },
      {
        id: 'a1',
        role: 'assistant',
        content: '回答',
        timestamp: '2026-11-25T00:00:01Z',
        contextUsage: { promptTokens: 86_000, completionTokens: 1_000, totalTokens: 87_000 },
      },
    ],
    draftText: '',
    configuredContextWindow: 100_000,
  })
  assert.equal(dangerSummary.level, 'danger')
})

test('computeKnowledgeContextUsage supports measured usage, reasoning exclusion after completion, and 6-turn fallback', () => {
  const measured = computeKnowledgeContextUsage({
    messages: [
      { id: 'u1', role: 'user', content: '绿电如何结算？', timestamp: '2026-11-25T00:00:00Z' },
      {
        id: 'a1',
        role: 'assistant',
        content: '电能量与环境价值分开结算[1]。',
        timestamp: '2026-11-25T00:00:02Z',
        contextUsage: {
          promptTokens: 4500,
          completionTokens: 550,
          totalTokens: 5050,
          cachedTokens: 900,
          reasoningTokens: 200,
        },
        evidence: {
          subQuestions: [],
          memorySnippets: [],
          webResults: [],
          progress: [],
          toolSteps: [],
          citations: [{
            ref: '1',
            chunkId: 'c1',
            docTitle: '电力中长期市场基本规则',
            locator: '第七十七条',
            headings: [],
            text: '绿电交易中电能量价格与环境价值分开结算。',
            status: 'active',
            statusLabel: '现行有效',
            retrievers: ['keyword'],
          }],
        },
      },
    ],
    draftText: '继续追问',
    modelId: 'deepseek-flash',
    configuredContextWindow: 1_000_000,
  })
  assert.equal(measured.source, 'measured')
  assert.equal(measured.includesDraftEstimate, true)
  // Finished answer drops reasoningTokens (200)
  assert.equal(measured.usedTokens, 4500 + (550 - 200) + measured.breakdown.draftTokens)
  assert.equal(measured.cachedTokens, 900)
  assert.equal(measured.cacheHitRate, 0.2)

  // More than 6 non-empty history messages: fallback only counts the latest 6 turns like prompt.ts.
  const manyMessages: KnowledgeMessage[] = Array.from({ length: 10 }, (_, idx) => ({
    id: `m${idx}`,
    role: idx % 2 === 0 ? 'user' : 'assistant',
    content: '长规则条款历史内容'.repeat(20),
    timestamp: '2026-11-25T00:00:00Z',
  }))
  const sixMessages = manyMessages.slice(-6)
  const fallbackTen = computeKnowledgeContextUsage({ messages: manyMessages, draftText: '', modelId: 'deepseek-chat' })
  const fallbackSix = computeKnowledgeContextUsage({ messages: sixMessages, draftText: '', modelId: 'deepseek-chat' })
  assert.equal(fallbackTen.source, 'estimated')
  assert.equal(fallbackTen.breakdown.historyTokens, fallbackSix.breakdown.historyTokens)
})

test('generateStream does not inflate multi-chunk cumulative usage and separates step context from billing total', async () => {
  let callIdx = 0
  const model = {
    config: {},
    withConfig() { return model },
    async *invokeStream() {
      const idx = callIdx++
      if (idx === 0) {
        // Provider emits cumulative usage across multiple chunks of step 1
        yield {
          choices: [{
            delta: { tool_calls: [{ index: 0, id: 'tc1', type: 'function', function: { name: 'ping', arguments: '' } }] },
            finish_reason: null,
          }],
          usage: { prompt_tokens: 1000, completion_tokens: 20, total_tokens: 1020 },
        }
        yield {
          choices: [{
            delta: { tool_calls: [{ index: 0, function: { arguments: '{}' } }] },
            finish_reason: 'tool_calls',
          }],
          usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 },
        }
      } else {
        yield {
          choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1600, completion_tokens: 200, total_tokens: 1800 },
        }
      }
    },
  }
  const pingTool = tool({
    name: 'ping',
    description: 'ping',
    schema: z.object({}),
    execute: () => 'pong',
  })

  const events: StreamEvent[] = []
  for await (const event of generateStream({ model: model as any, tools: [pingTool], prompt: 'hi' })) {
    events.push(event)
  }

  const mapper = createChatEventMapper()
  const mappedChunks = events.flatMap(event => mapper(event))
  const contextChunks = mappedChunks.filter(c => c.type === 'context-usage')
  const finishUsageChunk = mappedChunks.find(c => c.type === 'usage')

  assert.equal(contextChunks.length, 2)
  assert.equal(contextChunks[0].usage.totalTokens, 1100)
  assert.equal(contextChunks[1].usage.promptTokens, 1600)
  assert.equal(contextChunks[1].usage.totalTokens, 1800)
  assert.equal(finishUsageChunk?.usage.totalTokens, 2900)
})

test('runKnowledgePipeline emits context-usage from cumulative SSE chunks without double counting', async () => {
  const kb = createKnowledgeBase(committedIndex as unknown as KbIndexFile)
  const deps: KnowledgePipelineDeps = {
    knowledgeBase: async () => kb,
    now: () => new Date('2026-11-09T04:00:00Z'),
    chatModel: ({ purpose }) => ({
      async invoke() {
        return {
          choices: [{ message: { content: '{"standalone":"绿电交易价格如何结算","subQuestions":[],"keywords":["绿电","结算"]}' } }],
        } as any
      },
      async *invokeStream() {
        assert.equal(purpose, 'answer')
        yield {
          choices: [{ delta: { content: '电能量与绿电环境价值' } }],
          usage: { prompt_tokens: 2400, completion_tokens: 60, total_tokens: 2460 },
        } as any
        yield {
          choices: [{ delta: { content: '分开结算[1]。' } }],
          usage: { prompt_tokens: 2400, completion_tokens: 180, total_tokens: 2580, cached_tokens: 600 },
        } as any
      },
    }),
  }

  const chunks: KnowledgeStreamChunk[] = []
  for await (const chunk of runKnowledgePipeline(
    { message: '绿电的价格怎么结算？', history: [], useWebSearch: false, useBaseModel: true, answerMode: 'standard' },
    deps,
  )) {
    chunks.push(chunk)
  }

  const contextChunk = chunks.find((c): c is Extract<KnowledgeStreamChunk, { type: 'context-usage' }> => c.type === 'context-usage')
  assert.ok(contextChunk)
  assert.equal(contextChunk.usage.promptTokens, 2400)
  assert.equal(contextChunk.usage.completionTokens, 180)
  assert.equal(contextChunk.usage.cachedTokens, 600)
})

test('ContextUsageIndicator and ContextUsagePopoverBody render api, user, and danger states cleanly', () => {
  const idleUsage = computeChatContextUsage({
    messages: [],
    draftText: '',
    modelId: 'deepseek-flash',
    configuredContextWindow: 1_000_000,
  })
  const triggerMarkup = renderToStaticMarkup(
    createElement(ContextUsageIndicator, { usage: idleUsage, modelName: 'DeepSeek V4.1 Flash' }),
  )
  assert.ok(triggerMarkup.includes('0%'))
  assert.ok(triggerMarkup.includes('上下文占用 0 / 1M (0%)，点击查看详情'))

  const apiWindowUsage = computeChatContextUsage({
    messages: [],
    draftText: '',
    modelId: 'custom-vllm-model',
    contextWindowOverride: { tokens: 65_536, source: 'api' },
  })
  const apiBodyMarkup = renderToStaticMarkup(
    createElement(ContextUsagePopoverBody, {
      usage: apiWindowUsage,
      modelName: 'custom-vllm-model',
      onSetContextWindow: () => {},
    }),
  )
  assert.ok(apiBodyMarkup.includes('（接口获取）'))
  assert.ok(apiBodyMarkup.includes('设置模型上下文窗口'))

  const measuredDangerUsage = computeChatContextUsage({
    messages: [
      { id: 'u1', role: 'user', content: '分析最近一年数据', timestamp: '2026-11-25T00:00:00Z' },
      {
        id: 'a1',
        role: 'assistant',
        content: '已输出分析报告',
        timestamp: '2026-11-25T00:00:05Z',
        usage: { promptTokens: 88_000, completionTokens: 2_000, totalTokens: 90_000, cost: 0.012, costCurrency: 'USD' },
        contextUsage: { promptTokens: 88_000, completionTokens: 2_000, totalTokens: 90_000, cachedTokens: 44_000 },
      },
    ],
    draftText: '',
    modelId: 'custom-model',
    contextWindowOverride: { tokens: 100_000, source: 'user' },
  })
  const dangerBodyMarkup = renderToStaticMarkup(
    createElement(ContextUsagePopoverBody, {
      usage: measuredDangerUsage,
      modelName: 'Custom Model',
      canStartNewSession: true,
      onNewSession: () => {},
    }),
  )
  assert.ok(dangerBodyMarkup.includes('（自定义）'))
  assert.ok(dangerBodyMarkup.includes('实测'))
  assert.ok(dangerBodyMarkup.includes('90%'))
  assert.ok(dangerBodyMarkup.includes('缓存命中'))
  assert.ok(dangerBodyMarkup.includes('50%'))
  assert.ok(dangerBodyMarkup.includes('会话累计消耗'))
  assert.ok(dangerBodyMarkup.includes('$0.012'))
  assert.ok(dangerBodyMarkup.includes('上下文接近上限'))
  assert.ok(dangerBodyMarkup.includes('开启新对话'))
})
