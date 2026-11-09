import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { db } from '@/lib/db'
import { detectKind, DocumentTextError, extractDocumentText } from '@/lib/document-text'
import { createUploadSearchIndex, validateUploadSelection } from '@/lib/knowledge-documents'
import type {
  KnowledgeHistoryTurn,
  KnowledgeUploadedDocument,
  KnowledgeUploadLimits,
  KnowledgeUserChunkCandidate,
} from '@/lib/knowledge-types'

interface KnowledgeDocumentsState {
  /** Newest first. */
  documents: KnowledgeUploadedDocument[]
  loaded: boolean
  /** Name of the file being processed, if any. */
  uploading: string | null
  error: string | null
  upload: (file: File, limits: KnowledgeUploadLimits) => Promise<void>
  remove: (id: string) => Promise<void>
  /** Ids of default (built-in) documents removed in this browser. */
  removedDefaultIds: string[]
  removeDefault: (id: string) => Promise<void>
  restoreDefault: (id: string) => Promise<void>
  clearError: () => void
  /** Chunks of the user's documents relevant to a question, ranked in the browser. */
  selectCandidates: (question: string, history: KnowledgeHistoryTurn[]) => KnowledgeUserChunkCandidate[]
}

const KnowledgeDocumentsContext = createContext<KnowledgeDocumentsState | null>(null)

/** Settings-table key of the default documents the user removed. */
export const REMOVED_DEFAULTS_KEY = 'knowledge-removed-default-documents'

const byNewest = (a: KnowledgeUploadedDocument, b: KnowledgeUploadedDocument) => b.uploadedAt.localeCompare(a.uploadedAt)

function isQuotaError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'QuotaExceededError' || (error as { inner?: Error }).inner?.name === 'QuotaExceededError')
}

export function KnowledgeDocumentsProvider({ children }: { children: React.ReactNode }) {
  const [documents, setDocuments] = useState<KnowledgeUploadedDocument[]>([])
  const [loaded, setLoaded] = useState(false)
  const [uploading, setUploading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [removedDefaultIds, setRemovedDefaultIds] = useState<string[]>([])
  const uploadController = useRef<AbortController | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    db.knowledgeDocuments.toArray()
      .then((stored) => setDocuments(stored.sort(byNewest)))
      .catch(() => setError('无法读取已上传的文档'))
      .finally(() => setLoaded(true))
    db.settings.get(REMOVED_DEFAULTS_KEY)
      .then((record) => {
        if (Array.isArray(record?.value)) setRemovedDefaultIds(record.value.filter((id): id is string => typeof id === 'string'))
      })
      .catch(() => setError('无法读取默认文档设置'))
    return () => uploadController.current?.abort()
  }, [])

  const upload = useCallback(async (file: File, limits: KnowledgeUploadLimits) => {
    if (uploading) return
    const invalid = validateUploadSelection(file, documents.length, limits)
    if (invalid) { setError(invalid); return }
    const controller = new AbortController()
    uploadController.current = controller
    setUploading(file.name)
    setError(null)
    try {
      // The file is parsed here; only its text is sent, for chunking and optional embedding.
      const bytes = new Uint8Array(await file.arrayBuffer())
      const kind = detectKind(file.name, bytes)
      const text = await extractDocumentText(kind, bytes)
      if (controller.signal.aborted) return
      const response = await fetch(`${import.meta.env.BASE_URL}knowledge-upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, kind, size: file.size, text }),
        signal: controller.signal,
      })
      const body = await response.json().catch(() => null) as (KnowledgeUploadedDocument & { error?: string }) | null
      if (!response.ok || !body || body.error) {
        setError(body?.error ?? (response.status === 413 ? '文档文字内容过多' : `上传失败（HTTP ${response.status}）`))
        return
      }
      // Another tab may have added documents meanwhile; the limit applies to what is stored.
      if (await db.knowledgeDocuments.count() >= limits.maxDocuments) {
        setError(`最多保存 ${limits.maxDocuments} 份文档，请先移除不需要的文档`)
        return
      }
      await db.knowledgeDocuments.put(body)
      setDocuments(prev => [body, ...prev.filter(doc => doc.id !== body.id)].sort(byNewest))
      if (body.warning) setError(body.warning)
    } catch (err) {
      if (controller.signal.aborted) return
      setError(err instanceof DocumentTextError
        ? err.message
        : isQuotaError(err) ? '浏览器存储空间不足，请移除部分文档后重试' : '上传失败，请检查网络后重试')
    } finally {
      if (uploadController.current === controller) uploadController.current = null
      setUploading(null)
    }
  }, [documents.length, uploading])

  const remove = useCallback(async (id: string) => {
    try {
      await db.knowledgeDocuments.delete(id)
      setDocuments(prev => prev.filter(doc => doc.id !== id))
    } catch {
      setError('移除失败，请重试')
    }
  }, [])

  const saveRemovedDefaults = useCallback(async (update: (ids: string[]) => string[]) => {
    const record = await db.settings.get(REMOVED_DEFAULTS_KEY).catch(() => undefined)
    const current = Array.isArray(record?.value) ? record.value as string[] : []
    const next = update(current)
    try {
      await db.settings.put({ key: REMOVED_DEFAULTS_KEY, value: next })
      setRemovedDefaultIds(next)
    } catch {
      setError('保存默认文档设置失败，请重试')
    }
  }, [])

  const removeDefault = useCallback(
    (id: string) => saveRemovedDefaults(ids => (ids.includes(id) ? ids : [...ids, id])),
    [saveRemovedDefaults],
  )
  const restoreDefault = useCallback(
    (id: string) => saveRemovedDefaults(ids => ids.filter(other => other !== id)),
    [saveRemovedDefaults],
  )

  const searchIndex = useMemo(() => createUploadSearchIndex(documents), [documents])

  const selectCandidates = useCallback((question: string, history: KnowledgeHistoryTurn[]) => {
    // Include the previous question so follow-ups like "那它的期限呢" still match the topic.
    const previous = [...history].reverse().find(turn => turn.role === 'user')?.content ?? ''
    return searchIndex.search(`${question}\n${previous.slice(0, 500)}`)
  }, [searchIndex])

  const value: KnowledgeDocumentsState = {
    documents,
    loaded,
    uploading,
    error,
    upload,
    remove,
    removedDefaultIds,
    removeDefault,
    restoreDefault,
    clearError: useCallback(() => setError(null), []),
    selectCandidates,
  }

  return <KnowledgeDocumentsContext.Provider value={value}>{children}</KnowledgeDocumentsContext.Provider>
}

export function useKnowledgeDocuments(): KnowledgeDocumentsState {
  const ctx = useContext(KnowledgeDocumentsContext)
  if (!ctx) throw new Error('useKnowledgeDocuments must be used within KnowledgeDocumentsProvider')
  return ctx
}
