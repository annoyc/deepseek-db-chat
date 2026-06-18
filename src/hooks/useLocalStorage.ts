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
        // IndexedDB 无数据时尝试从旧版 localStorage 迁移
        try {
          const raw = window.localStorage.getItem(key)
          if (raw !== null) {
            const value = JSON.parse(raw) as T
            setStoredValue(value)
            db.settings.put({ key, value }).catch((err) => console.warn('[useLocalStorage] Migration write failed:', err))
          }
        } catch (err) { console.warn('[useLocalStorage] localStorage migration failed:', err) }
      }
    }).catch((err) => console.warn('[useLocalStorage] IndexedDB read failed:', err))
    return () => { cancelled = true }
  }, [key])

  const setValue = useCallback((value: T | ((val: T) => T)) => {
    setStoredValue((prev) => {
      const valueToStore = value instanceof Function ? value(prev) : value
      db.settings.put({ key, value: valueToStore }).catch((err) => console.warn('[useLocalStorage] IndexedDB write failed:', err))
      return valueToStore
    })
  }, [key])

  const removeValue = useCallback(() => {
    db.settings.delete(key).catch((err) => console.warn('[useLocalStorage] IndexedDB delete failed:', err))
    setStoredValue(initialValue)
  }, [key, initialValue])

  return [storedValue, setValue, removeValue] as const
}
