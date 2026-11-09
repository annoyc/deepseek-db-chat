import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { THINKING_STYLES } from '@/core/provider'
import { checkServerKey, describeServerProviders, fetchProviderModels, testProviderConnection, type ConnectionTestResult, type ServerProviderInfo } from '@/server/providers'
import { z } from 'zod'

const providerIdSchema = z.string().max(64)

export const getEnvApiKeyStatus = createServerFn({ method: 'POST' })
  .inputValidator((data: { provider?: string; apiKey?: string }) => z.object({
    provider: providerIdSchema.optional(),
    apiKey: z.string().max(40_000).optional(),
  }).parse(data))
  .handler(
    async ({ data }): Promise<{ hasEnvKey: boolean; isServerKey: boolean }> => checkServerKey(data.provider ?? 'deepseek', data.apiKey)
  )

/** Providers configured on the server (never includes keys or env-overridden endpoints). */
export const listServerProviders = createServerFn({ method: 'GET' })
  .handler(async (): Promise<ServerProviderInfo[]> => describeServerProviders())

/** Fetch model ids from a provider's OpenAI-compatible `/models` endpoint. */
export const listProviderModels = createServerFn({ method: 'POST' })
  .inputValidator((data: { provider: string; apiKey?: string; baseURL?: string; thinkingStyle?: string }) => z.object({
    provider: providerIdSchema,
    apiKey: z.string().max(40_000).optional(),
    baseURL: z.string().max(2_048).optional(),
    thinkingStyle: z.enum(THINKING_STYLES).optional(),
  }).parse(data))
  .handler(async ({ data }): Promise<string[]> => fetchProviderModels(data, getRequest().signal))

/** Probe streaming + tool calls, JSON output and the thinking parameter for one model. */
export const testProviderConnectionFn = createServerFn({ method: 'POST' })
  .inputValidator((data: { provider: string; model: string; apiKey?: string; baseURL?: string; thinkingStyle?: string }) => z.object({
    provider: providerIdSchema,
    model: z.string().trim().min(1).max(200),
    apiKey: z.string().max(40_000).optional(),
    baseURL: z.string().max(2_048).optional(),
    thinkingStyle: z.enum(THINKING_STYLES).optional(),
  }).parse(data))
  .handler(async ({ data }): Promise<ConnectionTestResult> => testProviderConnection(data, getRequest().signal))
