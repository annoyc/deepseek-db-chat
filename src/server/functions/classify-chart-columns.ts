import { createServerFn } from '@tanstack/react-start'
import { createModel, generateText, getProvider } from '@/core'
import { decrypt } from '@/server/crypto'
import { withTrace } from '@/server/langfuse'

interface ClassifyInput {
  columns: string[]
  sampleRows: Record<string, unknown>[]
  provider?: string
  model?: string
  apiKey?: string
  baseURL?: string
  sessionId?: string
}

export interface ChartColumnClassification {
  labelCol: string
  valueCols: string[]
}

const CLASSIFIER_PROMPT = `你是一个数据可视化列分类器。根据列名和样本数据，判断哪些列是维度（适合做 X 轴/分类标签），哪些是度量（适合做 Y 轴/数值指标）。

分类规则：
- 维度列（dimension）：日期、时间、名称、类别、地区、状态、类型等用于分组/分类的列
- 度量列（metric）：数量、金额、次数、比率、价格等可聚合的数值指标
- ID/编码列（如 user_id, org_code, created_by）既不是好维度也不是好度量，归入维度

选择最适合做 X 轴的维度列作为 labelCol，选择所有真正的数值指标作为 valueCols。

输出 JSON（不要输出其他内容）：
{"labelCol":"列名","valueCols":["列名1","列名2"]}`

export const classifyChartColumns = createServerFn({ method: 'POST' })
  .inputValidator((data: ClassifyInput) => data)
  .handler(
    async ({ data }): Promise<ChartColumnClassification | null> => {
      return withTrace({
        name: 'classify-chart-columns',
        sessionId: data.sessionId,
        metadata: { provider: data.provider, model: data.model, columnCount: data.columns.length },
        tags: ['chart-classify'],
      }, async () => {
        try {
          const decryptedApiKey = data.apiKey ? decrypt(data.apiKey) : undefined
          const providerId = data.provider ?? 'deepseek'
          const providerDef = getProvider(providerId)
          const model = createModel({
            provider: providerId as any,
            model: data.model || providerDef.defaultModel,
            thinking: { type: 'disabled' },
            apiKey: decryptedApiKey || process.env[providerDef.envApiKeyName],
            baseURL: data.baseURL || undefined,
          } as any)

          const sample = data.sampleRows.slice(0, 3)
          const prompt = [
            `列名：${data.columns.join(', ')}`,
            `样本数据（前 ${sample.length} 行）：`,
            ...sample.map((row, i) => `  第${i + 1}行: ${JSON.stringify(row)}`),
          ].join('\n')

          const result = await generateText({
            model,
            system: CLASSIFIER_PROMPT,
            prompt,
            maxSteps: 1,
          })

          const jsonMatch = result.text.match(/\{[\s\S]*\}/)
          if (!jsonMatch) return null

          const parsed = JSON.parse(jsonMatch[0])
          if (!parsed.labelCol || !Array.isArray(parsed.valueCols) || parsed.valueCols.length === 0) return null

          const validLabel = data.columns.includes(parsed.labelCol) ? parsed.labelCol : null
          const validValues = parsed.valueCols.filter((c: string) => data.columns.includes(c))
          if (!validLabel || validValues.length === 0) return null

          return { labelCol: validLabel, valueCols: validValues }
        } catch (err) {
          console.warn('[classify-chart-columns] Classification failed:', err)
          return null
        }
      })
    }
  )
