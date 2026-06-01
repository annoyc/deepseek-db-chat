import { createServerFn } from '@tanstack/react-start'
import fs from 'fs'
import path from 'path'
import { testConnection } from '@/server/database'
import { decrypt } from '@/server/crypto'
import type { DatabaseConnection } from '@/lib/types'

const CONNECTIONS_FILE = path.join(process.cwd(), 'data', 'connections.json')

export const testConnectionFn = createServerFn({ method: 'POST' })
  .inputValidator((data: DatabaseConnection) => data)
  .handler(
    async ({ data }): Promise<{ success: boolean; error?: string }> => {
      const decryptedConn: DatabaseConnection = {
        ...data,
        password: decrypt(data.password),
      }
      return testConnection(decryptedConn)
    }
  )

export const migrateConnections = createServerFn({ method: 'POST' }).handler(
  async (): Promise<DatabaseConnection[]> => {
    if (!fs.existsSync(CONNECTIONS_FILE)) return []
    try {
      const raw = fs.readFileSync(CONNECTIONS_FILE, 'utf-8')
      const connections: DatabaseConnection[] = JSON.parse(raw)
      // Delete the old file after successful migration
      fs.unlinkSync(CONNECTIONS_FILE)
      return connections
    } catch {
      return []
    }
  }
)