/**
 * Outbound HTTP client for Customer API tests (health, status, delete).
 * Uses fetch with timeout and retries; builds auth headers from encrypted secrets when needed.
 */

import { signHmac } from '../util.js'

export type AuthType = 'HMAC' | 'BEARER' | 'NONE'

export interface CustomerApiConfig {
  baseUrl: string
  healthPath: string
  deletePath: string
  statusPath: string
  authType: AuthType
  /** Plain secret (decrypted) for HMAC */
  sharedSecretPlain?: string | null
  /** Plain token for BEARER */
  bearerTokenPlain?: string | null
  headersJson?: string | null
  timeoutMs: number
  retries: number
  hmacHeaderName: string
  timestampHeaderName: string
}

export interface TestResult {
  ok: boolean
  statusCode: number
  latencyMs: number
  endpoint: string
  message?: string
  responseSample?: string
}

function parseUrl(base: string, path: string): string {
  const b = base.replace(/\/$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  return `${b}${p}`
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal })
    return res
  } finally {
    clearTimeout(t)
  }
}

async function withRetries<T>(
  fn: () => Promise<T>,
  retries: number
): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr
}

function buildAuthHeaders(
  config: CustomerApiConfig,
  method: string,
  url: string,
  body: string
): Record<string, string> {
  const out: Record<string, string> = {}
  const custom = config.headersJson ? (JSON.parse(config.headersJson) as Record<string, string>) : {}
  Object.assign(out, custom)

  if (config.authType === 'BEARER' && config.bearerTokenPlain) {
    out['Authorization'] = `Bearer ${config.bearerTokenPlain}`
  }
  if (config.authType === 'HMAC' && config.sharedSecretPlain) {
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const signature = signHmac(config.sharedSecretPlain, timestamp, body)
    out[config.timestampHeaderName] = timestamp
    out[config.hmacHeaderName] = signature
  }
  return out
}

export async function testHealth(config: CustomerApiConfig): Promise<TestResult> {
  const url = parseUrl(config.baseUrl, config.healthPath)
  const body = ''
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...buildAuthHeaders(config, 'GET', url, body)
  }

  const start = Date.now()
  const run = async (): Promise<Response> => {
    return fetchWithTimeout(
      url,
      { method: 'GET', headers },
      config.timeoutMs
    )
  }

  try {
    const res = await withRetries(run, config.retries)
    const latencyMs = Date.now() - start
    let responseSample: string | undefined
    try {
      const text = await res.text()
      responseSample = text.slice(0, 500)
    } catch {
      // ignore
    }
    return {
      ok: res.ok,
      statusCode: res.status,
      latencyMs,
      endpoint: url,
      message: res.ok ? undefined : `HTTP ${res.status}`,
      responseSample
    }
  } catch (err) {
    const latencyMs = Date.now() - start
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      statusCode: 0,
      latencyMs,
      endpoint: url,
      message: message.slice(0, 200)
    }
  }
}

export async function testStatus(config: CustomerApiConfig): Promise<TestResult> {
  const url = parseUrl(config.baseUrl, config.statusPath)
  const body = JSON.stringify({ requestId: null, source: 'deleteactpro-test' })
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...buildAuthHeaders(config, 'GET', url, body)
  }

  const start = Date.now()
  const run = async (): Promise<Response> => {
    return fetchWithTimeout(
      url,
      { method: 'GET', headers },
      config.timeoutMs
    )
  }

  try {
    const res = await withRetries(run, config.retries)
    const latencyMs = Date.now() - start
    let responseSample: string | undefined
    try {
      responseSample = (await res.text()).slice(0, 500)
    } catch {
      // ignore
    }
    return {
      ok: res.ok,
      statusCode: res.status,
      latencyMs,
      endpoint: url,
      message: res.ok ? undefined : `HTTP ${res.status}`,
      responseSample
    }
  } catch (err) {
    const latencyMs = Date.now() - start
    return {
      ok: false,
      statusCode: 0,
      latencyMs,
      endpoint: url,
      message: err instanceof Error ? err.message : String(err)
    }
  }
}

const TEST_DELETE_PAYLOAD = {
  requestId: 'test-<uuid>',
  subjectHash: '0'.repeat(64),
  mode: 'DRY_RUN',
  source: 'deleteactpro-test'
}

export async function testDelete(
  config: CustomerApiConfig,
  requestId?: string,
  subjectHash?: string
): Promise<TestResult> {
  const url = parseUrl(config.baseUrl, config.deletePath)
  const payload = {
    ...TEST_DELETE_PAYLOAD,
    requestId: requestId ?? `test-${crypto.randomUUID()}`,
    subjectHash: subjectHash ?? '0'.repeat(64)
  }
  const body = JSON.stringify(payload)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...buildAuthHeaders(config, 'POST', url, body)
  }

  const start = Date.now()
  const run = async (): Promise<Response> => {
    return fetchWithTimeout(
      url,
      { method: 'POST', headers, body },
      config.timeoutMs
    )
  }

  try {
    const res = await withRetries(run, config.retries)
    const latencyMs = Date.now() - start
    let responseSample: string | undefined
    try {
      responseSample = (await res.text()).slice(0, 500)
    } catch {
      // ignore
    }
    return {
      ok: res.ok,
      statusCode: res.status,
      latencyMs,
      endpoint: url,
      message: res.ok ? undefined : `HTTP ${res.status}`,
      responseSample
    }
  } catch (err) {
    const latencyMs = Date.now() - start
    return {
      ok: false,
      statusCode: 0,
      latencyMs,
      endpoint: url,
      message: err instanceof Error ? err.message : String(err)
    }
  }
}
