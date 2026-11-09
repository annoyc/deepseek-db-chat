import { KEYWORD_RELEVANCE, NO_RELEVANCE_GATE, type RelevanceGate } from '../../src/lib/retrieval/bm25'
import { createTokenizer } from '../../src/lib/retrieval/tokenizer'
import { DEFAULT_CHUNK_OPTIONS } from '../../src/server/knowledge/chunker'
import { buildIndex } from '../../src/server/knowledge/index-builder'
import { createKnowledgeBase, type KnowledgeBase } from '../../src/server/knowledge/knowledge-base'
import type { KbDocument, KbIndexFile } from '../../src/server/knowledge/types'

export interface RetrievalVariant {
  name: string
  description: string
  /** What the variant needs beyond the committed index. */
  requires?: 'model' | 'embedding'
  /** Rewrite and decompose the question with the answer model first, as standard mode does. */
  rewrite?: boolean
  /** Embed the queries and use the index's vectors. */
  vectors?: boolean
  relevance?: RelevanceGate
  build(context: { index: KbIndexFile; corpus: KbDocument[] }): Promise<KnowledgeBase>
}

const committed = async ({ index }: { index: KbIndexFile }) => createKnowledgeBase(index)

/**
 * Keyword variants run offline. Each changes one thing relative to `baseline`, which is
 * what the app does without a model call (concise mode, first question).
 */
export const VARIANTS: RetrievalVariant[] = [
  {
    name: 'baseline',
    description: `线上配置：词 + 二元组分词，条款路径前缀，相关性门槛（覆盖率 ≥ ${KEYWORD_RELEVANCE.minCoverage} 或命中 IDF ≥ ${KEYWORD_RELEVANCE.minMatchedIdf}）`,
    build: committed,
  },
  {
    name: 'no-gate',
    description: '去掉相关性门槛（命中任意一个词即可入选）',
    relevance: NO_RELEVANCE_GATE,
    build: committed,
  },
  {
    name: 'coverage-only',
    description: '只用覆盖率 ≥ 0.2 作门槛（上一版的做法）',
    relevance: { minCoverage: 0.2, minMatchedIdf: Infinity },
    build: committed,
  },
  {
    name: 'no-heading-prefix',
    description: '索引时不加文件名、章节路径前缀',
    build: async ({ index }) => createKnowledgeBase(index, { searchText: (_meta, chunk) => chunk.text }),
  },
  {
    name: 'words-only',
    description: '只用 ICU 分词，不加二元组',
    build: async ({ index }) => createKnowledgeBase(index, { tokenizer: createTokenizer({ words: true, bigrams: false }) }),
  },
  {
    name: 'bigrams-only',
    description: '只用二元组，不用 ICU 分词',
    build: async ({ index }) => createKnowledgeBase(index, { tokenizer: createTokenizer({ words: false, bigrams: true }) }),
  },
  {
    name: 'no-merge',
    description: '切块时不合并短条款',
    build: async ({ corpus }) => createKnowledgeBase(await buildIndex(corpus, { chunkOptions: { ...DEFAULT_CHUNK_OPTIONS, minChars: 0 } })),
  },
  {
    name: 'large-chunks',
    description: '大块切分：短条款合并到 900 字，单块上限 1400 字',
    build: async ({ corpus }) => createKnowledgeBase(await buildIndex(corpus, { chunkOptions: { maxChars: 1400, minChars: 400, mergeMaxChars: 900 } })),
  },
  {
    name: 'rewrite',
    description: '先用模型改写与拆解问题（标准模式的做法），再关键词检索',
    requires: 'model',
    rewrite: true,
    build: committed,
  },
  {
    name: 'hybrid',
    description: '关键词 + 向量，RRF 融合（需要带向量的索引）',
    requires: 'embedding',
    vectors: true,
    build: committed,
  },
  {
    name: 'hybrid-rewrite',
    description: '改写 + 关键词 + 向量（标准模式的完整检索）',
    requires: 'model',
    rewrite: true,
    vectors: true,
    build: committed,
  },
]

export const OFFLINE_VARIANTS = VARIANTS.filter(v => !v.requires).map(v => v.name)
