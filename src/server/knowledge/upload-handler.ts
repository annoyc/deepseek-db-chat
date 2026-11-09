import { z } from 'zod'
import { createServerEmbedder } from './embedding'
import { loadKnowledgeBase } from './knowledge-base'
import { processUpload, readLimitedBody, UploadError, uploadLimits } from './upload'

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

/**
 * POST /workbench/knowledge-upload with JSON { fileName, kind, size, text }: the browser
 * has already extracted the text, so the original file never reaches the server. The body
 * is read with a hard size cap instead of through a server function, which would buffer an
 * arbitrarily large request first. The chunks are returned to the browser, which stores
 * them; the server keeps nothing.
 */
export async function handleKnowledgeUpload(request: Request): Promise<Response> {
  try {
    if (process.env.KNOWLEDGE_BACKEND?.trim() === 'remote') throw new UploadError('当前知识库服务不支持上传文档', 409)
    if (!request.headers.get('content-type')?.includes('application/json')) throw new UploadError('请求格式无效', 415)
    const limits = uploadLimits()
    // Up to two characters of raw text (whitespace included) per counted character,
    // at most 3 UTF-8 bytes each, plus JSON escaping and the other fields.
    const bytes = await readLimitedBody(request, limits.maxChars * 8 + 64 * 1024)
    const parsed = z.object({
      fileName: z.string().trim().min(1).max(255),
      kind: z.enum(['pdf', 'docx', 'md', 'txt']),
      size: z.number().int().nonnegative(),
      text: z.string(),
    }).safeParse((() => { try { return JSON.parse(new TextDecoder().decode(bytes)) } catch { return null } })())
    if (!parsed.success) throw new UploadError('请求格式无效')

    const kb = await loadKnowledgeBase()
    const embed = kb.embedding ? createServerEmbedder(kb.embedding) : null
    const document = await processUpload(parsed.data, {
      limits,
      embedding: kb.embedding && embed ? { info: kb.embedding, embed } : undefined,
      signal: request.signal,
    })
    return json(document)
  } catch (error) {
    if (error instanceof UploadError) return json({ error: error.message }, error.status)
    console.error('[knowledge-upload] failed:', error instanceof Error ? error.name : 'UnknownError')
    return json({ error: '文档处理失败，请稍后重试' }, 500)
  }
}
