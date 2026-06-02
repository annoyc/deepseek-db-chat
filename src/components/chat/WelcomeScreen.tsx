import { Coins, Shield, Eye, Lock } from 'lucide-react'

interface WelcomeScreenProps {
  onSuggestionClick: (question: string) => void
  hasConnection: boolean
  connectionName?: string
  connectionStatus?: 'idle' | 'testing' | 'success' | 'error'
  connectionError?: string | null
}

const features = [
  {
    icon: Coins,
    title: '极致成本',
    description: '基于 DeepSeek 前缀缓存优化，复用上下文降低 API 调用开销，智能控制 Token 消耗',
    color: 'text-yellow-600',
    bg: 'bg-yellow-50',
  },
  {
    icon: Shield,
    title: '安全可靠',
    description: '数据库密码 AES-256 加密存储，SQL 执行前必须经你确认，危险操作一律拦截，仅允许安全查询',
    color: 'text-green-600',
    bg: 'bg-green-50',
  },
  {
    icon: Eye,
    title: '过程透明',
    description: 'AI 思考过程与工具调用完全可视化，每一步推理和 SQL 生成都有迹可循，拒绝黑箱操作',
    color: 'text-blue-600',
    bg: 'bg-blue-50',
  },
  {
    icon: Lock,
    title: '隐私无忧',
    description: '除对话外（敏感数据脱敏后再发送给模型），所有对话记录完全存储在本地，你的数据始终只属于你',
    color: 'text-purple-600',
    bg: 'bg-purple-50',
  },
]

const suggestions = [
  { icon: '', text: '这个数据库有哪几张用户表?' },
  { icon: '', text: '帮我查看终端用户表的结构' },
  { icon: '', text: '查询最近一个月广告页访问量趋势' },
  { icon: '', text: '查询最近一个月首页banner点击事件趋势' },
]

export function WelcomeScreen({ onSuggestionClick, hasConnection, connectionName, connectionStatus, connectionError }: WelcomeScreenProps) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-8 h-full flex flex-col justify-center">
        {/* Hero */}
        <div className="text-center space-y-3 pt-8">
          <div className="w-16 h-16 mx-auto rounded-2xl overflow-hidden shadow-lg shadow-green-100">
            <img src="/logo.svg" alt="DB Chat2SQL" className="w-full h-full" />
          </div>
          <h1 className="text-2xl font-semibold text-gray-900">
            DeepSeek-Native DB Chat2SQL Agent
          </h1>
          {connectionStatus === 'error' ? (
            <div>
              <p className="text-sm text-red-500 font-medium">连接失败</p>
              <p className="text-xs text-red-400 mt-1">{connectionError}</p>
            </div>
          ) : connectionStatus === 'testing' ? (
            <p className="text-sm text-yellow-500">连接测试中...</p>
          ) : hasConnection ? (
            <p className="text-sm text-green-600">已连接 {connectionName}</p>
          ) : (
            <p className="text-sm text-gray-500">用自然语言查询数据库，AI 自动生成 SQL 并执行</p>
          )}
        </div>

        {/* Feature cards */}
        <div className="grid grid-cols-2 gap-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="group rounded-xl border border-gray-100 bg-white p-4 hover:shadow-md hover:border-gray-200 transition-all"
            >
              <div className="flex items-start gap-3">
                <div className={`flex-shrink-0 w-9 h-9 rounded-lg ${f.bg} flex items-center justify-center`}>
                  <f.icon className={`w-4.5 h-4.5 ${f.color}`} />
                </div>
                <div>
                  <h3 className="text-sm font-medium text-gray-800">{f.title}</h3>
                  <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{f.description}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Suggestions */}
        {connectionStatus === 'success' && (
          <div className="space-y-3">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">试试问我</p>
            <div className="grid grid-cols-2 gap-2">
              {suggestions.map((s) => (
                <button
                  key={s.text}
                  onClick={() => onSuggestionClick(s.text)}
                  className="cursor-pointer text-left px-4 py-3 text-sm text-gray-600 bg-white border border-gray-100 rounded-xl hover:border-green-400 hover:text-green-700 hover:bg-green-50/50 transition-all"
                >
                  <span className="mr-1.5">{s.icon}</span>
                  {s.text}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
