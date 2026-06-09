import { createServerFn } from '@tanstack/react-start'
import { createModel, generateText, getProvider } from '@/core'
import { decrypt } from '@/server/crypto'

interface GenerateTitleInput {
  userMessage: string
  assistantContent: string
  provider?: string
  model?: string
  apiKey?: string
  baseURL?: string
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
      const provider = data.provider ?? 'deepseek'
      const providerDef = getProvider(provider)
      console.log('providerDef', providerDef)
      console.log('data.model', data.model)
      console.log('providerDef.defaultModel', providerDef.defaultModel)
      console.log('data.baseURL', data.baseURL)
      console.log('process.env[providerDef.envApiKeyName]', process.env[providerDef.envApiKeyName])
      console.log('decryptedApiKey', decryptedApiKey)
      console.log('data.apiKey', data.apiKey)
      console.log('data.userMessage', data.userMessage)
      console.log('data.assistantContent', data.assistantContent)
      console.log('TITLE_PROMPT', TITLE_PROMPT)
      const model = createModel({
        provider: provider as any,
        model: data.model || providerDef.defaultModel,
        thinking: { type: 'disabled' },
        apiKey: decryptedApiKey || process.env[providerDef.envApiKeyName],
        baseURL: data.baseURL || undefined,
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
