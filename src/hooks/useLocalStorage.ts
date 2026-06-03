import { useState, useCallback, useEffect } from 'react'
import { db } from '@/lib/db'

export function useLocalStorage<T>(key: string, initialValue: T) {
  const [storedValue, setStoredValue] = useState<T>(initialValue)

  useEffect(() => {
    let cancelled = false
    db.settings.get(key).then((record) => {
      if (cancelled) return
      if (record !== undefined) {
        setStoredValue(record.value as T)
      } else {
        // IndexedDB 无数据时尝试从 localStorage 恢复
        try {
          const raw = window.localStorage.getItem(key)
          if (raw !== null) {
            const value = JSON.parse(raw) as T
            setStoredValue(value)
            db.settings.put({ key, value }).catch(() => {})
          }
        } catch { /* ignore */ }
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [key])

  const setValue = useCallback((value: T | ((val: T) => T)) => {
    setStoredValue((prev) => {
      const valueToStore = value instanceof Function ? value(prev) : value
      db.settings.put({ key, value: valueToStore }).catch(() => {})
      return valueToStore
    })
  }, [key])

  const removeValue = useCallback(() => {
    db.settings.delete(key).catch(() => {})
    setStoredValue(initialValue)
  }, [key, initialValue])

  return [storedValue, setValue, removeValue] as const
}
