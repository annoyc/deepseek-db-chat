import { createServerFn } from '@tanstack/react-start'
import { createModel, generateText, getProvider } from '@/core'
import { decrypt } from '@/server/crypto'

interface ClassifyInput {
  assistantContent: string
  hasToolCalls: boolean
  isContinuation: boolean
  provider?: string
  model?: string
  apiKey?: string
  baseURL?: string
}

const CLASSIFIER_PROMPT = `你是一个幻觉检测分类器。判断数据库助手的回复是否包含编造的内容。

你将收到三个上下文信息：
1. 助手的回复文本
2. hasToolCalls：助手在本轮是否调用了工具
3. isContinuation：当前会话中是否存在真实的 SQL 执行记录。为 true 表示助手在本次会话中曾经收到过真实的 SQL 执行结果（可能是本轮刚刚执行完的反馈，也可能是之前轮次执行后留在上下文中的历史结果）。助手可以看到这些真实结果，因此引用其中的数据是合法的。

【最高优先级规则】：
如果 isContinuation = true，说明助手的上下文中包含真实的 SQL 执行结果。此时助手回复中出现的任何具体数据（姓名、手机号、邮箱、数字、ID、状态值等）都应被视为来自真实执行结果或会话历史记录，不算幻觉。只有当助手在 isContinuation=true 时编造了明显超出执行结果范围的内容（例如执行结果只有查询数据，助手却声称删除了100条记录），才判定为幻觉。

【核心判断逻辑】：

hasFakeResult = true（幻觉）的情况：
- isContinuation=false 且 hasToolCalls=false 时，助手声称 SQL 已执行成功或展示了具体的查询数据（姓名、手机号、邮箱等）
- isContinuation=false 时，助手承诺要执行某个动作（如"让我查一下"、"我来删除"），但 hasToolCalls 为 false，即没有实际调用工具
- isContinuation=false 时，助手编造了不存在的查询数据，且这些数据不可能来自任何真实来源

hasFakeResult = false（正常）的情况：
- isContinuation 为 true 时，助手分析、总结、转述之前真正执行过的 SQL 结果（无论是本轮还是前几轮执行的）— 这是合法的回复，不是幻觉。助手在此场景下引用执行结果中的具体数据（包括查询返回的行数据、影响的行数、insertId 等）都是正常的
- isContinuation 为 true 时，助手基于历史执行结果给出建议、回答追问或规划下一步操作
- 助手调用了工具（hasToolCalls=true），说明它正在通过工具获取数据
- 助手展示 SQL 供用户确认执行（如"以下是生成的 SQL，请确认后执行"）
- 助手做知识解答或规划下一步操作

只输出 JSON，不要输出其他任何内容。`

export const classifyHallucination = createServerFn({ method: 'POST' })
  .inputValidator((data: ClassifyInput) => data)
  .handler(
    async ({ data }): Promise<{ hasFakeResult: boolean }> => {
      try {
        const decryptedApiKey = data.apiKey ? decrypt(data.apiKey) : undefined
        const provider = data.provider ?? 'deepseek'
        const providerDef = getProvider(provider)
        const model = createModel({
          provider: provider as any,
          model: data.model || providerDef.defaultModel,
          thinking: { type: 'disabled' },
          apiKey: decryptedApiKey || process.env[providerDef.envApiKeyName],
          baseURL: data.baseURL || undefined,
        } as any)

        const result = await generateText({
          model,
          system: CLASSIFIER_PROMPT,
          prompt: `hasToolCalls：${data.hasToolCalls ? '是' : '否'}\nisContinuation：${data.isContinuation ? '是' : '否'}\n\n助手回复：${data.assistantContent}`,
          maxSteps: 1,
        })

        console.log('classifyHallucination result', result.text)

        const jsonMatch = result.text.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0])
          return { hasFakeResult: Boolean(parsed.hasFakeResult) }
        }
        return { hasFakeResult: false }
      } catch (err) {
        console.error('[classify] Hallucination classification failed:', err)
        return { hasFakeResult: false }
      }
    }
  )
