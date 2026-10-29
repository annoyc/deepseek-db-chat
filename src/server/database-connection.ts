import { createHash, X509Certificate } from 'node:crypto'
import type { ConnectionOptions } from 'mysql2/promise'
import type { DatabaseConnection } from '@/lib/types'
import { requiresDatabaseTls, validateDatabaseCa } from '@/lib/database-tls'

function configurationError(code: string): never {
  throw Object.assign(new Error(code), { code })
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '')
}

/** Build both pooled and one-off connections through the same TLS boundary. */
export function databaseConnectionOptions(connection: DatabaseConnection): ConnectionOptions {
  const aiven = requiresDatabaseTls(connection.host)
  if (connection.ssl !== undefined && (!connection.ssl || typeof connection.ssl !== 'object' || Array.isArray(connection.ssl))) {
    configurationError('DATABASE_TLS_INVALID')
  }
  const configuredCa = connection.ssl?.ca
  if (configuredCa !== undefined && typeof configuredCa !== 'string') configurationError('DATABASE_CA_INVALID')
  // Bind the deployment's project CA to its intended host; it is never a global
  // trust override for other databases supplied by visitors.
  const caHost = process.env.DB_SSL_CA_HOST?.trim()
  const presetCa = caHost && normalizeHost(caHost) === normalizeHost(connection.host)
    ? process.env.DB_SSL_CA?.replace(/\\n/g, '\n').trim()
    : undefined
  const ca = configuredCa?.trim() || presetCa
  if (aiven && !ca) configurationError('DATABASE_AIVEN_CA_REQUIRED')
  if (ca) {
    if (validateDatabaseCa(ca)) configurationError('DATABASE_CA_INVALID')
    try {
      for (const block of ca.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? []) {
        new X509Certificate(block)
      }
    } catch { configurationError('DATABASE_CA_INVALID') }
  }
  return {
    host: connection.host.trim().replace(/\.$/, ''),
    port: connection.port,
    user: connection.user,
    password: connection.password,
    database: connection.database,
    connectTimeout: 10_000,
    ...(connection.ssl !== undefined || aiven || presetCa ? {
      ssl: {
        ...(ca ? { ca } : {}),
        rejectUnauthorized: true,
        verifyIdentity: true,
        minVersion: 'TLSv1.2',
      },
    } : {}),
  }
}

export function databaseConnectionFingerprint(connection: DatabaseConnection, options = databaseConnectionOptions(connection)): string {
  return createHash('sha256').update(JSON.stringify(options)).digest('hex')
}

/** Return useful causes while keeping driver messages and credentials on the server. */
export function databaseConnectionError(error: unknown): string {
  const code = (error as { code?: string } | null)?.code ?? ''
  const message = error instanceof Error ? error.message : ''
  if (code === 'DATABASE_AIVEN_CA_REQUIRED') return 'Aiven 连接需要 CA 证书，请由部署者预置，或在连接设置中导入该服务的证书'
  if (code === 'DATABASE_CA_INVALID') return 'CA 证书无效，请从数据库服务控制台重新下载 PEM 证书并导入'
  if (code === 'DATABASE_TLS_INVALID') return 'TLS 连接配置无效，请重新设置安全连接'
  if (code === 'ER_SECURE_TRANSPORT_REQUIRED') return '数据库要求安全连接，请启用 TLS 并检查服务的 CA 证书'
  if (code === 'HANDSHAKE_NO_SSL_SUPPORT') return '数据库服务不支持 TLS，请检查服务端的安全连接配置'
  if (code.startsWith('ERR_TLS_') || /CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code) || /certificate|self.signed/i.test(message)) {
    return '数据库证书校验失败，请确认 CA 证书属于该服务，且主机名与证书匹配'
  }
  if (code === 'HANDSHAKE_SSL_ERROR') return '数据库 TLS 握手失败，请检查 CA 证书、主机名和网络连通性'
  if (['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'PROTOCOL_SEQUENCE_TIMEOUT'].includes(code)) {
    return '连接数据库超时，请确认主机、端口及 IP 访问白名单，并检查部署服务器到数据库的网络'
  }
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) return '无法解析数据库主机，请检查主机地址和部署服务器的 DNS'
  if (code === 'ECONNREFUSED') return '数据库拒绝连接，请检查端口和数据库服务是否运行'
  if (['ECONNRESET', 'PROTOCOL_CONNECTION_LOST'].includes(code)) return '数据库连接被断开，请检查服务状态、网络和 TLS 配置后重试'
  if (['ER_ACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR'].includes(code)) return '数据库认证或授权失败，请检查用户名、密码及该账号的数据库访问权限'
  if (code === 'ER_BAD_DB_ERROR') return '数据库不存在，请检查数据库名'
  return '数据库连接失败，请检查服务状态、连接参数和访问权限'
}
