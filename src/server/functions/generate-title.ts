import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { createModel, generateText, getProvider } from '@/core'
import { resolveAiCredentials } from '@/server/ai-credentials'
import { withTrace } from '@/server/langfuse'

interface GenerateTitleInput {
  userMessage: string
  assistantContent: string
  provider?: string
  model?: string
  apiKey?: string
  baseURL?: string
  sessionId?: string
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
    const signal = getRequest().signal
      return withTrace({
      name: 'generate-title',
      input: { userMessage: data.userMessage.slice(0, 200) },
      sessionId: data.sessionId,
      metadata: { provider: data.provider, model: data.model },
      tags: ['title'],
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

        const result = await generateText({
          model,
          system: TITLE_PROMPT,
          prompt: `用户提问：${data.userMessage.slice(0, 200)}\n\n助手回复摘要：${data.assistantContent.slice(0, 500)}`,
          maxSteps: 1,
            signal,
        })

        const title = result.text.trim().replace(/^["'""「『【《]+|["'""」』】》。！？，、]+$/g, '')

        if (!title || title.length > 20) {
          return data.userMessage.slice(0, 20)
        }

        return title
      } catch (err) {
          signal.throwIfAborted()
        console.error('[generateTitle] Failed:', err)
        return data.userMessage.slice(0, 20)
      }
    })
  })
