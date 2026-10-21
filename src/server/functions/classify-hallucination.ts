import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { createModel, generateText, getProvider } from '@/core'
import { resolveAiCredentials } from '@/server/ai-credentials'
import { parseAnswerCheck, type AnswerCheck } from '@/lib/answer-check'
import { withTrace } from '@/server/langfuse'

interface ClassifyInput {
  assistantContent: string
  hasToolCalls: boolean
  isContinuation: boolean
  evidence?: string
  provider?: string
  model?: string
  apiKey?: string
  baseURL?: string
  sessionId?: string
}

const CLASSIFIER_PROMPT = `你是数据库助手回复的辅助检查器。对照提供的真实查询结果检查是否存在明显编造或矛盾。
只有 evidence 中的数据可以作为数值依据；hasToolCalls 和 isContinuation 仅表示流程状态，不证明任何具体数字正确。
没有 evidence 时不要推断已有真实数据。若助手声称已经执行 SQL 或给出查询结果，但没有执行证据，应标记可疑。
结构探查、知识解释、待确认 SQL 不属于已执行结果。分析必须尊重 evidence 中的截断范围，不得把样本统计当作全表指标。
检查仅作为辅助，未发现明显问题也不代表已经验证业务口径或全部计算。
仅输出 JSON：{"hasFakeResult": boolean}`

export const classifyHallucination = createServerFn({ method: 'POST' })
  .inputValidator((data: ClassifyInput) => data)
  .handler(
    async ({ data }): Promise<AnswerCheck> => {
      const signal = getRequest().signal
      return withTrace({
        name: 'classify-hallucination',
        sessionId: data.sessionId,
        metadata: { provider: data.provider, model: data.model, hasToolCalls: data.hasToolCalls, isContinuation: data.isContinuation },
        tags: ['hallucination'],
      }, async () => {
        try {
            const provider = data.provider ?? 'deepseek'
          const providerDef = getProvider(provider)
          const model = createModel({
            provider: provider as any,
            model: data.model || providerDef.defaultModel,
            thinking: { type: 'disabled' },
            ...resolveAiCredentials(provider, data.apiKey, data.baseURL),
          } as any)

          const promptParts = [
            `hasToolCalls：${data.hasToolCalls ? '是' : '否'}`,
            `isContinuation：${data.isContinuation ? '是' : '否'}`,
            `查询结果证据：${data.evidence || "未提供执行结果"}`,
            `\n助手回复：${data.assistantContent}`,
          ]

          const result = await generateText({
            model,
            system: CLASSIFIER_PROMPT,
            prompt: promptParts.join('\n'),
            maxSteps: 1,
            signal,
          })

          return parseAnswerCheck(result.text)
        } catch (err) {
          signal.throwIfAborted()
          console.error('[classify] Hallucination classification failed:', err)
          return { hasFakeResult: null, status: 'unavailable' }
        }
      })
    }
  )
