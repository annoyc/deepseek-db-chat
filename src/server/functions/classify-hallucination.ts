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
  /** SQL result summary (stats + sample rows) for fact-checking analysis claims */
  resultSummary?: string
}

const CLASSIFIER_PROMPT = `你是一个幻觉检测分类器。判断数据库助手的回复是否包含编造的内容。

你将收到以下上下文信息：
1. 助手的回复文本
2. hasToolCalls：助手在本轮是否调用了工具
3. isContinuation：当前会话中是否存在真实的 SQL 执行记录
4. resultSummary（可选）：最近一次 SQL 执行结果的统计摘要

【最高优先级规则】：
如果 isContinuation = true，说明助手的上下文中包含真实的 SQL 执行结果。此时助手回复中出现的任何具体数据（姓名、手机号、邮箱、数字、ID、状态值等）都应被视为来自真实执行结果或会话历史记录，不算幻觉。只有当助手在 isContinuation=true 时编造了明显超出执行结果范围的内容（例如执行结果只有查询数据，助手却声称删除了100条记录），才判定为幻觉。

【核心判断逻辑】：

hasFakeResult = true（幻觉）的情况：
- isContinuation=false 且 hasToolCalls=false 时，助手声称 SQL 已执行成功或展示了具体的查询数据（姓名、手机号、邮箱等）
- isContinuation=false 时，助手承诺要执行某个动作（如"让我查一下"、"我来删除"），但 hasToolCalls 为 false，即没有实际调用工具
- isContinuation=false 时，助手编造了不存在的查询数据，且这些数据不可能来自任何真实来源

hasFakeResult = false（正常）的情况：
- isContinuation 为 true 时，助手分析、总结、转述之前真正执行过的 SQL 结果 — 这是合法的回复
- 助手调用了工具（hasToolCalls=true），说明它正在通过工具获取数据
- 助手展示 SQL 供用户确认执行（如"以下是生成的 SQL，请确认后执行"）
- 助手做知识解答或规划下一步操作

【分析阶段事实校验】（仅当 isContinuation=true 且 resultSummary 非空时执行）：
当助手正在分析 SQL 执行结果时，检查以下分析准确性问题：

hasFactError = true 的情况：
- 助手引用了 resultSummary 中明确不存在的列名或类别值
- 助手给出的具体数字与 resultSummary 中的统计值明显矛盾（如摘要显示最大值为100，助手却说"最高达到500"）
- 助手声称的百分比或比率在数学上明显不自洽（如各分组占比之和远超100%）
- 助手描述了与结果摘要相反的趋势方向（如数据明显上升但助手说下降）

hasFactError = false 的情况：
- 助手引用的数字在 resultSummary 范围内
- 助手做了合理的近似或四舍五入
- resultSummary 为空或不够详细，无法判断

输出格式（JSON）：
{
  "hasFakeResult": boolean,
  "hasFactError": boolean,
  "factErrorDetail": "简要描述事实错误（仅当 hasFactError=true 时）"
}

只输出 JSON，不要输出其他任何内容。`

export const classifyHallucination = createServerFn({ method: 'POST' })
  .inputValidator((data: ClassifyInput) => data)
  .handler(
    async ({ data }): Promise<{ hasFakeResult: boolean; hasFactError?: boolean; factErrorDetail?: string }> => {
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

        let promptParts = [
          `hasToolCalls：${data.hasToolCalls ? '是' : '否'}`,
          `isContinuation：${data.isContinuation ? '是' : '否'}`,
        ]
        if (data.resultSummary) {
          promptParts.push(`\n最近SQL执行结果摘要：\n${data.resultSummary}`)
        }
        promptParts.push(`\n助手回复：${data.assistantContent}`)

        const result = await generateText({
          model,
          system: CLASSIFIER_PROMPT,
          prompt: promptParts.join('\n'),
          maxSteps: 1,
        })

        console.log('classifyHallucination result', result.text)

        const jsonMatch = result.text.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0])
          return {
            hasFakeResult: Boolean(parsed.hasFakeResult),
            hasFactError: parsed.hasFactError ? Boolean(parsed.hasFactError) : undefined,
            factErrorDetail: parsed.factErrorDetail ? String(parsed.factErrorDetail) : undefined,
          }
        }
        return { hasFakeResult: false }
      } catch (err) {
        console.error('[classify] Hallucination classification failed:', err)
        return { hasFakeResult: false }
      }
    }
  )
