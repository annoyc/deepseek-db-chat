export interface AnswerCheck {
  hasFakeResult: boolean | null
  status: 'suspected' | 'not_detected' | 'unavailable'
}

/** A failed check is unknown, never evidence that an answer is correct. */
export function parseAnswerCheck(text: string): AnswerCheck {
  try {
    const match = text.match(/\{[\s\S]*\}/)
    const result = match ? JSON.parse(match[0]) : null
    if (typeof result?.hasFakeResult !== 'boolean') return { hasFakeResult: null, status: 'unavailable' }
    return { hasFakeResult: result.hasFakeResult, status: result.hasFakeResult ? 'suspected' : 'not_detected' }
  } catch {
    return { hasFakeResult: null, status: 'unavailable' }
  }
}
