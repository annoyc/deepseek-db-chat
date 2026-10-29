import mysql from 'mysql2'

/** Bound the entire handshake and ping, including stages after mysql2's connect timeout. */
export function probeDatabaseConnection(
  options: import('mysql2').ConnectionOptions,
  timeoutMs = 10_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let connection: mysql.Connection | undefined
    let settled = false

    const finish = (error?: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      try {
        connection?.destroy()
      } catch (destroyError) {
        error ??= destroyError
      }
      if (error !== undefined) reject(error)
      else resolve()
    }

    const deadline = setTimeout(() => {
      finish(Object.assign(new Error('Database connection test timed out'), { code: 'ETIMEDOUT' }))
    }, timeoutMs)

    try {
      // The callback driver returns the connection before authentication completes,
      // so a stalled TLS/auth exchange can still be disposed of at the deadline.
      connection = mysql.createConnection(options)
      // Keep this listener after disposal: late socket errors must remain handled.
      connection.on('error', finish)
      connection.connect((error) => {
        if (settled) return
        if (error) {
          finish(error)
          return
        }
        try {
          connection!.ping((pingError) => finish(pingError ?? undefined))
        } catch (pingError) {
          finish(pingError)
        }
      })
    } catch (error) {
      finish(error)
    }
  })
}
