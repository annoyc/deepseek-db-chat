import type { KnowledgeCitation } from '../../src/lib/knowledge-types'
import { formatCitationBlock } from '../../src/server/knowledge/prompt'
import type { KnowledgeChatModel } from '../../src/server/knowledge/query-analysis'

/** LLM-as-a-Judge verdict on whether an answer stays faithful to the retrieved provisions. */
export interface FaithfulnessVerdict {
  /** True when every factual claim in the answer is supported by the retrieved provisions. */
  faithful: boolean
  /** 1 = fully grounded, 0.5 = minor extrapolation/imprecision, 0 = unsupported or contradicted. */
  score: number
  reason: string
  unsupportedClaims: string[]
}

const JUDGE_SYSTEM = `你是严谨的 RAG 忠实度评审员。你的任务是核查「模型回答」中的每一条事实陈述是否都能在「检索到的规则原文」中找到依据。

评判标准：
- score = 1, faithful = true：回答的所有关键事实、数字、条件、期限和结论都能由给定原文直接支持，没有编造条款外的内容。
- score = 0.5, faithful = false：主体结论有依据，但包含轻微的自行补充、过度推论或个别未在原文出现的细节。
- score = 0, faithful = false：出现明显无中生有、与原文矛盾、或引用张冠李戴。

注意：
- 仅核查「忠实度（是否忠于给定原文）」，不评价回答是否完整或文风。
- 只输出严格 JSON，不要包含 Markdown 代码块或多余文字：
{"faithful": true, "score": 1, "reason": "一句话说明依据", "unsupportedClaims": []}`

function extractJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  const candidate = start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed
  const parsed: unknown = JSON.parse(candidate)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Faithfulness judge did not return a JSON object')
  }
  return parsed as Record<string, unknown>
}

export function parseFaithfulnessVerdict(raw: string): FaithfulnessVerdict {
  const parsed = extractJsonObject(raw)
  const rawScore = Number(parsed.score)
  const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(1, rawScore)) : (parsed.faithful ? 1 : 0)
  const faithful = typeof parsed.faithful === 'boolean' ? parsed.faithful : score >= 0.8
  const reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : ''
  const unsupportedClaims = Array.isArray(parsed.unsupportedClaims)
    ? parsed.unsupportedClaims.map(v => String(v).trim()).filter(Boolean)
    : []
  return { faithful, score, reason, unsupportedClaims }
}

export async function judgeFaithfulness(
  model: KnowledgeChatModel,
  question: string,
  answer: string,
  citations: KnowledgeCitation[],
  today?: string,
  signal?: AbortSignal,
): Promise<FaithfulnessVerdict> {
  // Reuse the exact citation header format (docNo, headings, statusLabel) that the answer prompt receives,
  // so valid metadata/validity statements are not misclassified as unsupported claims.
  const context = citations.map(formatCitationBlock).join('\n\n')
  const userPrompt = [
    ...(today ? [`【当前日期】\n${today}（北京时间）`] : []),
    `【用户问题】\n${question}`,
    `【检索到的规则原文与元信息】\n${context || '（无检索结果）'}`,
    `【模型回答】\n${answer}`,
  ].join('\n\n')

  const response = await model.invoke({
    messages: [
      { role: 'system', content: JUDGE_SYSTEM },
      { role: 'user', content: userPrompt },
    ],
    signal,
  })
  const content = response.choices?.[0]?.message?.content ?? ''
  return parseFaithfulnessVerdict(content)
}
