import { useCallback, useEffect, useRef, useState } from 'react'
import { db } from '@/lib/db'
import { writeSessionChanges, type PersistenceState, type SessionRecord } from '@/lib/session-storage'

export function useSessionPersistence<T extends SessionRecord>(
  tableName: 'chatSessions' | 'knowledgeSessions', sessions: T[], loaded: boolean,
) {
  const [state, setState] = useState<PersistenceState>('loading')
  const previous = useRef<Map<string, T> | null>(null)
  const latest = useRef(sessions)
  const revision = useRef(0)
  const chain = useRef<Promise<void>>(Promise.resolve())
  const mounted = useRef(true)
  latest.current = sessions

  const retrySave = useCallback(() => {
    if (!previous.current) return
    const snapshot = latest.current
    const version = ++revision.current
    setState('saving')
    chain.current = chain.current.then(async () => {
      if (version !== revision.current) return
      const table = db.table<T, string>(tableName)
      try {
        const saved = await db.transaction('rw', table, () => writeSessionChanges(table, previous.current!, snapshot))
        previous.current = saved
        if (mounted.current && version === revision.current && latest.current === snapshot) setState('saved')
      } catch (error) {
        console.warn(`[${tableName}] History save failed`, error)
        if (mounted.current && version === revision.current) setState('error')
      }
    })
  }, [tableName])

  useEffect(() => {
    if (!loaded) return
    if (!previous.current) {
      previous.current = new Map(sessions.map((session) => [session.id, session]))
      setState('saved')
      return
    }
    setState('saving')
    const timer = setTimeout(retrySave, 500)
    return () => clearTimeout(timer)
  }, [loaded, sessions, retrySave])

  useEffect(() => {
    mounted.current = true
    const onHidden = () => { if (document.visibilityState === 'hidden') retrySave() }
    window.addEventListener('pagehide', retrySave)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      window.removeEventListener('pagehide', retrySave)
      document.removeEventListener('visibilitychange', onHidden)
      retrySave()
      mounted.current = false
    }
  }, [retrySave])

  return { persistenceState: loaded ? state : 'loading' as PersistenceState, retrySave }
}
