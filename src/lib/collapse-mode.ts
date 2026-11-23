import type { ToolCallInfo } from './types'

export type CollapseMode = 'auto' | 'expanded' | 'collapsed'

export function normalizeCollapseMode(value: unknown, fallback: CollapseMode = 'auto'): CollapseMode {
  if (value === 'auto' || value === 'expanded' || value === 'collapsed') return value
  return fallback
}

/**
 * Resolve whether a thinking block should be expanded under the chosen mode:
 * - `auto`: expanded while actively thinking, collapsed once thinking finishes.
 * - `expanded` / `collapsed`: always follow the fixed preference.
 */
export function resolveThinkingExpanded(mode: CollapseMode, isStreaming: boolean): boolean {
  if (mode === 'expanded') return true
  if (mode === 'collapsed') return false
  return isStreaming
}

/**
 * Resolve whether a tool-call block should be expanded under the chosen mode:
 * - `auto`: collapsed by default, automatically expanded if the tool call fails.
 * - `expanded` / `collapsed`: always follow the fixed preference.
 */
export function resolveToolCallExpanded(mode: CollapseMode, status: ToolCallInfo['status']): boolean {
  if (mode === 'expanded') return true
  if (mode === 'collapsed') return false
  return status === 'error'
}
