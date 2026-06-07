import { createServerFn } from '@tanstack/react-start'
import { createModel, generateText } from '@/core'
import { decrypt } from '@/server/crypto'

interface GenerateTitleInput {
  userMessage: string
  assistantContent: string
  model?: string
  apiKey?: string
}

const TITLE_PROMPT = `你是一个标题生成器。根据以下对话内容，生成一个简短的中文标题。

要求：
- 标题长度 2-10 个汉字
- 简洁描述对话的核心主题
- 不要加引号、句号等标点符号
- 直接输出标题文本，不要输出其他任何内容
- 如果是数据库相关操作，优先体现操作意图`

export const generateAiTitle = createServerFn({ method: 'POST' })
  .inputValidator((data: GenerateTitleInput) => data)
  .handler(async ({ data }): Promise<string> => {
    try {
      const decryptedApiKey = data.apiKey ? decrypt(data.apiKey) : undefined
      const model = createModel({
        model: data.model || 'deepseek-v4-flash',
        thinking: { type: 'disabled' },
        apiKey: decryptedApiKey || process.env.DEEPSEEK_API_KEY,
      } as any)

      const result = await generateText({
        model,
        system: TITLE_PROMPT,
        prompt: `用户提问：${data.userMessage.slice(0, 200)}\n\n助手回复摘要：${data.assistantContent.slice(0, 500)}`,
        maxSteps: 1,
      })

      const title = result.text.trim().replace(/^["'""「『【《]+|["'""」』】》。！？，、]+$/g, '')

      if (!title || title.length > 20) {
        return data.userMessage.slice(0, 20)
      }

      return title
    } catch (err) {
      console.error('[generateTitle] Failed:', err)
      return data.userMessage.slice(0, 20)
    }
  })
