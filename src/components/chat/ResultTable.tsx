import { useState } from 'react'
import type { SqlResultInfo } from '@/lib/types'
import { ResultChart } from './ResultChart'
import { cn } from '@/lib/utils'

interface ResultTableProps {
  result: SqlResultInfo
}

type ViewMode = 'table' | 'chart'

export function ResultTable({ result }: ResultTableProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('table')
  const { columns, rows, rowCount } = result
  const displayRows = rows.slice(0, 100)

  return (
    <div>
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
        <span className="text-xs text-gray-400">{rowCount} 行结果</span>
        <div className="flex items-center rounded-md overflow-hidden border border-gray-200">
          <button
            onClick={() => setViewMode('table')}
            className={cn(
              'px-2.5 py-1 text-xs font-medium transition-colors',
              viewMode === 'table'
                ? 'bg-gray-800 text-white'
                : 'bg-white text-gray-500 hover:bg-gray-50'
            )}
          >
            表格
          </button>
          <button
            onClick={() => setViewMode('chart')}
            className={cn(
              'px-2.5 py-1 text-xs font-medium border-l border-gray-200 transition-colors',
              viewMode === 'chart'
                ? 'bg-gray-800 text-white'
                : 'bg-white text-gray-500 hover:bg-gray-50'
            )}
          >
            图表
          </button>
        </div>
      </div>

      {viewMode === 'table' ? (
        columns.length > 0 && rows.length > 0 ? (
          <div className="overflow-x-auto max-h-80 px-3 py-2">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0">
                <tr>
                  {columns.map((col) => (
                    <th
                      key={col}
                      className="px-3 py-2 text-left font-semibold text-gray-700 border-b-2 border-gray-200 bg-gray-50/80 whitespace-nowrap"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayRows.map((row, idx) => (
                  <tr key={idx} className="hover:bg-gray-50/50 transition-colors">
                    {columns.map((col) => (
                      <td
                        key={col}
                        className="px-3 py-1.5 border-b border-gray-100 text-gray-600 whitespace-nowrap max-w-52 truncate"
                      >
                        {formatCell(row[col])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-3 py-5 text-center text-xs text-gray-400">
            {rowCount === 0 ? '查询成功，无返回数据' : '执行成功'}
          </div>
        )
      ) : (
        <div className="p-3">
          <ResultChart result={result} />
        </div>
      )}

      {viewMode === 'table' && rows.length > 100 && (
        <div className="px-3 py-2 text-center text-xs text-gray-400 border-t border-gray-100">
          显示前 100 行（共 {rowCount} 行）
        </div>
      )}
    </div>
  )
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
