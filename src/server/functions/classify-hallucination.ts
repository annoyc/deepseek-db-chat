import { createServerFn } from '@tanstack/react-start'
import { createModel, generateText } from '@/core'
import { decrypt } from '@/server/crypto'

interface ClassifyInput {
  assistantContent: string
  hasToolCalls: boolean
  isContinuation: boolean
  model?: string
  apiKey?: string
}

const CLASSIFIER_PROMPT = `你是一个幻觉检测分类器。判断数据库助手的回复是否包含编造的内容。

你将收到三个上下文信息：
1. 助手的回复文本
2. hasToolCalls：助手在本轮是否调用了工具
3. isContinuation：本轮是否是 SQL 执行后的结果反馈（即助手刚刚收到了真实的 SQL 执行结果）

【核心判断逻辑】：

hasFakeResult = true（幻觉）的情况：
- 助手在没有调用任何工具（hasToolCalls=false）且没有收到执行结果（isContinuation=false）的情况下，声称 SQL 已执行成功或展示了具体查询数据
- 助手承诺要执行某个动作（如"让我查一下"、"我来删除"），但 hasToolCalls 为 false，即没有实际调用工具
- 助手编造了不存在的查询数据（具体的姓名、手机号、邮箱等），且这些数据不可能来自任何真实来源

hasFakeResult = false（正常）的情况：
- isContinuation 为 true 时，助手分析或总结之前真正执行过的 SQL 结果（如"插入成功，ID 为 42"），这是合法的回复，不是幻觉
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
        const model = createModel({
          model: data.model || 'deepseek-v4-flash',
          thinking: { type: 'disabled' },
          apiKey: decryptedApiKey || process.env.DEEPSEEK_API_KEY,
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
