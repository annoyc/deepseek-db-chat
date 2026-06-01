import { Database, Zap, Shield, Search, Terminal, Eye } from 'lucide-react'

interface WelcomeScreenProps {
  onSuggestionClick: (question: string) => void
  hasConnection: boolean
  connectionName?: string
}

const features = [
  {
    icon: Search,
    title: '自然语言查询',
    description: '用中文描述需求，AI 自动生成精准 SQL，无需手写代码',
    color: 'text-blue-600',
    bg: 'bg-blue-50',
  },
  {
    icon: Eye,
    title: '自动探索结构',
    description: 'AI 自动查看表结构，确认字段名后再生成 SQL，避免字段错误',
    color: 'text-purple-600',
    bg: 'bg-purple-50',
  },
  {
    icon: Shield,
    title: '执行前确认',
    description: 'SQL 执行前会展示给你确认，仅允许查询类操作，保障数据安全',
    color: 'text-green-600',
    bg: 'bg-green-50',
  },
  {
    icon: Terminal,
    title: '流式实时响应',
    description: '基于 DeepSeek 大模型，流式输出思考过程和结果，实时可见',
    color: 'text-orange-600',
    bg: 'bg-orange-50',
  },
]

const suggestions = [
  { icon: '', text: '这个数据库有哪些表?' },
  { icon: '🔍', text: '帮我查看所有表的结构' },
  { icon: '📊', text: '查询最近 7 天的数据量趋势' },
  { icon: '👥', text: '找出每个部门的用户数量' },
]

export function WelcomeScreen({ onSuggestionClick, hasConnection, connectionName }: WelcomeScreenProps) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-8 h-full flex flex-col justify-center">
        {/* Hero */}
        <div className="text-center space-y-3 pt-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-green-600 to-green-700 shadow-lg shadow-green-200">
            <Database className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-semibold text-gray-900">
            DeepSeek-Native DB Chat2SQL Agent
          </h1>
          <p className="text-sm text-gray-500">
            {hasConnection ? `已连接 ${connectionName}` : '用自然语言查询数据库，AI 自动生成 SQL 并执行'}
          </p>
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
        {hasConnection && (
          <div className="space-y-3">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">试试问我</p>
            <div className="grid grid-cols-2 gap-2">
              {suggestions.map((s) => (
                <button
                  key={s.text}
                  onClick={() => onSuggestionClick(s.text)}
                  className="text-left px-4 py-3 text-sm text-gray-600 bg-white border border-gray-100 rounded-xl hover:border-green-400 hover:text-green-700 hover:bg-green-50/50 transition-all"
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
