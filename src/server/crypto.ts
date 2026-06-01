import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const TAG_LENGTH = 16
const KEY_LENGTH = 32
const KEY_FILE = path.join(process.cwd(), 'data', 'encryption.key')

let _key: Buffer | null = null

function getEncryptionKey(): Buffer {
  if (_key) return _key

  const envKey = process.env.ENCRYPTION_KEY
  if (envKey && envKey.length === KEY_LENGTH * 2) {
    _key = Buffer.from(envKey, 'hex')
    return _key
  }

  // Try to load a persisted key from file
  if (fs.existsSync(KEY_FILE)) {
    try {
      const fileKey = fs.readFileSync(KEY_FILE, 'utf-8').trim()
      if (fileKey.length === KEY_LENGTH * 2) {
        _key = Buffer.from(fileKey, 'hex')
        console.log('[SECURITY] Loaded encryption key from data/encryption.key')
        return _key
      }
    } catch {
      // Fall through to generate new key
    }
  }

  // Auto-generate a key and persist it to file
  _key = crypto.randomBytes(KEY_LENGTH)
  const hexKey = _key.toString('hex')
  try {
    const dataDir = path.dirname(KEY_FILE)
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true })
    }
    fs.writeFileSync(KEY_FILE, hexKey, 'utf-8')
    console.log('[SECURITY] Generated and persisted encryption key to data/encryption.key')
  } catch (err) {
    console.error('[SECURITY] Failed to persist encryption key:', err)
  }
  return _key
}

export function encrypt(plaintext: string): string {
  const key = getEncryptionKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const tag = cipher.getAuthTag()

  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`
}

export function decrypt(encrypted: string): string {
  const key = getEncryptionKey()
  const parts = encrypted.split(':')
  if (parts.length !== 3) {
    // Not in encrypted format — treat as plaintext
    return encrypted
  }

  const [ivHex, tagHex, ciphertext] = parts
  const iv = Buffer.from(ivHex, 'hex')
  const tag = Buffer.from(tagHex, 'hex')

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)

  let decrypted = decipher.update(ciphertext, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}