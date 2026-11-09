/**
 * Builds knowledge/kb-index.json from knowledge/corpus/*.md.
 *
 *   pnpm kb:ingest            keyword index only (no API key needed)
 *   pnpm kb:ingest --embed    also embeds every chunk with KB_EMBEDDING_* (server key)
 *   pnpm kb:ingest --check    fail if the committed index is out of date
 */
import { existsSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseCorpusFile } from './corpus'
import { createServerEmbedder, ingestEmbeddingInfo } from './embedding'
import { buildIndex, type BuildIndexOptions } from './index-builder'
import type { KbIndexFile } from './types'

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

async function main() {
  const args = process.argv.slice(2)
  const root = process.cwd()
  if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'))
  const corpusDir = resolve(root, option(args, '--corpus') ?? 'knowledge/corpus')
  const outFile = resolve(root, option(args, '--out') ?? 'knowledge/kb-index.json')

  const files = (await readdir(corpusDir)).filter(name => name.endsWith('.md')).sort()
  if (!files.length) throw new Error(`No Markdown files in ${corpusDir}`)
  const documents = await Promise.all(files.map(async name => parseCorpusFile(await readFile(resolve(corpusDir, name), 'utf8'), name)))
  const previous = existsSync(outFile) ? JSON.parse(await readFile(outFile, 'utf8')) as KbIndexFile : undefined

  let embedding: BuildIndexOptions['embedding']
  if (args.includes('--embed')) {
    const info = ingestEmbeddingInfo()
    const embed = createServerEmbedder(info)
    if (!embed) throw new Error(`--embed needs the server API key for provider "${info.provider}"`)
    embedding = { info, embed }
    console.log(`向量模型：${info.provider} / ${info.model}（${info.dimensions} 维）`)
  } else if (previous?.embedding) {
    console.log('提示：未传 --embed，生成的索引将不含向量（仅关键词检索）')
  }

  const index = await buildIndex(documents, { embedding, previous, onProgress: message => console.log(message) })
  if (args.includes('--check')) {
    const stale = !previous || previous.corpusHash !== index.corpusHash
    console.log(stale ? `索引已过期：请运行 pnpm kb:ingest${previous?.embedding ? ' --embed' : ''}` : '索引与语料一致')
    process.exitCode = stale ? 1 : 0
    return
  }
  await writeFile(outFile, JSON.stringify(index, null, 1) + '\n')
  console.log(`已写入 ${outFile}：${index.documents.length} 份文件，${index.chunks.length} 个片段${index.embedding ? '，含向量' : ''}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
