import { useMemo, useState, useEffect, useRef } from 'react'
import { PanelRightClose, Database, Code2, Table2, ChevronDown, ChevronRight, TerminalSquare, Sparkles } from 'lucide-react'
import type { ChatMessage, SqlResultInfo, AnalysisReport } from '@/lib/types'
import { ResultTable } from './ResultTable'
import { ResultChart, analyzeChartData } from './ResultChart'
import { AnalysisReportCard } from './AnalysisReportCard'
import { useChatStore } from '@/hooks/useChat'

interface VisualizationPanelProps {
  messages: ChatMessage[]
  onCollapse: () => void
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
      sql: msg.sqlConfirm?.sql ?? '',
      result: msg.sqlResult,
      intentSummary: msg.sqlConfirm?.intent_summary,
      analysisReport: report,
      timestamp: msg.timestamp,
    })
  }
  return items
}

export function VisualizationPanel({ messages, onCollapse }: VisualizationPanelProps) {
  const items = useMemo(() => extractVizItems(messages), [messages])
  const { sendMessage } = useChatStore()
  const bottomRef = useRef<HTMLDivElement>(null)
  const prevLenRef = useRef(items.length)

  useEffect(() => {
    if (items.length > prevLenRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
    prevLenRef.current = items.length
  }, [items.length])

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
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-0">
          {items.map((item, idx) => (
            <VizItemCard key={item.id} item={item} index={idx + 1} isLast={idx === items.length - 1} onQueryClick={sendMessage} />
          ))}
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

function VizItemCard({ item, index, isLast, onQueryClick }: { item: VizItem; index: number; isLast: boolean; onQueryClick: (q: string) => void }) {
  const [showSql, setShowSql] = useState(false)
  const [showTable, setShowTable] = useState(true)

  const sqlAnalysis = useMemo(() => {
    return analyzeChartData(item.result.columns, item.result.rows)
  }, [item.result])

  const sqlAutoChartType = sqlAnalysis?.recommended

  return (
    <div className={`px-4 py-4 animate-in fade-in slide-in-from-right-3 duration-300 ${!isLast ? 'border-b border-gray-100' : ''}`}>
      <div className="text-xs text-gray-600 bg-blue-50/60 border border-blue-100 rounded-lg px-3 py-1.5 leading-relaxed mb-3">
        <span className="font-medium text-blue-700">查询意图：</span>
        {item.intentSummary || `查询 #${index}`}
        <span className="text-gray-400 ml-1.5">· {item.result.rowCount} 行结果</span>
      </div>

      {/* ── Section 1: SQL 执行 ── */}
      <SectionTitle icon={TerminalSquare} title="SQL 执行" />

      {sqlAnalysis && (
        <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-2 mb-2 animate-in fade-in zoom-in-95 duration-300">
          <ResultChart result={item.result} />
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={() => setShowSql(!showSql)}
          className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
        >
          {showSql ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          <Code2 className="w-3 h-3" />
          <span>SQL</span>
        </button>
        <button
          onClick={() => setShowTable(!showTable)}
          className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
        >
          {showTable ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          <Table2 className="w-3 h-3" />
          <span>数据表</span>
        </button>
      </div>

      {showSql && item.sql && (
        <pre className="mt-2 text-[11px] font-mono text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-2 overflow-x-auto whitespace-pre-wrap max-h-32 overflow-y-auto leading-relaxed">
          {item.sql}
        </pre>
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
          <AnalysisReportCard report={item.analysisReport} result={item.result} sqlChartType={sqlAutoChartType} onQueryClick={onQueryClick} />
        </>
      )}
    </div>
  )
}

function Header({ onCollapse, count }: { onCollapse: () => void; count: number }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 bg-white flex-shrink-0">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-gray-800">数据可视化</span>
        {count > 0 && (
          <span className="text-[11px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">{count}</span>
        )}
      </div>
      <button
        onClick={onCollapse}
        className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        title="收起面板"
      >
        <PanelRightClose className="w-4 h-4" />
      </button>
    </div>
  )
}
