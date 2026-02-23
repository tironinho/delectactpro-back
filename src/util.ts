import crypto from 'node:crypto'

export function uuid(): string {
  return crypto.randomUUID()
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function isHex64(s: string): boolean {
  return /^[a-f0-9]{64}$/i.test(s)
}

/** SHA-256 hash of token for storage (connector_tokens.token_hash). */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex')
}

/** Generate a secure random token (32 bytes = 64 hex chars). */
export function generateConnectorToken(): string {
  return crypto.randomBytes(32).toString('hex')
}
