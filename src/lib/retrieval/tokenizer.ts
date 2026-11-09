/**
 * Chinese/English tokenizer for BM25. Uses the runtime's ICU word segmenter
 * (Intl.Segmenter, no native dependency) plus overlapping CJK character bigrams:
 * ICU splits domain terms such as 售电 or 绿电 into single characters, and bigrams
 * keep those terms matchable without a domain dictionary.
 */
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' })
// Runs are also broken at the commonest function characters, so 市场的构成 yields
// 市场 + 构成 rather than the meaningless (and therefore high-IDF) 场的 / 的构.
const CJK_RUN = /[㐀-鿿]+/g
const FUNCTION_CHARS = /[的了和与及或是在]/
const CJK = /[㐀-鿿]/

// Question phrasing carries no topic; removing it keeps BM25 from rewarding chunks
// that merely contain 什么/如何. Only applied to queries, never to indexed text.
const QUERY_FILLER = /请问|需要注意什么|要注意什么|注意什么|请介绍(?:一下)?|介绍一下|解释一下|是干什么的|干什么的|干什么|是什么意思|什么意思|是什么|什么是|有什么|有哪些|哪些|怎么样|怎么|如何|为什么|为何|是否|靠谱吗|靠谱|多少|吗|呢|吧/g

export interface Tokenizer {
  tokenize(text: string): string[]
  /** Same as tokenize, after removing question phrasing such as 是什么 / 怎么. */
  tokenizeQuery(query: string): string[]
}

/**
 * words: ICU word segments; bigrams: overlapping CJK character pairs. The default uses
 * both; the single-signal variants exist for the retrieval ablation in evals/knowledge.
 */
export function createTokenizer(options: { words: boolean; bigrams: boolean } = { words: true, bigrams: true }): Tokenizer {
  const tokenize = (text: string) => {
    const normalized = text.normalize('NFKC').toLowerCase()
    const tokens: string[] = []
    if (options.words) {
      for (const { segment, isWordLike } of segmenter.segment(normalized)) {
        if (!isWordLike) continue
        // With bigrams, two-character CJK words are already covered and single characters are noise.
        if (options.bigrams && CJK.test(segment) && segment.length <= 2) continue
        tokens.push(segment)
      }
    }
    if (options.bigrams) {
      for (const run of (normalized.match(CJK_RUN) ?? []).flatMap(r => r.split(FUNCTION_CHARS))) {
        if (run.length === 1) tokens.push(run)
        for (let i = 0; i + 1 < run.length; i++) tokens.push(run.slice(i, i + 2))
      }
    }
    return tokens
  }
  return {
    tokenize,
    tokenizeQuery: query => tokenize(query.normalize('NFKC').replace(QUERY_FILLER, ' ')),
  }
}

export const defaultTokenizer = createTokenizer()
export const tokenize = defaultTokenizer.tokenize
export const tokenizeQuery = defaultTokenizer.tokenizeQuery
