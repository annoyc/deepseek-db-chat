export interface SessionRecord { id: string }
export interface SessionWriter<T extends SessionRecord> {
  bulkPut: (sessions: T[]) => Promise<unknown>
  bulkDelete: (ids: string[]) => Promise<unknown>
}

/** Only change records owned by this tab; never clear another tab's history. */
export async function writeSessionChanges<T extends SessionRecord>(
  writer: SessionWriter<T>, previous: Map<string, T>, next: T[],
): Promise<Map<string, T>> {
  const ids = new Set(next.map((session) => session.id))
  const removed = [...previous.keys()].filter((id) => !ids.has(id))
  const changed = next.filter((session) => previous.get(session.id) !== session)
  if (changed.length) await writer.bulkPut(changed)
  if (removed.length) await writer.bulkDelete(removed)
  return new Map(next.map((session) => [session.id, session]))
}

export type PersistenceState = 'loading' | 'saving' | 'saved' | 'error' | 'load-error'
