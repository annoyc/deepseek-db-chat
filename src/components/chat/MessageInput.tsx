import { useState, useRef, useCallback, useEffect } from 'react'
import { ArrowUp, Square, Atom, ChevronDown, Shield, AlertTriangle } from 'lucide-react'
import { useChatStore } from '@/hooks/useChat'
import { useDatabaseStore } from '@/hooks/useDatabase'
import { useSettings } from '@/hooks/useSettings'
import { PROVIDERS, getModelsForProvider } from '@/lib/constants'

export function MessageInput() {
  const [input, setInput] = useState('')
  const [showModelMenu, setShowModelMenu] = useState(false)
  const [showSqlWarning, setShowSqlWarning] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { sendMessage, isStreaming, activeSessionId, stopStreaming } = useChatStore()
  const { activeConnectionId, getFullConnection } = useDatabaseStore()
  const { provider, setProvider, model, setModel, thinkingMode, setThinkingMode, reasoningEffort, setReasoningEffort, sqlPermission, setSqlPermission } = useSettings()
  const prevSessionIdRef = useRef(activeSessionId)

  useEffect(() => {
    if (activeSessionId && activeSessionId !== prevSessionIdRef.current) {
      prevSessionIdRef.current = activeSessionId
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }, [activeSessionId])

  const providerModels = getModelsForProvider(provider)
  const currentModel = providerModels.find((m) => m.id === model) ?? providerModels[0]
  const currentProvider = PROVIDERS.find((p) => p.id === provider) ?? PROVIDERS[0]
  const canSend = input.trim() && !isStreaming && activeConnectionId

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim()
    if (!trimmed || isStreaming || !activeConnectionId) return
    sendMessage(trimmed)
    setInput('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [input, isStreaming, activeConnectionId, sendMessage])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
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
    <div className="px-[10%] pb-4 pt-2 bg-[#f5f5f0]">
      <div className="mx-auto">
        <div className="border border-gray-300 rounded-2xl bg-white shadow-sm focus-within:border-gray-400 focus-within:shadow-md transition-shadow">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={activeConnectionId ? `你可以问关于数据库${connectionName}的任何问题` : '请先选择一个数据库连接'}
            disabled={!activeConnectionId || isStreaming}
            rows={2}
            className="w-full resize-none px-4 pt-4 pb-2 text-sm bg-transparent outline-none placeholder-gray-400 disabled:opacity-50 max-h-[200px] leading-relaxed"
          />
          <div className="flex items-center justify-between px-3 pb-3">
            <div className="flex items-center gap-1">
              <div className="relative">
                <button
                  onClick={() => setShowModelMenu(!showModelMenu)}
                  className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors px-2 py-1 rounded-lg hover:bg-gray-100"
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                  <span>{currentProvider.name} / {currentModel.name}</span>
                  <ChevronDown className="w-3 h-3" />
                </button>

                {showModelMenu && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowModelMenu(false)} />
                    <div className="absolute bottom-full left-0 mb-1 z-20 bg-white border border-gray-200 rounded-xl shadow-lg py-1 min-w-56">
                      <div className="flex border-b border-gray-100">
                        {PROVIDERS.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => setProvider(p.id)}
                            className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                              p.id === provider
                                ? 'text-primary border-b-2 border-primary'
                                : 'text-gray-500 hover:text-gray-700'
                            }`}
                          >
                            {p.name}
                          </button>
                        ))}
                      </div>
                      {providerModels.map((m) => (
                        <button
                          key={`${m.provider}-${m.id}`}
                          onClick={() => { setModel(m.id); setShowModelMenu(false) }}
                          className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors flex items-center justify-between ${
                            m.id === model ? 'text-primary font-medium' : 'text-gray-700'
                          }`}
                        >
                          <div>
                            <div className="font-medium">{m.name}</div>
                            <div className="text-xs text-gray-400">{m.description}</div>
                          </div>
                          {m.id === model && (
                            <div className="w-2 h-2 rounded-full bg-green-500" />
                          )}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div className="flex items-center">
                <button
                  onClick={() => setThinkingMode(thinkingMode === 'enabled' ? 'disabled' : 'enabled')}
                  className={`flex items-center gap-1 border px-2.5 py-0.5 text-xs transition-all ${
                    thinkingMode === 'enabled'
                      ? 'border-primary/50 text-primary'
                      : 'border-gray-300 text-gray-400'
                  } ${thinkingMode === 'enabled' ? 'rounded-l-full border-r-0' : 'rounded-full'}`}
                >
                  <Atom className="w-3.5 h-3.5" />
                  <span>深度思考</span>
                </button>
                {thinkingMode === 'enabled' && (
                  <select
                    value={reasoningEffort}
                    onChange={(e) => setReasoningEffort(e.target.value as 'high' | 'max')}
                    className="appearance-none border border-primary/50 text-primary bg-transparent rounded-r-full pl-1.5 pr-4 py-0.5 text-xs outline-none cursor-pointer hover:bg-primary/5 transition-colors"
                    style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%236366f1' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center' }}
                  >
                    <option value="high">高</option>
                    <option value="max">最大</option>
                  </select>
                )}
              </div>

              {!isProd && (
                <button
                  onClick={() => {
                    if (sqlPermission === 'readonly') {
                      setShowSqlWarning(true)
                    } else {
                      setSqlPermission('readonly')
                    }
                  }}
                  className={`flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition-all ${
                    sqlPermission === 'write'
                      ? 'border-amber-500 text-amber-600'
                      : 'border-gray-300 text-gray-500'
                  }`}
                  title={sqlPermission === 'write' ? '已允许写操作（INSERT/UPDATE/DELETE），AI 生成的写 SQL 需二次确认' : '仅允许查询操作'}
                >
                  <Shield className="w-3.5 h-3.5" />
                  <span>{sqlPermission === 'write' ? '可写入' : '仅查询'}</span>
                </button>
              )}
            </div>

            {isStreaming ? (
              <button
                onClick={stopStreaming}
                className="w-8 h-8 rounded-full flex items-center justify-center transition-all bg-red-500 text-white hover:bg-red-600 shadow-sm"
              >
                <Square className="w-4 h-4" fill="currentColor" />
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={!canSend}
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                  canSend
                    ? 'bg-primary text-white hover:bg-primary/90 shadow-sm'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                <ArrowUp className="w-4 h-4" strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-2">
          {isStreaming ? '正在生成中，可随时停止' : '内容由 AI 生成，请仔细甄别'}
        </p>
      </div>

      {showSqlWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowSqlWarning(false)}>
          <div className="mx-4 w-full max-w-md rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-4">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
                  <AlertTriangle className="h-5 w-5 text-amber-600" />
                </div>
                <h3 className="text-base font-semibold text-gray-900">开启写入模式</h3>
              </div>

              <div className="space-y-3 text-sm text-gray-600">
                <p>开启后，AI 将能够生成并执行以下写操作指令：</p>
                <div className="flex flex-wrap gap-1.5">
                  {['INSERT', 'UPDATE', 'DELETE', 'REPLACE'].map((cmd) => (
                    <span key={cmd} className="rounded-md bg-amber-50 px-2 py-0.5 font-mono text-xs font-medium text-amber-700">
                      {cmd}
                    </span>
                  ))}
                </div>

                <div className="rounded-lg bg-red-50 p-3 text-xs text-red-700">
                  <p className="font-medium mb-1">风险提醒</p>
                  <ul className="space-y-1 list-disc list-inside">
                    <li>AI 生成的 SQL 可能修改或删除数据库中的真实数据</li>
                    <li>每条写操作 SQL 仍需您手动确认后才会执行</li>
                  </ul>
                </div>

                <div className="rounded-lg bg-green-50 p-3 text-xs text-green-700">
                  <p className="font-medium mb-1">安全保障</p>
                  <ul className="space-y-1 list-disc list-inside">
                    <li>DROP / ALTER / TRUNCATE 等危险操作始终被禁止</li>
                    <li>可随时切换回「仅查询」模式</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-6 py-3">
              <button
                onClick={() => setShowSqlWarning(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
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
          </div>
        </div>
      )}
    </div>
  )
}
