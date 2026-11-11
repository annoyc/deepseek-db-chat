import { createContext, useContext, useMemo, useState, useEffect, useRef } from 'react'
import { PanelRightClose, Database, Code2, Table2, ChevronDown, ChevronRight, TerminalSquare, Sparkles } from 'lucide-react'
import type { ChatMessage, SqlResultInfo, AnalysisReport } from '@/lib/types'
import { ResultTable } from './ResultTable'
import { ResultChart, analyzeChartData } from './ResultChart'
import { AnalysisReportCard } from './AnalysisReportCard'
import { useChatStore } from '@/hooks/useChat'
import { CopyButton } from '@/components/ui/copy-button'
import { cn } from '@/lib/utils'

interface VisualizationPanelProps {
  messages: ChatMessage[]
  onCollapse: () => void
  /** Ask the panel to open and scroll to one message's result. */
  focusRequest?: { id: string; nonce: number } | null
  onFocusHandled?: () => void
}

interface VizItem {
  id: string
  sql: string
  result: SqlResultInfo
  intentSummary?: string
  analysisReport?: AnalysisReport
  timestamp: string
}

function extractVizItems(messages: ChatMessage[]): VizItem[] {
  const items: VizItem[] = []
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.role !== 'assistant' || !msg.sqlResult) continue

    let report = msg.analysisReport
    if (!report) {
      for (let j = i + 1; j < messages.length; j++) {
        if (messages[j].role === 'assistant' && messages[j].analysisReport) {
          report = messages[j].analysisReport
          break
        }
        if (messages[j].role === 'assistant' && messages[j].sqlResult) break
      }
    }

    items.push({
      id: msg.id,
      sql: msg.sqlResult.executedSql ?? msg.sqlConfirm?.sql ?? '',
      result: msg.sqlResult,
      intentSummary: msg.sqlConfirm?.intent_summary,
      analysisReport: report,
      timestamp: msg.timestamp,
    })
  }
  return items
}

/** Opens the data panel at one message's query result. Null when no panel is available. */
export const VizFocusContext = createContext<((messageId: string) => void) | null>(null)

export function useVizFocus() {
  return useContext(VizFocusContext)
}

