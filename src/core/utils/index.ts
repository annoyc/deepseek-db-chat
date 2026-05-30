export function compact<T extends Record<string, any>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as T
}

export function omit<T extends Record<string, any>, K extends keyof T>(
  obj: T,
  keys: K[],
): Omit<T, K> {
  const result = { ...obj }
  for (const key of keys) {
    delete result[key]
  }
  return result
}

export function omitBy<T extends Record<string, any>>(
  obj: T,
  predicate: (value: any) => boolean,
): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => !predicate(v)),
  ) as Partial<T>
}

export function toMerged<T extends Record<string, any>>(target: T, source: Record<string, any>): T {
  const result = { ...target }
  for (const key of Object.keys(source)) {
    const sourceVal = source[key]
    const targetVal = (result as any)[key]
    if (
      sourceVal !== null
      && typeof sourceVal === 'object'
      && !Array.isArray(sourceVal)
      && targetVal !== null
      && typeof targetVal === 'object'
      && !Array.isArray(targetVal)
    ) {
      ;(result as any)[key] = toMerged(targetVal, sourceVal)
    }
    else {
      ;(result as any)[key] = sourceVal
    }
  }
  return result
}
