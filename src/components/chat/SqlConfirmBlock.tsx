import { useState, useEffect, useRef, useCallback } from 'react'
import { CheckCircle2, Loader2, XCircle, Play, X, ArrowRight, AlertTriangle, Send, RotateCcw } from 'lucide-react'
import type { SqlConfirmInfo, SqlResultInfo } from '@/lib/types'
import { useChatStore } from '@/hooks/useChat'
import { Button } from '@/components/ui/button'

const CONFIRM_TIMEOUT_SEC = 60
const WARN_THRESHOLD_SEC = 10

interface SqlConfirmBlockProps {
  info: SqlConfirmInfo
  messageId: string
  result?: SqlResultInfo
}

export function SqlConfirmBlock({ info, messageId, result }: SqlConfirmBlockProps) {
  const { confirmSql, cancelSql, reviseSql } = useChatStore()
  const [countdown, setCountdown] = useState(CONFIRM_TIMEOUT_SEC)
  const [paused, setPaused] = useState(false)
  const [feedback, setFeedback] = useState('')
  const feedbackRef = useRef<HTMLTextAreaElement>(null)
  const cancelSqlRef = useRef(cancelSql)
  cancelSqlRef.current = cancelSql
  const pausedRef = useRef(paused)
  pausedRef.current = paused

  const isLoading = info.status === 'loading'
  const isExecuted = info.status === 'executed'
  const isPending = info.status === 'pending'
  const isConfirmed = info.status === 'confirmed'
  const isCancelled = info.status === 'cancelled'
  const isError = info.status === 'error'
  const isRevised = info.status === 'revised'

  const isWarning = isPending && countdown <= WARN_THRESHOLD_SEC

  useEffect(() => {
    if (!isPending) return
    setCountdown(CONFIRM_TIMEOUT_SEC)
    const interval = setInterval(() => {
      if (pausedRef.current) return
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

  const handleMouseEnter = useCallback(() => setPaused(true), [])
  const handleMouseLeave = useCallback(() => {
    if (!feedback) setPaused(false)
  }, [feedback])

  const handleSubmitFeedback = useCallback(() => {
    const text = feedback.trim()
    if (!text) return
    reviseSql(messageId, text)
  }, [reviseSql, messageId, feedback])

  const handleFeedbackKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmitFeedback()
    }
  }, [handleSubmitFeedback])

  if (isLoading) {
    return (
      <div className="border border-gray-200 rounded-xl overflow-hidden bg-white animate-in fade-in slide-in-from-bottom-2 duration-300">
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-gray-100">
          <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin flex-shrink-0" />
          <span className="text-[13px] font-semibold text-gray-800">SQL 查询</span>
          <span className="text-xs text-gray-400 ml-0.5">准备中...</span>
        </div>
        <div className="px-3 py-2.5">
          <div className="h-10 bg-gray-50 border border-gray-200 rounded-lg animate-pulse" />
        </div>
      </div>
    )
  }

  return (
    <div
      className={`border rounded-xl overflow-hidden bg-white animate-in fade-in slide-in-from-bottom-2 duration-300 ${isError ? 'border-red-200' : isWarning ? 'border-amber-300' : 'border-gray-200'}`}
      onMouseEnter={isPending ? handleMouseEnter : undefined}
      onMouseLeave={isPending ? handleMouseLeave : undefined}
    >
      <div className={`flex items-center gap-1.5 px-3 py-2 border-b ${isError ? 'border-red-100' : isWarning ? 'border-amber-100' : 'border-gray-100'}`}>
        {isExecuted ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
        ) : isError ? (
          <XCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
        ) : isRevised ? (
          <RotateCcw className="w-3.5 h-3.5 text-primary flex-shrink-0" />
        ) : isWarning ? (
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 animate-pulse" />
        ) : (
          <Loader2 className={`w-3.5 h-3.5 flex-shrink-0 ${isConfirmed ? 'text-green-600 animate-spin' : 'text-amber-500'}`} />
        )}
        <span className="text-[13px] font-semibold text-gray-800">SQL 查询</span>
        {isPending && (
          <span className={`text-xs ml-0.5 ${isWarning ? 'text-amber-600 font-medium' : 'text-gray-400'}`}>
            {paused ? '已暂停' : isWarning ? `即将超时 (${countdown}s)` : `待确认 (${countdown}s)`}
          </span>
        )}
        {isConfirmed && <span className="text-xs text-green-600 ml-0.5 font-medium">执行中...</span>}
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
        {isRevised && (
          <span className="text-xs bg-primary text-white px-1.5 py-px rounded-full font-medium ml-0.5">
            已修改
          </span>
        )}
      </div>

      {info.intent_summary && (
        <div className="px-3 pt-2">
          <div className="text-xs text-gray-600 bg-primary/5 border border-primary/15 rounded-lg px-3 py-1.5 leading-relaxed">
            <span className="font-medium text-primary">查询意图：</span>{info.intent_summary}
            {info.expected_shape && <span className="text-gray-400 ml-1.5">· 预期结果: {info.expected_shape}</span>}
          </div>
        </div>
      )}

      <div className="px-3 py-2.5">
        <pre className="text-xs font-mono text-gray-800 bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap leading-relaxed">
          {info.sql}
        </pre>
      </div>

      {isError && info.error && (
        <div className="px-3 pb-2.5">
          <div className="text-xs text-red-600 bg-red-50/80 border border-red-100 rounded-lg px-3 py-2">
            {info.error}
          </div>
        </div>
      )}

      {isRevised && info.revisionFeedback && (
        <div className="px-3 pb-2.5">
          <div className="text-xs text-primary bg-primary/5 border border-primary/15 rounded-lg px-3 py-2">
            <span className="font-medium">修改建议：</span>{info.revisionFeedback}
          </div>
        </div>
      )}

      {isPending && (
        <div className="border-t border-gray-100">
          <div className="px-3 pt-2.5 pb-2">
            <div className="relative">
              <textarea
                ref={feedbackRef}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                onKeyDown={handleFeedbackKeyDown}
                onFocus={handleMouseEnter}
                placeholder="对结果不满意？输入修改建议，如：加上时间条件、改为 LEFT JOIN、只查前10条..."
                className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 pr-9 resize-none bg-gray-50/50 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/50 leading-relaxed transition-colors"
                rows={1}
              />
              {feedback.trim() && (
                <button
                  onClick={handleSubmitFeedback}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-primary hover:bg-primary/10 transition-colors"
                  title="提交修改建议 (Enter)"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 px-3 py-2 border-t border-gray-50">
            {feedback.trim() ? (
              <Button onClick={handleSubmitFeedback} size="sm" className="h-7 text-xs px-3">
                <RotateCcw className="size-3 mr-1" />
                按建议重新生成
              </Button>
            ) : (
              <Button onClick={() => confirmSql(messageId)} size="sm" className="h-7 text-xs px-3">
                <Play className="size-3 mr-1" />
                确认执行
              </Button>
            )}
            <Button onClick={() => cancelSql(messageId)} variant="outline" size="sm" className="h-7 text-xs px-3">
              <X className="size-3 mr-1" />
              取消
            </Button>
            {paused && !feedback.trim() && (
              <span className="text-[11px] text-gray-400 ml-auto">鼠标悬停已暂停倒计时</span>
            )}
          </div>
        </div>
      )}

      {isExecuted && result && (
        <div className="flex items-center gap-1.5 px-3 py-2 border-t border-gray-100 text-xs text-gray-500">
          <CheckCircle2 className="w-3 h-3 text-green-500" />
          <span>{result.rowCount} 行结果</span>
          <span className="text-gray-300">·</span>
          <span className="text-primary inline-flex items-center gap-0.5">
            已在右侧面板展示
            <ArrowRight className="w-3 h-3" />
          </span>
        </div>
      )}
    </div>
  )
}