export function VisualizationPanel({ messages, onCollapse, focusRequest, onFocusHandled }: VisualizationPanelProps) {
  const items = useMemo(() => extractVizItems(messages), [messages])
  const { draftMessage } = useChatStore()
  const bottomRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef(new Map<string, HTMLDivElement>())
  const prevLenRef = useRef(items.length)
  // Only the newest result is open by default; these record what the user toggled by hand.
  const [expandedOverrides, setExpandedOverrides] = useState<Record<string, boolean>>({})
  const [highlightId, setHighlightId] = useState<string | null>(null)

  useEffect(() => {
    if (items.length > prevLenRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
    prevLenRef.current = items.length
  }, [items.length])

  useEffect(() => {
    if (!focusRequest) return
    const { id } = focusRequest
    onFocusHandled?.()
    setExpandedOverrides((prev) => ({ ...prev, [id]: true }))
    setHighlightId(id)
    const frame = requestAnimationFrame(() => {
      itemRefs.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    const timer = setTimeout(() => setHighlightId((current) => (current === id ? null : current)), 1800)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
    }
    // onFocusHandled clears the request; the highlight timer must outlive that re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest?.nonce])

  if (items.length === 0) {
    return (
      <div className="h-full flex flex-col border-l border-gray-200 bg-white">
        <Header onCollapse={onCollapse} count={0} />
        <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
          <div className="text-center space-y-2">
            <Database className="w-8 h-8 mx-auto text-gray-300" />
            <p>暂无查询结果</p>
            <p className="text-xs text-gray-300">SQL 执行后结果将在此展示</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col border-l border-gray-200 bg-white">
      <Header onCollapse={onCollapse} count={items.length} />
      <div className="subtle-scrollbar flex-1 overflow-y-auto">
        <div className="space-y-0">
          {items.map((item, idx) => {
            const isLast = idx === items.length - 1
            return (
              <VizItemCard
                key={item.id}
                item={item}
                index={idx + 1}
                isLast={isLast}
                expanded={expandedOverrides[item.id] ?? isLast}
                highlighted={highlightId === item.id}
                onToggle={(next) => setExpandedOverrides((prev) => ({ ...prev, [item.id]: next }))}
                onQueryClick={draftMessage}
                containerRef={(el) => {
                  if (el) itemRefs.current.set(item.id, el)
                  else itemRefs.current.delete(item.id)
                }}
              />
            )
          })}
        </div>
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

function SectionTitle({ icon: Icon, title }: { icon: typeof TerminalSquare; title: string }) {
  return (
    <div className="flex items-center gap-1.5 mb-2">
      <Icon className="w-3.5 h-3.5 text-gray-400" />
      <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{title}</span>
    </div>
  )
}

interface VizItemCardProps {
  item: VizItem
  index: number
  isLast: boolean
  expanded: boolean
  highlighted: boolean
  onToggle: (expanded: boolean) => void
  onQueryClick: (q: string) => void
  containerRef: (el: HTMLDivElement | null) => void
}

function VizItemCard({ item, index, isLast, expanded, highlighted, onToggle, onQueryClick, containerRef }: VizItemCardProps) {
  const [showSql, setShowSql] = useState(false)
  const [showTable, setShowTable] = useState(true)

  const sqlAnalysis = useMemo(() => {
    return analyzeChartData(item.result.columns, item.result.rows)
  }, [item.result])

  return (
    <div
      ref={containerRef}
      className={cn(
        'scroll-mt-2 px-4 py-3 transition-colors duration-700 animate-in fade-in slide-in-from-right-3',
        !isLast && 'border-b border-gray-100',
        highlighted && 'bg-primary/5',
      )}
    >
      <button
        type="button"
        onClick={() => onToggle(!expanded)}
        aria-expanded={expanded}
        className={cn(
          'flex w-full items-start gap-1.5 rounded-lg border px-3 py-1.5 text-left text-xs leading-relaxed transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
          expanded ? 'border-primary/15 bg-primary/5 text-gray-600' : 'border-gray-200 bg-gray-50/70 text-gray-500 hover:border-primary/20 hover:bg-primary/5',
          highlighted && 'ring-2 ring-primary/40',
        )}
      >
        {expanded
          ? <ChevronDown className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-primary" />
          : <ChevronRight className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-gray-400" />}
        <span className="min-w-0 flex-1">
          <span className="font-medium text-primary">查询 #{index}：</span>
          {item.intentSummary || '查询结果'}
        </span>
        <span className="flex-shrink-0 text-gray-400">{item.result.rowCount} 行</span>
      </button>

      {expanded && (
        <div className="mt-3">
          {/* ── Section 1: SQL 执行 ── */}
          <SectionTitle icon={TerminalSquare} title="SQL 执行结果" />

          {sqlAnalysis && (
            <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-2 mb-2">
              <ResultChart result={item.result} />
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowSql(!showSql)}
              aria-expanded={showSql}
              className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
            >
              {showSql ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              <Code2 className="w-3 h-3" />
              <span>SQL</span>
            </button>
            <button
              onClick={() => setShowTable(!showTable)}
              aria-expanded={showTable}
              className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
            >
              {showTable ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              <Table2 className="w-3 h-3" />
              <span>数据表</span>
            </button>
          </div>

          {showSql && item.sql && (
            <div className="relative mt-2">
              <pre className="text-[11px] font-mono text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-2 pr-9 overflow-x-auto whitespace-pre-wrap max-h-32 overflow-y-auto leading-relaxed">
                {item.sql}
              </pre>
              <CopyButton text={item.sql} label="复制 SQL" className="absolute right-1.5 top-1.5 hover:bg-gray-200/70" />
            </div>
          )}

          {showTable && (
            <div className="mt-2 border border-gray-100 rounded-lg overflow-hidden">
              <ResultTable result={item.result} />
            </div>
          )}

          {/* ── Section 2: 分析总结 ── */}
          {item.analysisReport && (
            <>
              <div className="border-t border-gray-200 my-3" />
              <SectionTitle icon={Sparkles} title="分析总结" />
              <AnalysisReportCard report={item.analysisReport} result={item.result} onQueryClick={onQueryClick} />
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Header({ onCollapse, count }: { onCollapse: () => void; count: number }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 bg-white flex-shrink-0">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-gray-800">数据面板</span>
        {count > 0 && (
          <span className="text-[11px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">{count}</span>
        )}
      </div>
      <button
        onClick={onCollapse}
        className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        title="收起面板"
        aria-label="收起数据面板"
      >
        <PanelRightClose className="w-4 h-4" />
      </button>
    </div>
  )
}
