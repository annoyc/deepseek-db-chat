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

const SENSITIVE_FIELD = /^(?:password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|phone|mobile|telephone|email|id[_-]?card|identity[_-]?(?:number|card)|bank[_-]?(?:card|account)|身份证(?:号)?|手机号|电话|邮箱|银行卡号)$/i

/** Sanitize structured result data before statistics, classification or logging. */
export function sanitizeModelData(value: unknown, depth = 0): unknown {
  if (depth > 32) return '[已省略深层数据]'
  if (typeof value === 'string') {
    if (/^\s*[\[{]/.test(value)) {
      try { return JSON.stringify(sanitizeModelData(JSON.parse(value), depth + 1)) } catch { /* ordinary text */ }
    }
    return maskPII(value)
  }
  if (typeof value === 'number') {
    const masked = maskPII(String(value))
    return masked === String(value) ? value : masked
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeModelData(item, depth + 1))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_FIELD.test(key) && item != null ? '[已脱敏]' : sanitizeModelData(item, depth + 1),
    ]))
  }
  return value
}

/** Keep tool IDs, names and message roles intact: they are protocol, not data. */
export function sanitizeModelMessages<T>(messages: T[]): T[] {
  return messages.map((message) => {
    if (!message || typeof message !== 'object') return message
    const copy = { ...message } as Record<string, unknown>
    for (const field of ['content', 'reasoning_content']) {
      if (copy[field] != null) copy[field] = sanitizeModelData(copy[field])
    }
    if (Array.isArray(copy.tool_calls)) {
      copy.tool_calls = copy.tool_calls.map((call: Record<string, unknown>) => {
        const fn = call.function as Record<string, unknown> | undefined
        if (!fn || typeof fn.arguments !== 'string') return call
        let args: string
        try { args = JSON.stringify(sanitizeModelData(JSON.parse(fn.arguments))) }
        catch { args = maskPII(fn.arguments) }
        return { ...call, function: { ...fn, arguments: args } }
      })
    }
    return copy as T
  })
}
