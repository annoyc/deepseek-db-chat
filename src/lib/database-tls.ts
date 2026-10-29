export const MAX_DATABASE_CA_BYTES = 64 * 1024

export function requiresDatabaseTls(host: string): boolean {
  return host.trim().toLowerCase().replace(/\.$/, '').endsWith('.aivencloud.com')
}

/** Validate public CA bundles without exposing Node APIs to the browser. */
export function validateDatabaseCa(ca: string): string | undefined {
  if (new TextEncoder().encode(ca).length > MAX_DATABASE_CA_BYTES) {
    return 'CA 证书不能超过 64 KB'
  }
  const text = ca.trim()
  const blocks = text.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)
  if (!blocks?.length || text.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, '').trim()) {
    return '请导入 PEM 格式的 CA 证书（.pem、.crt 或 .cer）'
  }
  if (blocks.some(block => !/^-----BEGIN CERTIFICATE-----\s+[A-Za-z0-9+/=\s]+\s+-----END CERTIFICATE-----$/.test(block))) {
    return 'CA 证书内容无效，请重新下载并导入 PEM 证书'
  }
}
