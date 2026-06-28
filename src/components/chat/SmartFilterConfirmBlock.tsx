import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { SlidersHorizontal, CheckCircle2, Loader2, XCircle, Calendar as CalendarIcon, Send, SkipForward, ChevronsUpDown, Check, PencilLine, RotateCcw } from 'lucide-react'
import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import type { SmartFilterConfirmInfo, FilterValue } from '@/lib/types'
import { useChatStore } from '@/hooks/useChat'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from '@/components/ui/command'

interface SmartFilterConfirmBlockProps {
  info: SmartFilterConfirmInfo
  messageId: string
}

export function SmartFilterConfirmBlock({ info, messageId }: SmartFilterConfirmBlockProps) {
  const { confirmSmartFilter, cancelSmartFilter, reviseSmartFilter } = useChatStore()
  const [filterValues, setFilterValues] = useState<Record<number, FilterValue>>({})
  const [countdown, setCountdown] = useState(60)
  const [feedback, setFeedback] = useState('')
  const feedbackInputRef = useRef<HTMLTextAreaElement>(null)
  const cancelRef = useRef(cancelSmartFilter)
  cancelRef.current = cancelSmartFilter

  const isLoading = info.status === 'loading'
  const isPending = info.status === 'pending'
  const isConfirmed = info.status === 'confirmed'
  const isDone = info.status === 'done'
  const isCancelled = info.status === 'cancelled'
  const isRevised = info.status === 'revised'

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

  const handleSubmitFeedback = useCallback(() => {
    const text = feedback.trim()
    if (!text) return
    reviseSmartFilter(messageId, text)
  }, [reviseSmartFilter, messageId, feedback])

  const handleFeedbackKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmitFeedback()
    }
  }, [handleSubmitFeedback])

  if (isLoading) {
    return (
      <div className="border border-gray-200 rounded-xl overflow-hidden bg-white animate-in fade-in slide-in-from-bottom-2 duration-300">
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-gray-100">
          <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin flex-shrink-0" />
          <span className="text-[13px] font-semibold text-gray-800">查询参数微调</span>
          <span className="text-xs text-gray-400 ml-0.5">分析中...</span>
        </div>
        <div className="px-3 py-2.5 space-y-2">
          <div className="h-6 bg-gray-50 border border-gray-200 rounded-lg animate-pulse" />
          <div className="h-6 bg-gray-50 border border-gray-200 rounded-lg animate-pulse w-3/4" />
        </div>
      </div>
    )
  }

  if (!info.suggestedFilters.length) return null

  return (
    <div className={cn(
      'border rounded-xl overflow-hidden bg-white animate-in fade-in slide-in-from-bottom-2 duration-300',
      isCancelled ? 'border-gray-200' : isConfirmed ? 'border-green-300' : 'border-gray-200',
    )}>
      {/* Header */}
      <div className={cn(
        'flex items-center gap-1.5 px-3 py-2 border-b',
        isCancelled ? 'border-gray-100' : isConfirmed ? 'border-green-100' : 'border-gray-100',
      )}>
        {isDone ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
        ) : isConfirmed ? (
          <Loader2 className="w-3.5 h-3.5 text-green-600 flex-shrink-0 animate-spin" />
        ) : isRevised ? (
          <RotateCcw className="w-3.5 h-3.5 text-primary flex-shrink-0" />
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
        {isRevised && (
          <span className="text-xs bg-primary text-white px-1.5 py-px rounded-full font-medium ml-0.5">
            已修改
          </span>
        )}
      </div>

      {/* Filter controls */}
      <div className="px-3 py-2.5 space-y-0.5">
        {info.suggestedFilters.map((filter, index) => (
          <FilterControlRow
            key={`${index}-${filter.type}-${filter.table}-${filter.column}`}
            filter={filter}
            index={index}
            value={filterValues[index]}
            onChange={(value) => handleValueChange(index, value)}
            disabled={!isPending}
          />
        ))}
      </div>

      {/* Revision feedback display */}
      {isRevised && info.revisionFeedback && (
        <div className="px-3 pb-2.5">
          <div className="text-xs text-primary bg-primary/5 border border-primary/15 rounded-lg px-3 py-2">
            <span className="font-medium">修改建议：</span>{info.revisionFeedback}
          </div>
        </div>
      )}

      {/* Actions */}
      {isPending && (
        <div className="border-t border-gray-100">
          <div className="px-3 pt-2.5 pb-2">
            <div className="relative">
              <textarea
                ref={feedbackInputRef}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                onKeyDown={handleFeedbackKeyDown}
                placeholder="对筛选不满意？输入修改建议，如：增加按地区筛选、去掉时间范围、改为按周统计..."
                className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 pr-9 resize-none bg-gray-50/50 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/50 leading-relaxed transition-colors"
                rows={1}
              />
              {feedback.trim() && (
                <button
                  onClick={handleSubmitFeedback}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-primary hover:bg-primary/10 transition-colors"
                  title="提交修改建议 (Enter)"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 px-3 py-2 border-t border-gray-50 bg-gray-50/30">
            {feedback.trim() ? (
              <Button onClick={handleSubmitFeedback} size="sm" className="h-7 text-xs px-3">
                <RotateCcw className="size-3 mr-1" />
                按建议重新生成
              </Button>
            ) : (
              <Button onClick={handleConfirm} size="sm" className="h-7 text-xs px-3">
                <Send className="size-3 mr-1" />
                确认筛选
              </Button>
            )}
            <Button onClick={handleCancel} variant="outline" size="sm" className="h-7 text-xs px-3">
              <SkipForward className="size-3 mr-1" />
              跳过筛选
            </Button>
            {!feedback.trim() && (
              <span className="text-[11px] text-muted-foreground ml-1">
                可调整参数后确认，或直接跳过
              </span>
            )}
          </div>
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
          <FilterCombobox
            label={filter.label}
            options={filter.enumValues ?? []}
            value={value?.enumValue}
            onChange={(enumValue) => onChange({ enumValue })}
            disabled={disabled}
            allowAll
            placeholder="搜索筛选值..."
          />
        )}
        {filter.type === 'option_select' && (
          <FilterCombobox
            label={filter.label}
            options={filter.options ?? []}
            value={value?.optionValue}
            onChange={(optionValue) => onChange({ optionValue })}
            disabled={disabled}
            placeholder="搜索或输入..."
          />
        )}
        {filter.type === 'aggregation' && (
          <FilterCombobox
            label={filter.label}
            options={filter.aggregationOptions ?? ['按日', '按周', '按月']}
            value={value?.aggregation}
            onChange={(aggregation) => onChange({ aggregation })}
            disabled={disabled}
            placeholder="搜索聚合方式..."
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

  const formatDate = useCallback((date: Date) => {
    const now = new Date()
    return date.getFullYear() === now.getFullYear()
      ? format(date, 'M月d日', { locale: zhCN })
      : format(date, 'yyyy年M月d日', { locale: zhCN })
  }, [])
  const formattedStart = useMemo(() => formatDate(startDate), [startDate, formatDate])
  const formattedEnd = useMemo(() => formatDate(endDate), [endDate, formatDate])

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
            <Calendar key={startDate.toISOString()} mode="single" selected={startDate} onSelect={handleStartSelect} defaultMonth={startDate} captionLayout="dropdown" />
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
            <Calendar key={endDate.toISOString()} mode="single" selected={endDate} onSelect={handleEndSelect} defaultMonth={endDate} captionLayout="dropdown" />
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
//  FilterCombobox — searchable dropdown with custom input
// ────────────────────────────────────────────────────────────

interface FilterComboboxProps {
  label: string
  options: string[]
  value?: string
  onChange: (value: string) => void
  disabled: boolean
  allowAll?: boolean
  placeholder?: string
}

function FilterCombobox({ label, options, value, onChange, disabled, allowAll, placeholder }: FilterComboboxProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const isCustomValue = !!(value && value !== '' && !options.includes(value))

  const showCustomOption = search.trim() !== '' && !options.some(
    (opt) => opt.toLowerCase() === search.trim().toLowerCase(),
  )

  const displayValue = value || (allowAll ? '全部' : placeholder ?? '选择...')

  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="text-xs font-medium text-muted-foreground min-w-[60px]">{label}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="xs"
            disabled={disabled}
            className={cn(
              'font-normal text-[11px] justify-between gap-1 min-w-[120px] max-w-[200px]',
              !value && allowAll && 'text-muted-foreground',
            )}
          >
            <span className="truncate">{displayValue}</span>
            <ChevronsUpDown className="size-3 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[220px] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={placeholder ?? '搜索或输入...'}
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              <CommandEmpty className="py-3 text-center text-xs text-muted-foreground">
                无匹配选项，可直接输入自定义值
              </CommandEmpty>
              <CommandGroup>
                {allowAll && (
                  <CommandItem
                    onSelect={() => { onChange(''); setOpen(false); setSearch('') }}
                  >
                    <Check className={cn('size-3 mr-1.5', !value ? 'opacity-100' : 'opacity-0')} />
                    全部
                  </CommandItem>
                )}
                {options
                  .filter((opt) => !search || opt.toLowerCase().includes(search.toLowerCase()))
                  .map((opt) => (
                    <CommandItem
                      key={opt}
                      value={opt}
                      onSelect={() => { onChange(opt); setOpen(false); setSearch('') }}
                    >
                      <Check className={cn('size-3 mr-1.5', value === opt ? 'opacity-100' : 'opacity-0')} />
                      <span className="truncate">{opt}</span>
                    </CommandItem>
                  ))}
              </CommandGroup>
              {showCustomOption && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading="自定义">
                    <CommandItem
                      onSelect={() => { onChange(search.trim()); setOpen(false); setSearch('') }}
                    >
                      <PencilLine className="size-3 mr-1.5 text-primary" />
                      <span className="text-primary">使用: {search.trim()}</span>
                    </CommandItem>
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {isCustomValue && !disabled && (
        <span className="text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded font-medium">
          自定义
        </span>
      )}
    </div>
  )
}
