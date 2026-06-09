import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { SlidersHorizontal, CheckCircle2, Loader2, XCircle, Calendar as CalendarIcon, Send, SkipForward } from 'lucide-react'
import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import type { SmartFilterConfirmInfo, FilterValue } from '@/lib/types'
import { useChatStore } from '@/hooks/useChat'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface SmartFilterConfirmBlockProps {
  info: SmartFilterConfirmInfo
  messageId: string
}

export function SmartFilterConfirmBlock({ info, messageId }: SmartFilterConfirmBlockProps) {
  const { confirmSmartFilter, cancelSmartFilter } = useChatStore()
  const [filterValues, setFilterValues] = useState<Record<number, FilterValue>>({})
  const [countdown, setCountdown] = useState(60)
  const cancelRef = useRef(cancelSmartFilter)
  cancelRef.current = cancelSmartFilter

  const isPending = info.status === 'pending'
  const isConfirmed = info.status === 'confirmed'
  const isDone = info.status === 'done'
  const isCancelled = info.status === 'cancelled'

  // Initialize default values
  useEffect(() => {
    if (!isPending) return
    const defaults: Record<number, FilterValue> = {}
    info.suggestedFilters.forEach((filter, index) => {
      switch (filter.type) {
        case 'date_range': {
          const days = parseRangeDays(filter.defaultRange)
          const now = new Date()
          defaults[index] = {
            dateRange: {
              start: format(new Date(now.getTime() - days * 86400000), 'yyyy-MM-dd'),
              end: format(now, 'yyyy-MM-dd'),
            },
          }
          break
        }
        case 'enum_select':
          defaults[index] = { enumValue: filter.defaultValue ?? '' }
          break
        case 'option_select':
          defaults[index] = { optionValue: filter.defaultValue ?? filter.options?.[0] ?? '' }
          break
        case 'aggregation':
          defaults[index] = { aggregation: filter.defaultValue ?? filter.aggregationOptions?.[0] ?? '' }
          break
      }
    })
    setFilterValues(defaults)
  }, [isPending, info.suggestedFilters])

  // Countdown timer — clears itself immediately when reaching 0 to prevent extra ticks
  useEffect(() => {
    if (!isPending) return
    setCountdown(60)
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval)
          cancelRef.current(messageId)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [isPending, messageId])

  const handleValueChange = useCallback((index: number, value: Partial<FilterValue>) => {
    setFilterValues((prev) => ({
      ...prev,
      [index]: { ...prev[index], ...value },
    }))
  }, [])

  const handleConfirm = useCallback(() => {
    confirmSmartFilter(messageId, filterValues)
  }, [confirmSmartFilter, messageId, filterValues])

  const handleCancel = useCallback(() => {
    cancelSmartFilter(messageId)
  }, [cancelSmartFilter, messageId])

  if (!info.suggestedFilters.length) return null

  return (
    <div className={cn(
      'border rounded-xl overflow-hidden bg-white',
      isCancelled ? 'border-gray-300' : isConfirmed ? 'border-green-400' : 'border-gray-700',
    )}>
      {/* Header */}
      <div className={cn(
        'flex items-center gap-1.5 px-3 py-2 border-b',
        isCancelled ? 'border-gray-200' : isConfirmed ? 'border-green-200' : 'border-gray-300',
      )}>
        {isDone ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
        ) : isConfirmed ? (
          <Loader2 className="w-3.5 h-3.5 text-green-600 flex-shrink-0 animate-spin" />
        ) : isCancelled ? (
          <XCircle className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
        ) : (
          <SlidersHorizontal className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
        )}
        <span className="text-[13px] font-semibold text-gray-800">查询参数微调</span>
        {isPending && <span className="text-xs text-gray-400 ml-0.5">待确认 ({countdown}s)</span>}
        {isConfirmed && <span className="text-xs text-green-600 ml-0.5 font-medium">处理中...</span>}
        {isDone && (
          <span className="text-xs bg-green-600 text-white px-1.5 py-px rounded-full font-medium ml-0.5">
            已确认
          </span>
        )}
        {isCancelled && <span className="text-xs text-gray-400 ml-0.5">已跳过</span>}
      </div>

      {/* Filter controls */}
      <div className="px-3 py-2.5 space-y-0.5">
        {info.suggestedFilters.map((filter, index) => (
          <FilterControlRow
            key={`${filter.type}-${filter.table}-${filter.column}`}
            filter={filter}
            index={index}
            value={filterValues[index]}
            onChange={(value) => handleValueChange(index, value)}
            disabled={!isPending}
          />
        ))}
      </div>

      {/* Actions */}
      {isPending && (
        <div className="flex items-center gap-2 px-3 py-2.5 border-t border-gray-300 bg-gray-50/50">
          <Button onClick={handleConfirm} size="sm" className="h-7 text-xs px-3">
            <Send className="size-3 mr-1" />
            确认筛选
          </Button>
          <Button onClick={handleCancel} variant="outline" size="sm" className="h-7 text-xs px-3">
            <SkipForward className="size-3 mr-1" />
            跳过筛选
          </Button>
          <span className="text-[11px] text-muted-foreground ml-1">
            可调整参数后确认，或直接跳过
          </span>
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────
//  Individual filter control row
// ────────────────────────────────────────────────────────────

const filterTypeLabels: Record<string, string> = {
  date_range: '日期',
  enum_select: '筛选',
  option_select: '选择',
  aggregation: '聚合',
}

interface FilterControlRowProps {
  filter: SmartFilterConfirmInfo['suggestedFilters'][number]
  index: number
  value?: FilterValue
  onChange: (value: Partial<FilterValue>) => void
  disabled: boolean
}

function FilterControlRow({ filter, value, onChange, disabled }: FilterControlRowProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] px-1.5 py-0.5 flex-shrink-0 rounded-full bg-secondary text-secondary-foreground font-medium">
        {filterTypeLabels[filter.type] ?? filter.type}
      </span>
      <div className="flex-1 min-w-0">
        {filter.type === 'date_range' && (
          <DateRangeControl
            label={filter.label}
            dateMin={filter.dateMin}
            dateMax={filter.dateMax}
            defaultRange={filter.defaultRange}
            value={value?.dateRange}
            onChange={(dateRange) => onChange({ dateRange })}
            disabled={disabled}
          />
        )}
        {filter.type === 'enum_select' && (
          <EnumSelectControl
            label={filter.label}
            enumValues={filter.enumValues ?? []}
            value={value?.enumValue}
            onChange={(enumValue) => onChange({ enumValue })}
            disabled={disabled}
          />
        )}
        {filter.type === 'option_select' && (
          <OptionSelectControl
            label={filter.label}
            options={filter.options ?? []}
            value={value?.optionValue}
            onChange={(optionValue) => onChange({ optionValue })}
            disabled={disabled}
          />
        )}
        {filter.type === 'aggregation' && (
          <AggregationControl
            label={filter.label}
            options={filter.aggregationOptions ?? ['按日', '按周', '按月']}
            value={value?.aggregation}
            onChange={(aggregation) => onChange({ aggregation })}
            disabled={disabled}
          />
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
//  Date range control — dual calendar + quick picks
// ────────────────────────────────────────────────────────────

const quickOptions = [
  { range: '7d', label: '近7天' },
  { range: '30d', label: '近30天' },
  { range: '90d', label: '近90天' },
  { range: '1y', label: '近1年' },
]

function parseRangeDays(range?: string): number {
  const daysMap: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 }
  return daysMap[range ?? '7d'] ?? 7
}

interface DateRangeControlProps {
  label: string
  dateMin?: string
  dateMax?: string
  defaultRange?: string
  value?: { start: string; end: string }
  onChange: (value: { start: string; end: string }) => void
  disabled: boolean
}

function DateRangeControl({ label, value, onChange, disabled }: DateRangeControlProps) {
  const [startDate, setStartDate] = useState<Date>(value ? new Date(value.start) : new Date())
  const [endDate, setEndDate] = useState<Date>(value ? new Date(value.end) : new Date())
  const [openStart, setOpenStart] = useState(false)
  const [openEnd, setOpenEnd] = useState(false)

  useEffect(() => {
    if (value) {
      setStartDate(new Date(value.start))
      setEndDate(new Date(value.end))
    }
  }, [value?.start, value?.end])

  const handleStartSelect = useCallback(
    (date: Date | undefined) => {
      if (!date) return
      setStartDate(date)
      setOpenStart(false)
      const end = date > endDate ? date : endDate
      setEndDate(end)
      onChange({ start: format(date, 'yyyy-MM-dd'), end: format(end, 'yyyy-MM-dd') })
    },
    [endDate, onChange],
  )

  const handleEndSelect = useCallback(
    (date: Date | undefined) => {
      if (!date) return
      setEndDate(date)
      setOpenEnd(false)
      const start = date < startDate ? date : startDate
      setStartDate(start)
      onChange({ start: format(start, 'yyyy-MM-dd'), end: format(date, 'yyyy-MM-dd') })
    },
    [startDate, onChange],
  )

  const handleQuickPick = useCallback(
    (range: string) => {
      const now = new Date()
      const days = parseRangeDays(range)
      const start = new Date(now.getTime() - days * 86400000)
      setStartDate(start)
      setEndDate(now)
      onChange({ start: format(start, 'yyyy-MM-dd'), end: format(now, 'yyyy-MM-dd') })
    },
    [onChange],
  )

  const formattedStart = useMemo(() => format(startDate, 'M月d日', { locale: zhCN }), [startDate])
  const formattedEnd = useMemo(() => format(endDate, 'M月d日', { locale: zhCN }), [endDate])

  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="text-xs font-medium text-muted-foreground min-w-[60px]">{label}</span>
      <div className="flex items-center gap-1.5">
        <Popover open={openStart} onOpenChange={setOpenStart}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="xs" className="font-normal text-[11px]" disabled={disabled}>
              <CalendarIcon className="size-3 mr-1" />
              {formattedStart}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar mode="single" selected={startDate} onSelect={handleStartSelect} captionLayout="dropdown" />
          </PopoverContent>
        </Popover>

        <span className="text-xs text-muted-foreground">~</span>

        <Popover open={openEnd} onOpenChange={setOpenEnd}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="xs" className="font-normal text-[11px]" disabled={disabled}>
              <CalendarIcon className="size-3 mr-1" />
              {formattedEnd}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar mode="single" selected={endDate} onSelect={handleEndSelect} captionLayout="dropdown" />
          </PopoverContent>
        </Popover>
      </div>

      {!disabled && (
        <div className="flex items-center gap-1 ml-1">
          {quickOptions.map((opt) => (
            <button
              key={opt.range}
              onClick={() => handleQuickPick(opt.range)}
              className={cn(
                'text-[10px] px-1.5 py-0.5 rounded-md transition-colors',
                'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────
//  Enum select control
// ────────────────────────────────────────────────────────────

interface EnumSelectControlProps {
  label: string
  enumValues: string[]
  value?: string
  onChange: (value: string) => void
  disabled: boolean
}

function EnumSelectControl({ label, enumValues, value, onChange, disabled }: EnumSelectControlProps) {
  const currentValue = value ?? ''

  const handleChange = (val: string) => {
    onChange(val === '__all__' ? '' : val)
  }

  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="text-xs font-medium text-muted-foreground min-w-[60px]">{label}</span>
      <Select value={currentValue || '__all__'} onValueChange={handleChange} disabled={disabled}>
        <SelectTrigger size="sm" className="text-xs min-w-[120px]">
          <SelectValue placeholder="全部" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">全部</SelectItem>
          {enumValues.map((v) => (
            <SelectItem key={v} value={v}>
              {v}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
//  Option select control (model-provided options, no DB query)
// ────────────────────────────────────────────────────────────

interface OptionSelectControlProps {
  label: string
  options: string[]
  value?: string
  onChange: (value: string) => void
  disabled: boolean
}

function OptionSelectControl({ label, options, value, onChange, disabled }: OptionSelectControlProps) {
  const currentValue = value ?? options[0] ?? ''

  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="text-xs font-medium text-muted-foreground min-w-[60px]">{label}</span>
      <Select value={currentValue} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger size="sm" className="text-xs min-w-[120px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
//  Aggregation control
// ────────────────────────────────────────────────────────────

interface AggregationControlProps {
  label: string
  options: string[]
  value?: string
  onChange: (value: string) => void
  disabled: boolean
}

function AggregationControl({ label, options, value, onChange, disabled }: AggregationControlProps) {
  const currentValue = value ?? options[0] ?? ''

  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="text-xs font-medium text-muted-foreground min-w-[60px]">{label}</span>
      <Select value={currentValue} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger size="sm" className="text-xs min-w-[100px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
