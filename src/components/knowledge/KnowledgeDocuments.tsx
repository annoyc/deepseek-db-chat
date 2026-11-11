import { useRef, useState } from 'react'
import { AlertCircle, ExternalLink, FileText, FolderOpen, Loader2, RotateCcw, ScrollText, Trash2, Upload, X } from 'lucide-react'
import { useKnowledgeDocuments } from '@/hooks/useKnowledgeDocuments'
import { formatBytes, UPLOAD_ACCEPT } from '@/lib/knowledge-documents'
import type { KnowledgeDefaultDocument, KnowledgeUploadedDocument, KnowledgeUploadLimits } from '@/lib/knowledge-types'
import { cn } from '@/lib/utils'

const KIND_LABEL: Record<KnowledgeUploadedDocument['kind'], string> = { pdf: 'PDF', docx: 'Word', md: 'Markdown', txt: 'TXT' }

/** Trash button that asks for a second click before calling onConfirm. */
function RemoveButton({ confirming, onAsk, onConfirm, onCancel, title }: {
  confirming: boolean
  onAsk: () => void
  onConfirm: () => void
  onCancel: () => void
  title: string
}) {
  if (confirming) {
    return (
      <span className="flex flex-shrink-0 items-center gap-1 text-xs">
        <button type="button" onClick={onConfirm} className="rounded px-1.5 py-0.5 font-medium text-red-600 hover:bg-red-50">
          移除
        </button>
        <button type="button" onClick={onCancel} className="rounded px-1.5 py-0.5 text-stone-500 hover:bg-stone-100">
          取消
        </button>
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={onAsk}
      className="flex-shrink-0 rounded p-1 text-stone-300 transition-colors hover:bg-red-50 hover:text-red-500"
      title={title}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  )
}

export function KnowledgeDocumentList({
  documents,
  limits,
  uploading,
  error,
  onUpload,
  onRemove,
  onDismissError,
  defaultDocuments = [],
  removedDefaultIds = [],
  onRemoveDefault = () => {},
  onRestoreDefault = () => {},
}: {
  documents: KnowledgeUploadedDocument[]
  limits: KnowledgeUploadLimits
  uploading: string | null
  error: string | null
  onUpload: (file: File) => void
  onRemove: (id: string) => void
  onDismissError: () => void
  /** The built-in documents; the user may remove them from their own knowledge base. */
  defaultDocuments?: KnowledgeDefaultDocument[]
  removedDefaultIds?: string[]
  onRemoveDefault?: (id: string) => void
  onRestoreDefault?: (id: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const full = documents.length >= limits.maxDocuments
  const removed = new Set(removedDefaultIds)
  const activeDefaults = defaultDocuments.filter(doc => !removed.has(doc.id)).length

  return (
    <div className="border-b border-stone-200/70 py-3">
      <div className="mb-1.5 flex items-center justify-between px-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">
          <FolderOpen className="h-4 w-4 text-stone-500" />
          知识库文档
        </span>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={Boolean(uploading) || full}
          title={full ? `最多保存 ${limits.maxDocuments} 份文档，请先移除不需要的文档` : '上传文档'}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:text-stone-400 disabled:hover:bg-transparent"
        >
          <Upload className="h-3.5 w-3.5" />
          上传
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={UPLOAD_ACCEPT}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) onUpload(file)
          }}
        />
      </div>
      <p className="px-2 text-xs leading-4 text-stone-400">
        {`PDF、Word、Markdown、TXT，单个不超过 ${formatBytes(limits.maxBytes)}。文件在本浏览器解析和保存，提问时只发送相关片段`}
      </p>

      {uploading && (
        <div className="mt-2 flex items-center gap-2 rounded-lg bg-primary/5 px-2 py-1.5 text-xs text-primary">
          <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin" />
          <span className="truncate">{`正在解析 ${uploading}`}</span>
        </div>
      )}
      {error && (
        <div role="alert" className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50/80 px-2 py-1.5 text-xs text-amber-800">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={onDismissError} className="text-amber-700/70 hover:text-amber-900" title="关闭">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {defaultDocuments.length > 0 && (
        <>
          <div className="mt-3 flex items-center justify-between px-2 text-xs text-stone-500">
            <span className="font-medium">默认文档 · 电力市场规则</span>
            <span className="text-stone-400">{`${activeDefaults}/${defaultDocuments.length} 启用`}</span>
          </div>
          <ul className="subtle-scrollbar mt-1 max-h-56 space-y-1 overflow-y-auto">
            {defaultDocuments.map((doc) => {
              const isRemoved = removed.has(doc.id)
              return (
                <li key={doc.id} className="rounded-lg px-2 py-1.5 hover:bg-white/70">
                  <div className="flex items-center gap-2">
                    <ScrollText className={cn('h-3.5 w-3.5 flex-shrink-0', isRemoved ? 'text-stone-300' : 'text-primary/70')} />
                    <div className="min-w-0 flex-1">
                      <div
                        className={cn('truncate text-xs font-medium', isRemoved ? 'text-stone-400 line-through' : 'text-stone-700')}
                        title={doc.docNo ? `${doc.title}（${doc.docNo}）` : doc.title}
                      >
                        {doc.title}
                      </div>
                      <div className="flex min-w-0 items-center gap-1 text-xs text-stone-400">
                        {isRemoved ? (
                          <span>已移除，不参与检索</span>
                        ) : (
                          <span
                            className={cn('truncate', doc.status !== 'active' && 'text-amber-700')}
                            title={`${doc.statusLabel} · ${doc.chunks} 段`}
                          >
                            {`${doc.statusLabel} · ${doc.chunks} 段`}
                          </span>
                        )}
                        {doc.sourceUrl && (
                          <a
                            href={doc.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="flex flex-shrink-0 items-center hover:text-primary"
                            title="查看原文（可下载后重新上传）"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>
                    {isRemoved ? (
                      <button
                        type="button"
                        onClick={() => onRestoreDefault(doc.id)}
                        className="flex flex-shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-xs text-primary hover:bg-primary/10"
                        title="恢复为默认文档"
                        aria-label="恢复为默认文档"
                      >
                        <RotateCcw className="h-3 w-3" />
                        恢复
                      </button>
                    ) : (
                      <RemoveButton
                        confirming={confirmId === doc.id}
                        onAsk={() => setConfirmId(doc.id)}
                        onConfirm={() => { onRemoveDefault(doc.id); setConfirmId(null) }}
                        onCancel={() => setConfirmId(null)}
                        title="从我的知识库移除（可随时恢复）"
                      />
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}

      <div className="mt-3 flex items-center justify-between px-2 text-xs text-stone-500">
        <span className="font-medium">我上传的</span>
        <span className="text-stone-400">{`${documents.length}/${limits.maxDocuments}`}</span>
      </div>
      {documents.length === 0 && <p className="px-2 pt-1 text-xs text-stone-400">暂无上传的文档</p>}
      {documents.length > 0 && (
        <ul className="subtle-scrollbar mt-1 max-h-48 space-y-1 overflow-y-auto">
          {documents.map((doc) => (
            <li key={doc.id} className="group rounded-lg px-2 py-1.5 hover:bg-white/70">
              <div className="flex items-center gap-2">
                <FileText className="h-3.5 w-3.5 flex-shrink-0 text-stone-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-stone-700" title={doc.name}>{doc.title}</div>
                  <div className="text-xs text-stone-400">
                    {`${KIND_LABEL[doc.kind]} · ${formatBytes(doc.size)} · ${doc.chunks.length} 段${doc.embeddingKey ? '' : ' · 关键词检索'}`}
                  </div>
                </div>
                <RemoveButton
                  confirming={confirmId === doc.id}
                  onAsk={() => setConfirmId(doc.id)}
                  onConfirm={() => { onRemove(doc.id); setConfirmId(null) }}
                  onCancel={() => setConfirmId(null)}
                  title="移除文档"
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Default and uploaded documents, connected to browser storage. */
export function KnowledgeDocuments({ limits, defaultDocuments = [] }: { limits: KnowledgeUploadLimits; defaultDocuments?: KnowledgeDefaultDocument[] }) {
  const { documents, uploading, error, upload, remove, removedDefaultIds, removeDefault, restoreDefault, clearError } = useKnowledgeDocuments()
  return (
    <KnowledgeDocumentList
      documents={documents}
      limits={limits}
      uploading={uploading}
      error={error}
      onUpload={(file) => void upload(file, limits)}
      onRemove={(id) => void remove(id)}
      onDismissError={clearError}
      defaultDocuments={defaultDocuments}
      removedDefaultIds={removedDefaultIds}
      onRemoveDefault={(id) => void removeDefault(id)}
      onRestoreDefault={(id) => void restoreDefault(id)}
    />
  )
}
