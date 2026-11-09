export interface CitationCheck {
  /** Distinct references in the answer, in order of first appearance, e.g. ['1', 'W2']. */
  cited: string[]
  /** References that point at no provided source. */
  invalid: string[]
}

// Accepts [1], [1][2], [1,2], [1、2] and the full-width 【1】 some models emit.
const MARKER = /[[【]\s*(W?\d{1,3}(?:\s*[,，、]\s*W?\d{1,3})*)\s*[\]】]/g

export function checkCitations(answer: string, available: Iterable<string>): CitationCheck {
  const valid = new Set(available)
  const cited: string[] = []
  for (const match of answer.matchAll(MARKER)) {
    for (const ref of match[1].split(/\s*[,，、]\s*/)) {
      if (!cited.includes(ref)) cited.push(ref)
    }
  }
  return { cited, invalid: cited.filter(ref => !valid.has(ref)) }
}
