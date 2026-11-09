import { useRef, useState } from 'react'
import { AlertCircle, FileText, FolderOpen, Loader2, Trash2, Upload, X } from 'lucide-react'
import { useKnowledgeDocuments } from '@/hooks/useKnowledgeDocuments'
import { formatBytes, UPLOAD_ACCEPT } from '@/lib/knowledge-documents'
import type { KnowledgeUploadedDocument, KnowledgeUploadLimits } from '@/lib/knowledge-types'
import { cn } from '@/lib/utils'

const KIND_LABEL: Record<KnowledgeUploadedDocument['kind'], string> = { pdf: 'PDF', docx: 'Word', md: 'Markdown', txt: 'TXT' }

export function KnowledgeDocumentList({
  documents,
  limits,
  uploading,
  error,
  onUpload,
  onRemove,
  onDismissError,
}: {
  documents: KnowledgeUploadedDocument[]
  limits: KnowledgeUploadLimits
  uploading: string | null
  error: string | null
  onUpload: (file: File) => void
  onRemove: (id: string) => void
  onDismissError: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const full = documents.length >= limits.maxDocuments

  return (
    <div className="border-b border-stone-200/70 py-3">
      <div className="mb-1.5 flex items-center justify-between px-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">
          <FolderOpen className="h-4 w-4 text-stone-500" />
          我的文档
          <span className="font-normal tracking-normal text-stone-400">{`${documents.length}/${limits.maxDocuments}`}</span>
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
      <p className="px-2 text-[11px] leading-4 text-stone-400">
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

      {documents.length > 0 && (
        <ul className="subtle-scrollbar mt-2 max-h-48 space-y-1 overflow-y-auto">
          {documents.map((doc) => (
            <li key={doc.id} className="group rounded-lg px-2 py-1.5 hover:bg-white/70">
              <div className="flex items-center gap-2">
                <FileText className="h-3.5 w-3.5 flex-shrink-0 text-stone-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-stone-700" title={doc.name}>{doc.title}</div>
                  <div className="text-[11px] text-stone-400">
                    {`${KIND_LABEL[doc.kind]} · ${formatBytes(doc.size)} · ${doc.chunks.length} 段${doc.embeddingKey ? '' : ' · 关键词检索'}`}
                  </div>
                </div>
                {confirmId === doc.id ? (
                  <span className="flex flex-shrink-0 items-center gap-1 text-[11px]">
                    <button type="button" onClick={() => { onRemove(doc.id); setConfirmId(null) }} className="rounded px-1.5 py-0.5 font-medium text-red-600 hover:bg-red-50">
                      移除
                    </button>
                    <button type="button" onClick={() => setConfirmId(null)} className="rounded px-1.5 py-0.5 text-stone-500 hover:bg-stone-100">
                      取消
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmId(doc.id)}
                    className={cn('flex-shrink-0 rounded p-1 text-stone-300 transition-colors hover:bg-red-50 hover:text-red-500')}
                    title="移除文档"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The user's uploaded documents, connected to browser storage. */
export function KnowledgeDocuments({ limits }: { limits: KnowledgeUploadLimits }) {
  const { documents, uploading, error, upload, remove, clearError } = useKnowledgeDocuments()
  return (
    <KnowledgeDocumentList
      documents={documents}
      limits={limits}
      uploading={uploading}
      error={error}
      onUpload={(file) => void upload(file, limits)}
      onRemove={(id) => void remove(id)}
      onDismissError={clearError}
    />
  )
}
