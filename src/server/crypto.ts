import crypto from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const KEY_LENGTH = 32

function getEncryptionKey(): Buffer {
  const envKey = process.env.ENCRYPTION_KEY
  if (!envKey || envKey.length !== KEY_LENGTH * 2) {
    throw new Error('[crypto] ENCRYPTION_KEY env var is missing or invalid (must be 64 hex chars)')
  }
  return Buffer.from(envKey, 'hex')
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
  const parts = encrypted.split(':')
  if (parts.length !== 3 || !/^[0-9a-f]{32}$/i.test(parts[0]) || !/^[0-9a-f]{32}$/i.test(parts[1])) {
    return encrypted
  }

  try {
    const key = getEncryptionKey()
    const [ivHex, tagHex, ciphertext] = parts
    const iv = Buffer.from(ivHex, 'hex')
    const tag = Buffer.from(tagHex, 'hex')

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(tag)
    let decrypted = decipher.update(ciphertext, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    return decrypted
  } catch {
    return ''
  }
}