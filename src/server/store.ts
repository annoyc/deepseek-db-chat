import fs from 'node:fs'
import path from 'node:path'
import type { DatabaseConnection, ChatSession } from '@/lib/types'
import { CONNECTIONS_FILE, CHATS_DIR, DATA_DIR } from '@/lib/constants'

function ensureDir(dir: string) {
  const fullPath = path.resolve(process.cwd(), dir)
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true })
  }
}

function resolveFile(filePath: string) {
  return path.resolve(process.cwd(), filePath)
}

export function initDataDir() {
  ensureDir(DATA_DIR)
  ensureDir(CHATS_DIR)
  const connFile = resolveFile(CONNECTIONS_FILE)
  if (!fs.existsSync(connFile)) {
    fs.writeFileSync(connFile, '[]', 'utf-8')
  }
}

export function getConnections(): DatabaseConnection[] {
  initDataDir()
  const raw = fs.readFileSync(resolveFile(CONNECTIONS_FILE), 'utf-8')
  return JSON.parse(raw)
}

export function saveConnections(connections: DatabaseConnection[]) {
  initDataDir()
  fs.writeFileSync(resolveFile(CONNECTIONS_FILE), JSON.stringify(connections, null, 2), 'utf-8')
}

export function addConnection(conn: DatabaseConnection) {
  const connections = getConnections()
  connections.push(conn)
  saveConnections(connections)
  return conn
}

export function removeConnection(id: string) {
  const connections = getConnections().filter((c) => c.id !== id)
  saveConnections(connections)
}

export function getConnectionById(id: string): DatabaseConnection | undefined {
  return getConnections().find((c) => c.id === id)
}

export function getChatSessions(): ChatSession[] {
  initDataDir()
  const dir = resolveFile(CHATS_DIR)
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
  return files
    .map((f) => {
      const raw = fs.readFileSync(path.join(dir, f), 'utf-8')
      return JSON.parse(raw) as ChatSession
    })
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}

export function saveChatSession(session: ChatSession) {
  initDataDir()
  const filePath = path.join(resolveFile(CHATS_DIR), `${session.id}.json`)
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8')
}

export function deleteChatSession(id: string) {
  const filePath = path.join(resolveFile(CHATS_DIR), `${id}.json`)
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
  }
}
