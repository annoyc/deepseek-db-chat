import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { submitLangfuseFeedback } from '@/server/langfuse'

const FeedbackInputSchema = z.object({
  traceId: z.string().regex(/^[a-fA-F0-9-]{8,128}$/),
  rating: z.enum(['up', 'down']).nullable(),
  source: z.enum(['chat', 'knowledge']).optional(),
})

export const submitFeedbackFn = createServerFn({ method: 'POST' })
  .inputValidator((data: z.infer<typeof FeedbackInputSchema>) => FeedbackInputSchema.parse(data))
  .handler(async ({ data }): Promise<{ synced: boolean }> => submitLangfuseFeedback(data))
