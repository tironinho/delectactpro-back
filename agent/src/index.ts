/**
 * DROP Compliance Agent — runs in customer environment.
 * Connects to control plane for config/heartbeat/events; connects to local DB for hashing (zero-knowledge).
 * No PII sent to backend; only subject_hash, request ids, status, timestamps.
 */

import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { Pool } from 'pg'
import type { Pool as MysqlPool } from 'mysql2/promise'

const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL || 'http://localhost:4242'
const CONNECTOR_TOKEN = process.env.CONNECTOR_TOKEN || ''
const CONNECTOR_ID = process.env.CONNECTOR_ID || ''
const DB_TYPE = (process.env.DB_TYPE || 'postgres') as 'postgres' | 'mysql'
const DB_URL = process.env.DB_URL || ''
const DRY_RUN = process.env.DRY_RUN !== '0' && process.env.DRY_RUN !== 'false'
const POLL_INTERVAL_HOURS = Number(process.env.POLL_INTERVAL_HOURS || '24')
const DROP_REQUESTS_FILE = process.env.DROP_REQUESTS_FILE || ''

const AGENT_VERSION = '0.1.0'

let dbPool: Pool | MysqlPool | null = null

function getAuthHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${CONNECTOR_TOKEN}`,
    'Content-Type': 'application/json'
  }
}

async function heartbeat(): Promise<void> {
  if (!CONNECTOR_TOKEN || !CONNECTOR_ID) return
  try {
    const res = await fetch(`${CONTROL_PLANE_URL}/api/connector/heartbeat`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        agentVersion: AGENT_VERSION,
        connectorId: CONNECTOR_ID,
        dbType: DB_TYPE
      })
    })
    if (!res.ok) {
      console.error('[heartbeat]', res.status, await res.text())
    }
  } catch (e) {
    console.error('[heartbeat]', e)
  }
}

async function fetchConfig(): Promise<{
  hashRecipe: { delimiter: string | null; fieldsJson: string; normalizationJson: string | null } | null
  schedule: { pollIntervalHours: number; maxDaysWithoutRun: number }
} | null> {
  if (!CONNECTOR_TOKEN) return null
  try {
    const res = await fetch(`${CONTROL_PLANE_URL}/api/connector/config`, {
      headers: getAuthHeaders()
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      hashRecipe: { delimiter: string | null; fieldsJson: string; normalizationJson: string | null } | null
      schedule: { pollIntervalHours: number; maxDaysWithoutRun: number }
    }
    return data
  } catch (e) {
    console.error('[config]', e)
    return null
  }
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

/** Build subject hash from recipe (fields + delimiter + normalization). */
function buildSubjectHash(
  fields: string[],
  delimiter: string,
  normalization: Record<string, string> | null,
  record: Record<string, unknown>
): string {
  const values = fields.map((f) => {
    let v = record[f]
    if (v == null) return ''
    const s = String(v).trim()
    if (normalization && normalization[f] === 'lowercase') return s.toLowerCase()
    return s
  })
  const combined = values.join(delimiter || '|')
  return sha256Hex(combined)
}

async function connectDb(): Promise<boolean> {
  if (dbPool) return true
  if (!DB_URL) {
    console.error('[db] DB_URL not set')
    return false
  }
  try {
    if (DB_TYPE === 'postgres') {
      const { default: pg } = await import('pg')
      dbPool = new pg.Pool({ connectionString: DB_URL })
      await (dbPool as Pool).query('SELECT 1')
    } else if (DB_TYPE === 'mysql') {
      const mysql = await import('mysql2/promise')
      dbPool = mysql.createPool(DB_URL)
      await (dbPool as MysqlPool).query('SELECT 1')
    } else {
      console.error('[db] Unsupported DB_TYPE:', DB_TYPE)
      return false
    }
    console.log('[db] Connected')
    return true
  } catch (e) {
    console.error('[db] Connection failed:', e)
    return false
  }
}

/** Dry-run: load requests from file or demo, compute subject_hash, match locally (by hash column if present), send events. */
async function runDryRun(): Promise<void> {
  const config = await fetchConfig()
  const recipe = config?.hashRecipe
  if (!recipe) {
    console.log('[dry-run] No active hash recipe; skipping')
    return
  }

  let requests: Array<{ requestRef?: string; requestId?: string; subjectHash?: string; identifiers?: Record<string, string> }> = []
  if (DROP_REQUESTS_FILE && existsSync(DROP_REQUESTS_FILE)) {
    try {
      const raw = readFileSync(DROP_REQUESTS_FILE, 'utf-8')
      requests = JSON.parse(raw)
      if (!Array.isArray(requests)) requests = [requests]
    } catch (e) {
      console.error('[dry-run] Failed to read DROP_REQUESTS_FILE:', e)
      return
    }
  } else {
    console.log('[dry-run] No DROP_REQUESTS_FILE; using demo request')
    requests = [{ requestRef: 'demo-1', identifiers: { email: 'demo@example.com' } }]
  }

  const fields = JSON.parse(recipe.fieldsJson) as string[]
  const delimiter = recipe.delimiter || '|'
  const normalization = recipe.normalizationJson ? (JSON.parse(recipe.normalizationJson) as Record<string, string>) : null
  const connected = await connectDb()

  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

  await fetch(`${CONTROL_PLANE_URL}/api/connector/events`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify([{ type: 'RUN_START', runId, runType: 'DRY_RUN' }])
  })

  let matchCount = 0
  for (const req of requests) {
    const requestId = req.requestId ?? req.requestRef ?? `req-${Date.now()}`
    await fetch(`${CONTROL_PLANE_URL}/api/connector/events`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify([{ type: 'DROP_REQUEST_RECEIVED', requestId, requestRef: req.requestRef }])
    })

    let subjectHash = req.subjectHash
    if (!subjectHash && req.identifiers && fields.length) {
      subjectHash = buildSubjectHash(fields, delimiter, normalization, req.identifiers as Record<string, unknown>)
    }
    if (!subjectHash) {
      await fetch(`${CONTROL_PLANE_URL}/api/connector/events`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify([{ type: 'MATCH_RESULT', requestId, matched: false, matchCount: 0 }])
      })
      continue
    }

    let matched = false
    if (connected && dbPool) {
      try {
        const hashTable = process.env.HASH_TABLE || 'subject_hashes'
        const hashColumn = process.env.HASH_COLUMN || 'subject_hash'
        if (DB_TYPE === 'postgres') {
          const rows = await (dbPool as Pool).query(
            `SELECT 1 FROM "${hashTable}" WHERE "${hashColumn}" = $1 LIMIT 1`,
            [subjectHash]
          ).catch(() => ({ rows: [] }))
          matched = Array.isArray(rows.rows) ? rows.rows.length > 0 : false
        } else if (DB_TYPE === 'mysql') {
          const [rows] = await (dbPool as MysqlPool).query(
            `SELECT 1 FROM \`${hashTable}\` WHERE \`${hashColumn}\` = ? LIMIT 1`,
            [subjectHash]
          ).catch(() => [[]]) as [unknown[]]
          matched = Array.isArray(rows) && rows.length > 0
        }
      } catch (e) {
        console.error('[dry-run] Match query error:', e)
      }
    }
    if (matched) matchCount++

    await fetch(`${CONTROL_PLANE_URL}/api/connector/events`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify([{ type: 'MATCH_RESULT', requestId, subjectHash, matched, matchCount: matched ? 1 : 0 }])
    })
  }

  await fetch(`${CONTROL_PLANE_URL}/api/connector/events`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify([
      { type: 'RUN_END', runId, stats: { processed: requests.length, matched: matchCount } },
      { type: 'RUN_STATS', runId, stats: { processed: requests.length, matched: matchCount } }
    ])
  })
  console.log('[dry-run] Done. Processed:', requests.length, 'matched:', matchCount)
}

async function main(): Promise<void> {
  console.log('[agent] Starting. DRY_RUN=', DRY_RUN, 'POLL_INTERVAL_HOURS=', POLL_INTERVAL_HOURS)

  setInterval(heartbeat, 30 * 1000)
  await heartbeat()

  if (DRY_RUN) {
    await runDryRun()
    const intervalMs = POLL_INTERVAL_HOURS * 60 * 60 * 1000
    setInterval(runDryRun, intervalMs)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
