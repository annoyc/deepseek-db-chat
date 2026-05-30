import { useState, useEffect, useRef } from 'react'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import type { SqlConfirmInfo, SqlResultInfo } from '@/lib/types'
import { useChatStore } from '@/hooks/useChat'
import { ResultTable } from './ResultTable'

const CONFIRM_TIMEOUT_SEC = 30

interface SqlConfirmBlockProps {
  info: SqlConfirmInfo
  messageId: string
  result?: SqlResultInfo
}

export function SqlConfirmBlock({ info, messageId, result }: SqlConfirmBlockProps) {
  const { confirmSql, cancelSql } = useChatStore()
  const [countdown, setCountdown] = useState(CONFIRM_TIMEOUT_SEC)
  const cancelSqlRef = useRef(cancelSql)
  cancelSqlRef.current = cancelSql

  const isExecuted = info.status === 'executed'
  const isPending = info.status === 'pending'
  const isConfirmed = info.status === 'confirmed'
  const isCancelled = info.status === 'cancelled'
  const isError = info.status === 'error'

  useEffect(() => {
    if (!isPending) return
    setCountdown(CONFIRM_TIMEOUT_SEC)
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          cancelSqlRef.current(messageId)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [isPending, messageId])

  return (
    <div className={`border rounded-xl overflow-hidden bg-white ${isError ? 'border-red-300' : 'border-gray-700'}`}>
      <div className={`flex items-center gap-1.5 px-3 py-2 border-b ${isError ? 'border-red-200' : 'border-gray-300'}`}>
        {isExecuted ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
        ) : isError ? (
          <XCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
        ) : (
          <Loader2 className={`w-3.5 h-3.5 flex-shrink-0 ${isConfirmed ? 'text-blue-500 animate-spin' : 'text-amber-500'}`} />
        )}
        <span className="text-[13px] font-semibold text-gray-800">SQL 查询</span>
        {isPending && <span className="text-xs text-gray-400 ml-0.5">待确认 ({countdown}s)</span>}
        {isConfirmed && <span className="text-xs text-blue-500 ml-0.5">执行中...</span>}
        {isExecuted && (
          <span className="text-xs bg-green-600 text-white px-1.5 py-px rounded-full font-medium ml-0.5">
            成功
          </span>
        )}
        {isError && (
          <span className="text-xs bg-red-500 text-white px-1.5 py-px rounded-full font-medium ml-0.5">
            失败
          </span>
        )}
        {isCancelled && <span className="text-xs text-gray-400 ml-0.5">已取消</span>}
      </div>

      <div className="px-3 py-2.5">
        <pre className="text-xs font-mono text-gray-800 bg-gray-50 border border-gray-400 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap leading-relaxed">
          {info.sql}
        </pre>
      </div>

      {isError && info.error && (
        <div className="px-3 pb-2.5">
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {info.error}
          </div>
        </div>
      )}

      {isPending && (
        <div className="flex items-center gap-2 px-3 py-2.5 border-t border-gray-300">
          <button
            onClick={() => confirmSql(messageId)}
            className="px-3.5 py-1.5 text-[13px] font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-800 transition-colors"
          >
            确认执行
          </button>
          <button
            onClick={() => cancelSql(messageId)}
            className="px-3.5 py-1.5 text-[13px] font-medium rounded-lg bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors"
          >
            取消
          </button>
        </div>
      )}

      {isExecuted && result && (
        <div className="border-t border-gray-300">
          <ResultTable result={result} />
        </div>
      )}
    </div>
  )
}
