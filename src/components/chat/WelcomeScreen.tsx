import { Brain, DatabaseZap, Eye, Lock, ShieldCheck } from 'lucide-react'
import { APP_NAME } from '@/lib/constants'

interface WelcomeScreenProps {
  onSuggestionClick: (text: string) => void
  hasConnection: boolean
  connectionName?: string
}

const suggestions = [
  '最近一周新增了多少合同？',
  '各省份售电公司服务覆盖情况如何？',
  '月度合同电量整体呈现什么走势？',
  '周间人佣金贡献最高的前十个合同是哪些？',
]

const features = [
  {
    icon: Brain,
    title: '自然语言查询',
    description: '直接提出业务问题，由模型生成查询思路和 SQL',
    color: 'text-primary',
    bg: 'bg-primary/10',
  },
  {
    icon: ShieldCheck,
    title: '安全执行',
    description: '默认仅查询，写入操作需人工确认',
    color: 'text-indigo-600',
    bg: 'bg-indigo-50',
  },
  {
    icon: Eye,
    title: '过程透明',
    description: '思考过程、工具调用、执行结果清晰可追踪',
    color: 'text-amber-600',
    bg: 'bg-amber-50',
  },
  {
    icon: Lock,
    title: '本地优先',
    description: '连接信息与对话历史保存在当前浏览器',
    color: 'text-stone-700',
    bg: 'bg-stone-100',
  },
]

export function WelcomeScreen({ onSuggestionClick, hasConnection, connectionName }: WelcomeScreenProps) {
  return (
    <div className="subtle-scrollbar h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full max-w-4xl flex-col justify-center space-y-4 px-3 py-5 md:px-6 lg:py-6 2xl:max-w-5xl 2xl:space-y-5 2xl:py-8">
        <section className="glass-panel rounded-[20px] p-5 lg:p-6 2xl:p-8">
          <div className="flex items-start gap-3.5 2xl:gap-4">
            <div className="anim-logo d-0 h-12 w-12 flex-shrink-0 overflow-hidden rounded-2xl shadow-lg shadow-primary/15 ring-1 ring-stone-200/80 2xl:h-14 2xl:w-14">
              <img src={`${import.meta.env.BASE_URL}logo.svg`} alt={APP_NAME} className="h-full w-full" />
            </div>
            <div className="min-w-0">
              <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-primary/15 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
                <DatabaseZap className="h-3.5 w-3.5" />
                SQL Copilot
              </div>
              <h1 className="anim-up d-1 text-2xl font-semibold tracking-tight text-stone-950 lg:text-3xl 2xl:text-4xl">数据分析助手</h1>
              <p className="anim-up d-2 mt-2 max-w-2xl text-sm leading-6 text-stone-600">
                自然语言查询、SQL 审核、结果解释与可视化，集中在一个本地优先的数据工作台。
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-3 lg:grid-cols-2 2xl:mt-8">
            {features.map((feature, index) => (
              <div
                key={feature.title}
                className={`group rounded-xl border border-stone-200/70 bg-white/70 p-3.5 transition-all hover:border-primary/25 hover:bg-white hover:shadow-sm 2xl:p-4 anim-up d-${index + 3}`}
              >
                <div className="flex items-start gap-3">
                  <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg 2xl:h-9 2xl:w-9 ${feature.bg}`}>
                    <feature.icon className={`h-4.5 w-4.5 ${feature.color}`} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-stone-900">{feature.title}</h3>
                    <p className="mt-0.5 text-xs leading-relaxed text-stone-500">{feature.description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="glass-panel space-y-3 rounded-[20px] p-4 2xl:p-5 anim-up d-7">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">建议问题</p>
            {hasConnection && connectionName && (
              <span className="truncate rounded-full border border-primary/15 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                {connectionName}
              </span>
            )}
          </div>
          <div className="grid gap-2 lg:grid-cols-2">
            {suggestions.map((item) => (
              <button
                key={item}
                onClick={() => onSuggestionClick(item)}
                disabled={!hasConnection}
                className="rounded-xl border border-stone-200/70 bg-white/72 px-3.5 py-2.5 text-left text-sm leading-5 text-stone-700 transition-all hover:border-primary/35 hover:bg-white hover:text-primary hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-45 2xl:px-4 2xl:py-3"
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
