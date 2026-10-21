import { CheckCircle2, CircleAlert, Cpu, Globe2, Loader2, WifiOff } from 'lucide-react'
import type { KnowledgeHealth } from '@/lib/knowledge-types'

export function getKnowledgeServiceLabel(health: KnowledgeHealth | null, checking: boolean): string {
  if (checking) return '检测中'
  if (!health) return '未检测'
  return health.status === 'ok' ? '在线' : '暂不可用'
}

export function KnowledgeServiceStatus({ health, checking }: { health: KnowledgeHealth | null; checking: boolean }) {
  const online = health?.status === 'ok'
  return (
    <div className="border-y border-stone-200/70 py-3" aria-live="polite">
      <div className="mb-2 flex items-center justify-between px-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">
          <Cpu className="h-4 w-4 text-stone-500" />
          知识库服务
        </span>
        <span className={`flex items-center gap-1 text-xs ${online && !checking ? 'text-primary' : 'text-stone-500'}`}>
          {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : online ? <CheckCircle2 className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
          {getKnowledgeServiceLabel(health, checking)}
        </span>
      </div>
      <div className="space-y-2 px-2 text-xs text-stone-500">
        <div className="flex items-center gap-2">
          <Globe2 className="h-3.5 w-3.5 text-stone-400" />
          <span>{online ? health.webSearchAvailable ? '联网搜索可用' : '联网搜索未配置' : '联网搜索状态未知'}</span>
        </div>
        {health?.status === 'offline' && !checking && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-50/70 px-2 py-1.5 text-amber-700">
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <span>知识库服务暂不可用，请重新检测；若持续失败，请联系管理员。</span>
          </div>
        )}
      </div>
    </div>
  )
}
