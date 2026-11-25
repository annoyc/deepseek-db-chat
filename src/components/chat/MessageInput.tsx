import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { ArrowUp, Square, Atom, ChevronDown, Shield, AlertTriangle } from 'lucide-react'
import { useChatStore } from '@/hooks/useChat'
import { useDatabaseStore } from '@/hooks/useDatabase'
import { useSettings } from '@/hooks/useSettings'
import { isDemoConnectionId } from '@/lib/demo-connection'
import { modelLabel } from '@/lib/providers'
import { isSubmitKey } from '@/lib/keyboard'
import { computeChatContextUsage } from '@/lib/context-window'
import { Modal, ModalTitle } from '@/components/ui/modal'
import { ContextUsageIndicator } from './ContextUsageIndicator'

export function MessageInput() {
  const [input, setInput] = useState('')
  const [showModelMenu, setShowModelMenu] = useState(false)
  const [showSqlWarning, setShowSqlWarning] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { sendMessage, isStreaming, activeSessionId, activeSession, createNewSession, stopStreaming, persistenceState, inputDraft } = useChatStore()
  const { activeConnectionId, getFullConnection } = useDatabaseStore()
  const { provider, providers, activeProvider, serverProviders, setProvider, model, setModel, thinkingStyle, thinkingMode, setThinkingMode, reasoningEffort, setReasoningEffort, sqlPermission, setSqlPermission, activeContextWindowOverride, setModelContextWindow } = useSettings()
  const hasServerKey = serverProviders.some((p) => p.id === activeProvider?.id && p.hasEnvKey)
  const zeroConfigReady = isDemoConnectionId(activeConnectionId) && hasServerKey
  const prevSessionIdRef = useRef(activeSessionId)

  useEffect(() => {
    if (activeSessionId && activeSessionId !== prevSessionIdRef.current) {
      prevSessionIdRef.current = activeSessionId
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }, [activeSessionId])

  // A picked suggestion lands in the composer so it can be edited before sending.
  const appliedDraftRef = useRef(inputDraft?.nonce ?? 0)
  useEffect(() => {
    if (!inputDraft || inputDraft.nonce === appliedDraftRef.current) return
    appliedDraftRef.current = inputDraft.nonce
    setInput(inputDraft.text)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 200) + 'px'
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    })
  }, [inputDraft])

  const providerModels = activeProvider?.models ?? []
  const currentModel = providerModels.find((m) => m.id === model)
  const currentModelDisplay = currentModel ? modelLabel(currentModel) : (model || '未选择模型')
  const currentLabel = `${activeProvider?.name ?? provider} / ${currentModelDisplay}`
  const contextUsage = useMemo(
    () => computeChatContextUsage({
      messages: activeSession?.messages ?? [],
      executionLog: activeSession?.executionLog,
      draftText: input,
      modelId: model,
      contextWindowOverride: activeContextWindowOverride,
      thinkingStyle,
      thinkingMode,
      isStreaming,
    }),
    [activeSession?.messages, activeSession?.executionLog, input, model, activeContextWindowOverride, thinkingStyle, thinkingMode, isStreaming],
  )
  const historyUnavailable = persistenceState === 'loading' || persistenceState === 'load-error'
  const historyHint = persistenceState === 'load-error' ? '历史记录读取失败，请先点击“重试读取”' : '正在读取历史记录，请稍候'
  const canSend = input.trim() && !isStreaming && activeConnectionId && !historyUnavailable

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim()
    if (!trimmed || isStreaming || !activeConnectionId || historyUnavailable) return
    sendMessage(trimmed)
    setInput('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [input, isStreaming, activeConnectionId, historyUnavailable, sendMessage])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isSubmitKey(e)) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }

  const activeConnection = activeConnectionId ? getFullConnection(activeConnectionId) : null
  const connectionName = activeConnection?.name ?? ''
  const isProd = activeConnection?.env === 'prod'

  useEffect(() => {
    if (isProd && sqlPermission !== 'readonly') {
      setSqlPermission('readonly')
    }
  }, [isProd, sqlPermission, setSqlPermission])

  return (
    <div className="px-4 pb-4 pt-2 md:px-6 lg:px-[6%] 2xl:px-[12%]">
      <div className="mx-auto max-w-4xl 2xl:max-w-5xl">
        <div className="glass-panel composer-shell rounded-[18px] transition-all">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={historyUnavailable
              ? historyHint
              : !activeConnectionId
                ? '请先选择一个数据库连接'
                : zeroConfigReady
                  ? '演示库与模型已就绪，无需配置，直接输入业务问题开始查询…'
                  : `你可以问关于数据库${connectionName}的任何问题`}
            disabled={!activeConnectionId || historyUnavailable}
            rows={1}
            className="w-full max-h-[200px] resize-none bg-transparent px-4 pt-3.5 pb-2 text-sm leading-relaxed text-ink outline-none placeholder:text-ink-faint disabled:opacity-50"
          />
          <div className="flex items-center justify-between gap-3 px-3 pb-3">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <div className="relative">
                <button
                  onClick={() => setShowModelMenu(!showModelMenu)}
                  className="control-chip flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-ink-secondary transition-colors hover:bg-surface hover:text-ink"
                >
                  <div className="w-1.5 h-1.5 flex-shrink-0 rounded-full bg-primary" />
                  <span className="truncate">{currentLabel}</span>
                  <ChevronDown className="w-3 h-3" />
                </button>

                {showModelMenu && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowModelMenu(false)} />
                    <div className="absolute bottom-full left-0 z-20 mb-2 min-w-64 overflow-hidden rounded-xl border border-line bg-popover text-popover-foreground py-1 shadow-xl">
                      <div className="flex overflow-x-auto border-b border-line-subtle">
                        {providers.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => setProvider(p.id)}
                            className={`flex-1 shrink-0 whitespace-nowrap px-3 py-2 text-xs font-semibold transition-colors ${
                              p.id === provider
                                ? 'text-primary border-b-2 border-primary'
                                : 'text-ink-muted hover:text-ink'
                            }`}
                          >
                            {p.name}
                          </button>
                        ))}
                      </div>
                      {providerModels.length === 0 && (
                        <div className="px-4 py-3 text-xs text-ink-muted">该服务尚未添加模型，请在设置中编辑</div>
                      )}
                      <div className="max-h-72 overflow-y-auto">
                      {providerModels.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => { setModel(m.id); setShowModelMenu(false) }}
                          className={`w-full text-left px-4 py-2.5 text-sm hover:bg-surface-hover transition-colors flex items-center justify-between ${
                            m.id === model ? 'text-primary font-medium' : 'text-ink-secondary'
                          }`}
                        >
                          <div>
                            <div className="font-medium">{modelLabel(m)}</div>
                            {(m.description || (m.name && m.name !== m.id)) && (
                              <div className="text-xs text-ink-faint">{m.description ?? m.id}</div>
                            )}
                          </div>
                          {m.id === model && (
                            <div className="w-2 h-2 rounded-full bg-primary" />
                          )}
                        </button>
                      ))}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {thinkingStyle !== 'none' && <div className="flex items-center">
                <button
                  onClick={() => setThinkingMode(thinkingMode === 'enabled' ? 'disabled' : 'enabled')}
                  className={`flex items-center gap-1 border px-2.5 py-1 text-xs font-medium transition-all ${
                    thinkingMode === 'enabled'
                      ? 'border-primary/50 bg-primary/5 text-primary'
                      : 'border-line-strong text-ink-muted'
                  } ${thinkingMode === 'enabled' && thinkingStyle === 'deepseek' ? 'rounded-l-full border-r-0' : 'rounded-full'}`}
                >
                  <Atom className="w-3.5 h-3.5" />
                  <span>深度思考</span>
                </button>
                {thinkingMode === 'enabled' && thinkingStyle === 'deepseek' && (
                  <div className="relative flex items-center">
                    <select
                      value={reasoningEffort}
                      onChange={(e) => setReasoningEffort(e.target.value as 'high' | 'max')}
                      className="appearance-none border border-primary/50 bg-primary/5 text-primary rounded-r-full pl-1.5 pr-5 py-1 text-xs outline-none cursor-pointer hover:bg-primary/10 transition-colors"
                    >
                      <option value="high">高</option>
                      <option value="max">最高</option>
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-1.5 h-3 w-3 text-primary" />
                  </div>
                )}
              </div>}

              {!isProd && (
                <button
                  onClick={() => {
                    if (sqlPermission === 'readonly') {
                      setShowSqlWarning(true)
                    } else {
                      setSqlPermission('readonly')
                    }
                  }}
                  className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-all ${
                    sqlPermission === 'write'
                      ? 'border-amber-500 text-amber-600 dark:border-amber-600 dark:text-amber-400'
                      : 'border-line-strong text-ink-muted'
                  }`}
                  title={sqlPermission === 'write' ? '已允许写操作（INSERT/UPDATE/DELETE），AI 生成的写 SQL 需二次确认' : '仅允许查询操作'}
                >
                  <Shield className="w-3.5 h-3.5" />
                  <span>{sqlPermission === 'write' ? '可写入' : '仅查询'}</span>
                </button>
              )}
              <ContextUsageIndicator
                usage={contextUsage}
                modelName={currentModelDisplay}
                isStreaming={isStreaming}
                canStartNewSession={(activeSession?.messages.length ?? 0) > 0}
                onNewSession={createNewSession}
                onSetContextWindow={model ? (tokens) => setModelContextWindow(provider, model, tokens) : undefined}
                toolLabel="工具结果与 SQL 记录"
              />
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {isStreaming ? (
                <button
                  onClick={stopStreaming}
                  className="w-8 h-8 rounded-full flex items-center justify-center transition-all bg-red-500 text-white hover:bg-red-600 shadow-sm"
                  title="停止生成"
                  aria-label="停止生成"
                >
                  <Square className="w-4 h-4" fill="currentColor" />
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  disabled={!canSend}
                  className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                    canSend
                      ? 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm'
                      : 'bg-surface-hover text-ink-faint cursor-not-allowed'
                  }`}
                  title="发送"
                  aria-label="发送"
                >
                  <ArrowUp className="w-4 h-4" strokeWidth={2.5} />
                </button>
              )}
            </div>
          </div>
        </div>

        <p className="mt-2 text-center text-xs text-ink-faint">
          {historyUnavailable ? historyHint : isStreaming ? '正在生成中，可随时停止' : '内容由 AI 生成，请仔细甄别'}
        </p>
      </div>

      <Modal open={showSqlWarning} onClose={() => setShowSqlWarning(false)}>
            <div className="px-6 pt-6 pb-4">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950/60">
                  <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                </div>
                <ModalTitle className="text-base font-semibold text-ink">开启写入模式</ModalTitle>
              </div>

              <div className="space-y-3 text-sm text-ink-secondary">
                <p>开启后，AI 将能够生成并执行以下写操作指令：</p>
                <div className="flex flex-wrap gap-1.5">
                  {['INSERT', 'UPDATE', 'DELETE', 'REPLACE'].map((cmd) => (
                    <span key={cmd} className="rounded-md bg-amber-50 px-2 py-0.5 font-mono text-xs font-medium text-amber-700 dark:bg-amber-950/45 dark:text-amber-300">
                      {cmd}
                    </span>
                  ))}
                </div>

                <div className="rounded-lg bg-red-50 p-3 text-xs text-red-700 dark:bg-red-950/45 dark:text-red-300">
                  <p className="font-medium mb-1">风险提醒</p>
                  <ul className="space-y-1 list-disc list-inside">
                    <li>AI 生成的 SQL 可能修改或删除数据库中的真实数据</li>
                    <li>每条写操作 SQL 仍需您手动确认后才会执行</li>
                  </ul>
                </div>

                <div className="rounded-lg bg-primary/5 p-3 text-xs text-primary">
                  <p className="font-medium mb-1">安全保障</p>
                  <ul className="space-y-1 list-disc list-inside">
                    <li>DROP / ALTER / TRUNCATE 等危险操作始终被禁止</li>
                    <li>可随时切换回「仅查询」模式</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-line-subtle px-6 py-3">
              <button
                autoFocus
                onClick={() => setShowSqlWarning(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-ink-secondary hover:bg-surface-hover transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => { setSqlPermission('write'); setShowSqlWarning(false) }}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 transition-colors"
              >
                确认开启
              </button>
            </div>
      </Modal>
    </div>
  )
}
