interface MaskRule {
  name: string
  pattern: RegExp
  replacer: (match: string, ...groups: string[]) => string
}

const MASK_RULES: MaskRule[] = [
  {
    name: 'idCard18',
    pattern: /\b(\d{6})\d{8}(\d{3}[\dXx])\b/g,
    replacer: (_m, prefix, suffix) => `${prefix}********${suffix}`,
  },
  {
    name: 'idCard15',
    pattern: /\b(\d{6})\d{6}(\d{3})\b/g,
    replacer: (_m, prefix, suffix) => `${prefix}******${suffix}`,
  },
  {
    name: 'bankCard',
    pattern: /\b(\d{4})\d{8,11}(\d{4})\b/g,
    replacer: (_m, prefix, suffix) => `${prefix}${'*'.repeat(8)}${suffix}`,
  },
  {
    name: 'phone',
    pattern: /\b(1[3-9]\d)\d{4}(\d{4})\b/g,
    replacer: (_m, prefix, suffix) => `${prefix}****${suffix}`,
  },
  {
    name: 'email',
    pattern: /\b([a-zA-Z0-9._%+-])([a-zA-Z0-9._%+-]*)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g,
    replacer: (_m, first, _rest, domain) => `${first}***@${domain}`,
  },
]

const rulesByName = new Map(MASK_RULES.map((r) => [r.name, r]))

function getRule(name: string): MaskRule {
  const rule = rulesByName.get(name)
  if (!rule) throw new Error(`Unknown mask rule: ${name}`)
  return rule
}

/**
 * Mask PII patterns in a text string.
 * Rules are applied in priority order (ID card > bank card > phone > email)
 * to prevent shorter patterns from matching substrings of longer ones.
 *
 * Uses a placeholder strategy: longer patterns are replaced with placeholders
 * first, then shorter patterns run on the remaining text, and finally
 * placeholders are restored.
 */
export function maskPII(text: string): string {
  if (!text || text === 'NULL') return text

  const placeholders: string[] = []

  function stash(masked: string): string {
    const idx = placeholders.length
    placeholders.push(masked)
    return `\x00PH${idx}\x00`
  }

  function applyRule(source: string, name: string): string {
    const rule = getRule(name)
    return source.replace(rule.pattern, (...args) =>
      stash(rule.replacer(...(args as [string, ...string[]]))),
    )
  }

  let result = text

  result = applyRule(result, 'idCard18')
  result = applyRule(result, 'idCard15')
  result = applyRule(result, 'bankCard')
  result = applyRule(result, 'phone')
  result = applyRule(result, 'email')

  result = result.replace(/\x00PH(\d+)\x00/g, (_m, idx) => placeholders[Number(idx)])

  return result
}
