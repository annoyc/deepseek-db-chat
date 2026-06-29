import Dexie from 'dexie'
import type { ChatSession, DatabaseConnection } from './types'
import type { KnowledgeSession } from './knowledge-types'

type StoredConnection = Omit<DatabaseConnection, 'password'> & { password: string }

interface SettingRecord {
  key: string
  value: unknown
}

class AppDatabase extends Dexie {
  settings!: Dexie.Table<SettingRecord, string>
  chatSessions!: Dexie.Table<ChatSession, string>
  knowledgeSessions!: Dexie.Table<KnowledgeSession, string>
  dbConnections!: Dexie.Table<StoredConnection, string>

  constructor() {
    super('deepseek-db-chat')
    this.version(1).stores({
      settings: 'key',
      chatSessions: 'id',
      dbConnections: 'id',
    })
    this.version(2).stores({
      settings: 'key',
      chatSessions: 'id',
      knowledgeSessions: 'id',
      dbConnections: 'id',
    })
  }
}

export const db = new AppDatabase()
