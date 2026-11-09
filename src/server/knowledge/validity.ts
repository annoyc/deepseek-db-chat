import type { KbDocumentMeta, KbDocumentStatus } from './types'

/** Calendar date in Beijing time, YYYY-MM-DD: corpus dates are Chinese administrative dates. */
export function beijingDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/**
 * Status is computed per question rather than stored, so an index built today still
 * reports a rule as expired once its validity period ends. A document missing from
 * the corpus may still have repealed one in it; "有效期内" only reflects the dates.
 */
export function documentStatus(meta: Pick<KbDocumentMeta, 'effectiveFrom' | 'effectiveUntil'>, today: string): { status: KbDocumentStatus; label: string } {
  if (meta.effectiveFrom && today < meta.effectiveFrom) return { status: 'pending', label: `尚未施行（${meta.effectiveFrom} 起施行）` }
  if (meta.effectiveUntil && today > meta.effectiveUntil) return { status: 'expired', label: `已过有效期（${meta.effectiveUntil} 到期）` }
  return { status: 'active', label: meta.effectiveUntil ? `有效期内（至 ${meta.effectiveUntil}）` : '有效期内' }
}
