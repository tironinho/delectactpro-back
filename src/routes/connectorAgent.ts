import { Router } from 'express'
import type { DB } from '../db.js'
import { uuid, nowIso } from '../util.js'
import { requireConnector } from '../middleware/connector.js'

/** Agent-facing routes: heartbeat, events, config. All use requireConnector (Bearer token). */
export function createConnectorAgentRouter(db: DB): Router {
  const router = Router()
  const guard = requireConnector(db)

  router.post('/heartbeat', guard, (req, res) => {
    const { connectorId, orgId } = req.connector!
    const body = (req.body || {}) as { agentVersion?: string; dbType?: string }
    const now = nowIso()
    db.prepare(`
      UPDATE connectors
      SET last_heartbeat_at = ?, agent_version = ?, status = 'ONLINE'
      WHERE id = ? AND org_id = ?
    `).run(now, body.agentVersion ?? null, connectorId, orgId)
    return res.json({ ok: true, receivedAt: now })
  })

  router.post('/events', guard, (req, res) => {
    const { orgId } = req.connector!
    const body = req.body as Array<{
      type: string
      requestId?: string
      requestRef?: string
      subjectHash?: string
      matched?: boolean
      matchCount?: number
      runId?: string
      stats?: Record<string, unknown>
      details?: Record<string, unknown>
    }> | { type: string; [k: string]: unknown }
    const events = Array.isArray(body) ? body : [body]
    const now = nowIso()
    const insertEvent = db.prepare(`
      INSERT INTO audit_events (org_id, request_id, ts, type, actor, details_json)
      VALUES (?, ?, ?, ?, 'agent', ?)
    `)
    for (const ev of events) {
      const requestId = ev.requestId ?? (ev as { requestRef?: string }).requestRef ?? 'system'
      const detailsObj = (ev.details && typeof ev.details === 'object') ? (ev.details as Record<string, unknown>) : {}
      const details: Record<string, unknown> = { ...detailsObj }
      if (ev.subjectHash != null) details.subjectHash = ev.subjectHash
      if (ev.matched !== undefined) details.matched = ev.matched
      if (ev.matchCount !== undefined) details.matchCount = ev.matchCount
      if (ev.runId != null) details.runId = ev.runId
      if (ev.stats != null) details.stats = ev.stats
      insertEvent.run(orgId, requestId, now, String(ev.type).slice(0, 60), JSON.stringify(details).slice(0, 100_000))
    }
    if (events.some((e) => e.type === 'RUN_START')) {
      const runEv = events.find((e) => e.type === 'RUN_START')
      const runId = (runEv as { runId?: string })?.runId ?? uuid()
      const connectorId = req.connector!.connectorId
      db.prepare(`
        INSERT INTO runs (id, org_id, connector_id, type, started_at, ended_at, status, stats_json)
        VALUES (?, ?, ?, ?, ?, NULL, 'RUNNING', NULL)
      `).run(runId, orgId, connectorId, (runEv as { runType?: string })?.runType ?? 'DRY_RUN', now)
    }
    if (events.some((e) => e.type === 'RUN_END' || e.type === 'RUN_STATS')) {
      const endEv = events.find((e) => e.type === 'RUN_END' || e.type === 'RUN_STATS')
      const runId = (endEv as { runId?: string })?.runId
      const stats = (endEv as { stats?: Record<string, unknown> })?.stats
      if (runId) {
        db.prepare(`
          UPDATE runs SET ended_at = ?, status = 'COMPLETED', stats_json = ? WHERE id = ? AND org_id = ?
        `).run(now, stats ? JSON.stringify(stats) : null, runId, orgId)
      }
    }
    return res.json({ ok: true, received: events.length })
  })

  router.get('/config', guard, (req, res) => {
    const { connectorId, orgId } = req.connector!
    const recipe = db.prepare(`
      SELECT id, name, version, delimiter, fields_json, normalization_json
      FROM hash_recipes WHERE org_id = ? AND active = 1 LIMIT 1
    `).get(orgId) as { id: string; name: string; version: number; delimiter: string | null; fields_json: string; normalization_json: string | null } | undefined
    const partners = db.prepare(`
      SELECT p.id, p.name, p.type, p.endpoint_url
      FROM partners p
      JOIN partner_links pl ON pl.partner_id = p.id AND pl.connector_id = ?
      WHERE p.org_id = ? AND p.enabled = 1
    `).all(connectorId, orgId) as Array<{ id: string; name: string; type: string | null; endpoint_url: string }>
    const policies = db.prepare(`
      SELECT id, partner_id, connector_id, mode, retries_max, backoff_minutes, sla_days, attestation_required, escalation_email
      FROM cascade_policies WHERE org_id = ? AND connector_id = ?
    `).all(orgId, connectorId) as Array<{
      id: string; partner_id: string; connector_id: string; mode: string;
      retries_max: number; backoff_minutes: number; sla_days: number | null; attestation_required: number; escalation_email: string | null
    }>
    return res.json({
      hashRecipe: recipe
        ? {
            id: recipe.id,
            name: recipe.name,
            version: recipe.version,
            delimiter: recipe.delimiter,
            fieldsJson: recipe.fields_json,
            normalizationJson: recipe.normalization_json
          }
        : null,
      partners: partners.map((p) => ({ id: p.id, name: p.name, type: p.type, endpointUrl: p.endpoint_url })),
      policies: policies.map((p) => ({
        id: p.id,
        partnerId: p.partner_id,
        connectorId: p.connector_id,
        mode: p.mode,
        retriesMax: p.retries_max,
        backoffMinutes: p.backoff_minutes,
        slaDays: p.sla_days,
        attestationRequired: Boolean(p.attestation_required),
        escalationEmail: p.escalation_email
      })),
      schedule: { pollIntervalHours: 24, maxDaysWithoutRun: 45 }
    })
  })

  return router
}
