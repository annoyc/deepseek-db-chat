import { createServerFn } from '@tanstack/react-start'
import { createModel, generateText, getProvider } from '@/core'
import { decrypt } from '@/server/crypto'
import { withTrace } from '@/server/langfuse'
import { listTables, getPool } from '@/server/database'
import type { DatabaseConnection } from '@/lib/types'

interface GenerateSuggestionsInput {
  connection: DatabaseConnection
  provider?: string
  model?: string
  apiKey?: string
  baseURL?: string
  sessionId?: string
  /** 客户端刷新时传入，用于绕过请求/前缀缓存 */
  refreshNonce?: string
  /** 已展示过的建议，要求 LLM 生成不同内容 */
  excludeSuggestions?: string[]
}

const SUGGESTION_PROMPT = `你是一个数据库分析专家。根据以下数据库信息，为用户生成4个快捷提问建议。

这4个建议必须分别覆盖以下4个不同层面：
1. **结构探索**：关于数据库有哪些表、表之间的关系、或某个表的字段结构等探索性问题
2. **数据查询**：查询特定数据或统计信息的问题（如某类记录的数量、某个字段的分布等）
3. **趋势分析**：关于某个时间序列指标的趋势、变化、对比等问题（如最近一周/一月的变化趋势）
4. **业务洞察**：结合数据库业务场景，提出有深度分析价值的问题（如转化率、活跃度、留存等）

生成规则：
- 每个问题必须基于实际存在的表名和字段，使用真实可查的表名
- 问题要自然口语化，像用户自己会问的问题
- 问题要简洁，不超过25个汉字
- 不要使用引号或其他特殊符号包裹表名
- 每次生成时请提供与之前完全不同的新问题角度，选择不同的表、不同的统计维度
- 直接输出4个问题，每行一个，不要编号、不要加前缀、不要有其他任何解释文字`

export const generateSuggestions = createServerFn({ method: 'POST' })
  .inputValidator((data: GenerateSuggestionsInput) => data)
  .handler(async ({ data }): Promise<string[]> => {
    return withTrace({
      name: 'generate-suggestions',
      sessionId: data.sessionId,
      metadata: { provider: data.provider, model: data.model, database: data.connection.database },
      tags: ['suggestions'],
    }, async () => {
      try {
        const decryptedConnection: DatabaseConnection = {
          ...data.connection,
          password: decrypt(data.connection.password),
        }

        const tables = await listTables(decryptedConnection)
        if (tables.length === 0) {
          return [
            '这个数据库有哪些表？',
            '帮我看看数据库的整体结构',
            '查询数据库的表数量',
            '数据库概览信息',
          ]
        }

        const pool = getPool(decryptedConnection)
        const [tableInfoRows] = await pool.query(
          `SELECT TABLE_NAME, TABLE_COMMENT
           FROM INFORMATION_SCHEMA.TABLES
           WHERE TABLE_SCHEMA = ?
           ORDER BY TABLE_NAME`,
          [decryptedConnection.database]
        )

        const tableInfos = (tableInfoRows as Array<{ TABLE_NAME: string; TABLE_COMMENT: string }>)
          .map(row => {
            const name = row.TABLE_NAME
            const comment = row.TABLE_COMMENT ? ` (${row.TABLE_COMMENT})` : ''
            return `${name}${comment}`
          })

        const tableSummary = tableInfos.slice(0, 40).join('\n')
        const truncated = tableInfos.length > 40 ? `\n...共 ${tableInfos.length} 张表` : ''

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

        const nonce = data.refreshNonce ?? Math.random().toString(36).slice(2, 10)
        const excludeBlock = data.excludeSuggestions?.length
          ? `\n\n以下问题已经展示过，必须生成完全不同的 4 个新问题（不同表、不同维度、不同问法）：\n${data.excludeSuggestions.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
          : ''
        const result = await generateText({
          model,
          system: SUGGESTION_PROMPT,
          prompt: `数据库名称：${decryptedConnection.database}\n数据库中的表：\n${tableSummary}${truncated}${excludeBlock}\n\n(refresh: ${nonce})`,
          maxSteps: 1,
          temperature: 1.2,
        })

        const suggestions = result.text
          .split('\n')
          .map(line => line.replace(/^\d+[\.\)、]\s*/, '').trim())
          .filter(line => line.length > 0 && line.length <= 40)

        const fallback = [
          `这个数据库有哪些表？`,
          `帮我查看${tables[0]}表的结构`,
          `查询最近一周的数据变化趋势`,
          `统计${tables[0]}表的记录数量`,
        ]

        if (suggestions.length < 4) {
          for (const fb of fallback) {
            if (suggestions.length >= 4) break
            if (!suggestions.includes(fb)) suggestions.push(fb)
          }
        }

        return suggestions.slice(0, 4)
      } catch (err) {
        console.error('[generateSuggestions] Failed:', err)
        return [
          '这个数据库有哪些表？',
          '帮我查看第一张表的结构',
          '查询最近的数据概况',
          '统计各张表的记录数量',
        ]
      }
    })
  })
