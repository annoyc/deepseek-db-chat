import { useState, useRef, useCallback, useEffect } from 'react'
import { ArrowUp, ChevronDown } from 'lucide-react'
import { useChatStore } from '@/hooks/useChat'
import { useDatabaseStore } from '@/hooks/useDatabase'
import { useSettings } from '@/hooks/useSettings'
import { AVAILABLE_MODELS } from '@/lib/constants'

export function MessageInput() {
  const [input, setInput] = useState('')
  const [showModelMenu, setShowModelMenu] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { sendMessage, isStreaming, activeSessionId } = useChatStore()
  const { activeConnectionId, getFullConnection } = useDatabaseStore()
  const { model, setModel } = useSettings()
  const prevSessionIdRef = useRef(activeSessionId)

  useEffect(() => {
    if (activeSessionId && activeSessionId !== prevSessionIdRef.current) {
      prevSessionIdRef.current = activeSessionId
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }, [activeSessionId])

  const currentModel = AVAILABLE_MODELS.find((m) => m.id === model) ?? AVAILABLE_MODELS[0]
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

  const connectionName = activeConnectionId ? getFullConnection(activeConnectionId)?.name : ''

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
            <div className="relative">
              <button
                onClick={() => setShowModelMenu(!showModelMenu)}
                className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors px-2 py-1 rounded-lg hover:bg-gray-100"
              >
                <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                <span>{currentModel.name}</span>
                <ChevronDown className="w-3 h-3" />
              </button>

              {showModelMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowModelMenu(false)} />
                  <div className="absolute bottom-full left-0 mb-1 z-20 bg-white border border-gray-200 rounded-xl shadow-lg py-1 min-w-48">
                    {AVAILABLE_MODELS.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => { setModel(m.id); setShowModelMenu(false) }}
                        className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors flex items-center justify-between ${
                          m.id === model ? 'text-green-700 font-medium' : 'text-gray-700'
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

            <button
              onClick={handleSubmit}
              disabled={!canSend}
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                canSend
                  ? 'bg-gray-900 text-white hover:bg-gray-800 shadow-sm'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              <ArrowUp className="w-4 h-4" strokeWidth={2.5} />
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-2">
          {isStreaming ? '正在思考中...' : '内容由 AI 生成，请仔细甄别'}
        </p>
      </div>
    </div>
  )
}
