import { useState, useEffect, useRef, useCallback } from 'react'
import { Coins, Shield, Eye, Lock, Loader2, Circle, RefreshCw } from 'lucide-react'
import { useDatabaseStore } from '@/hooks/useDatabase'
import { useSettings } from '@/hooks/useSettings'
import { generateSuggestions } from '@/server/functions/generate-suggestions'

interface WelcomeScreenProps {
  onSuggestionClick: (question: string) => void
  hasConnection: boolean
  connectionName?: string
  connectionStatus?: 'idle' | 'testing' | 'success' | 'error'
  connectionError?: string | null
  activeConnectionId?: string | null
}

const features = [
  {
    icon: Coins,
    title: '多模型支持',
    description: 'DeepSeek / Kimi / Qwen / GLM 多模型自由切换，前缀缓存优化极致性价比',
    color: 'text-yellow-600',
    bg: 'bg-yellow-50',
  },
  {
    icon: Shield,
    title: '安全可靠',
    description: 'AES-256 加密存储，SQL 三重校验，危险操作全面拦截',
    color: 'text-green-600',
    bg: 'bg-green-50',
  },
  {
    icon: Eye,
    title: '过程透明',
    description: 'AI 思考过程与工具调用完全可视化，每一步有迹可循',
    color: 'text-blue-600',
    bg: 'bg-blue-50',
  },
  {
    icon: Lock,
    title: '隐私无忧',
    description: '敏感数据脱敏，对话记录完全存储在本地，数据只属于你',
    color: 'text-purple-600',
    bg: 'bg-purple-50',
  },
]

export function WelcomeScreen({ onSuggestionClick, hasConnection, connectionName, connectionStatus, connectionError, activeConnectionId }: WelcomeScreenProps) {
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const cacheRef = useRef<Map<string, string[]>>(new Map())
  const { getFullConnection } = useDatabaseStore()
  const { provider, model, apiKey, baseURL } = useSettings()

  const fetchSuggestions = useCallback((connId: string, skipCache = false) => {
    if (!skipCache && cacheRef.current.has(connId)) {
      setSuggestions(cacheRef.current.get(connId)!)
      return () => {}
    }

    const conn = getFullConnection(connId)
    if (!conn) return () => {}

    let cancelled = false
    setLoadingSuggestions(true)

    generateSuggestions({
      data: { connection: conn, provider, model, apiKey: apiKey || undefined, baseURL: baseURL || undefined },
    })
      .then((result) => {
        if (cancelled) return
        cacheRef.current.set(connId, result)
        setSuggestions(result)
      })
      .catch(() => {
        if (cancelled) return
        setSuggestions([])
      })
      .finally(() => {
        if (!cancelled) setLoadingSuggestions(false)
      })

    return () => { cancelled = true }
  }, [getFullConnection, provider, model, apiKey, baseURL])

  useEffect(() => {
    if (connectionStatus !== 'success' || !activeConnectionId) return
    return fetchSuggestions(activeConnectionId)
  }, [activeConnectionId, connectionStatus, fetchSuggestions])

  const handleRefresh = useCallback(() => {
    if (!activeConnectionId || loadingSuggestions) return
    cacheRef.current.delete(activeConnectionId)
    fetchSuggestions(activeConnectionId, true)
  }, [activeConnectionId, loadingSuggestions, fetchSuggestions])

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-8 min-h-full flex flex-col justify-center">
        {/* Hero */}
        <div className="text-center space-y-4">
          <div className="w-20 h-20 mx-auto rounded-2xl overflow-hidden shadow-lg shadow-emerald-200/60 anim-logo d-0">
            <img src="/logo.svg" alt="DBPilot" className="w-full h-full" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-3xl font-bold text-gray-900 tracking-tight anim-up d-1">
              DBPilot
            </h1>
            <p className="text-sm text-gray-500 anim-up d-2">AI 数据库领航助手 — 用自然语言探索你的数据</p>
          </div>
          {connectionStatus === 'error' ? (
            <div className="anim-up d-3">
              <p className="text-sm text-red-500 font-medium">连接失败</p>
              <p className="text-xs text-red-400 mt-1">{connectionError}</p>
            </div>
          ) : connectionStatus === 'testing' ? (
            <p className="text-sm text-yellow-500 anim-up d-3">连接测试中...</p>
          ) : hasConnection ? (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-50 border border-green-200 rounded-full anim-up d-3">
              <Circle className="w-2 h-2 text-green-500 fill-green-500" />
              <span className="text-xs text-green-700 font-medium leading-none">{connectionName}</span>
            </div>
          ) : (
            <p className="text-sm text-gray-400 anim-up d-3">添加数据库连接以开始</p>
          )}
        </div>

        {/* Feature cards */}
        <div className="grid grid-cols-2 gap-3">
          {features.map((f, i) => (
            <div
              key={f.title}
              className={`group rounded-xl border border-gray-100 bg-white p-4 hover:shadow-md hover:border-gray-200 transition-all anim-up d-${i + 4}`}
            >
              <div className="flex items-start gap-3">
                <div className={`flex-shrink-0 w-9 h-9 rounded-lg ${f.bg} flex items-center justify-center`}>
                  <f.icon className={`w-4.5 h-4.5 ${f.color}`} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-gray-800">{f.title}</h3>
                  <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{f.description}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Suggestions */}
        {connectionStatus === 'success' && (
          <div className="space-y-3 anim-up d-8">
            <div className="flex items-center gap-2">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">试试问我</p>
              {!loadingSuggestions && suggestions.length > 0 && (
                <button
                  onClick={handleRefresh}
                  className="p-0.5 text-gray-300 hover:text-gray-500 transition-colors rounded"
                  title="换一批问题"
                >
                  <RefreshCw className="w-3 h-3" />
                </button>
              )}
            </div>
            {loadingSuggestions ? (
              <div className="flex items-center justify-center py-6 gap-2 text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-xs">AI 正在分析数据库结构...</span>
              </div>
            ) : suggestions.length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {suggestions.map((text, i) => (
                  <button
                    key={text}
                    onClick={() => onSuggestionClick(text)}
                    className={`cursor-pointer text-left px-4 py-3 text-sm text-gray-600 bg-white border border-gray-100 rounded-xl hover:border-green-400 hover:text-green-700 hover:bg-green-50/50 transition-all anim-up d-${Math.min(i + 9, 12)}`}
                  >
                    {text}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
