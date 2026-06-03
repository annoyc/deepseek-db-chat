import Dexie from 'dexie'
import type { ChatSession, DatabaseConnection } from './types'

type StoredConnection = Omit<DatabaseConnection, 'password'> & { password: string }

interface SettingRecord {
  key: string
  value: unknown
}

class AppDatabase extends Dexie {
  settings!: Dexie.Table<SettingRecord, string>
  chatSessions!: Dexie.Table<ChatSession, string>
  dbConnections!: Dexie.Table<StoredConnection, string>

  constructor() {
    super('deepseek-db-chat')
    this.version(1).stores({
      settings: 'key',
      chatSessions: 'id',
      dbConnections: 'id',
    })
  }
}

export const db = new AppDatabase()
