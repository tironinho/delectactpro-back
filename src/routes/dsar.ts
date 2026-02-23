import { Router } from 'express'
import type { DB } from '../db.js'
import { uuid, nowIso, isHex64 } from '../util.js'
import { requireAuth, requireRole } from '../auth.js'
import { dispatchTest } from './cascade.js'

/** App-scoped DSAR: create deletion requests (hashes only); org from JWT. */
export function createDsarRouter(db: DB): Router {
  const router = Router()

  router.get('/requests', requireAuth, (req, res) => {
    const orgId = req.user!.org_id
    const rows = db.prepare(`
      SELECT id, org_id, request_ref, subject_hash, payload_hash, system, status, received_at, created_at
      FROM deletion_requests WHERE org_id = ? ORDER BY created_at DESC LIMIT 200
    `).all(orgId)
    return res.json({ items: rows })
  })

  router.post('/requests', requireAuth, (req, res) => {
    const orgId = req.user!.org_id
    const body = (req.body || {}) as {
      requestRef?: string
      subjectHash?: string
      payloadHash?: string
      system?: string
      receivedAt?: string
      meta?: Record<string, unknown>
    }
    if (!body.subjectHash || !isHex64(body.subjectHash)) {
      return res.status(400).json({ error: 'subjectHash must be a 64-char hex SHA-256 value' })
    }
    if (body.payloadHash && !isHex64(body.payloadHash)) {
      return res.status(400).json({ error: 'payloadHash must be a 64-char hex SHA-256 value' })
    }
    const id = uuid()
    const createdAt = nowIso()
    const receivedAt = body.receivedAt || createdAt
    db.prepare(`
      INSERT INTO deletion_requests (id, org_id, request_ref, subject_hash, payload_hash, system, status, received_at, meta_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'RECEIVED', ?, ?, ?)
    `).run(
      id,
      orgId,
      body.requestRef ?? null,
      body.subjectHash.toLowerCase(),
      body.payloadHash?.toLowerCase() ?? null,
      body.system?.slice(0, 80) ?? 'drop',
      receivedAt,
      body.meta ? JSON.stringify(body.meta).slice(0, 50_000) : null,
      createdAt
    )
    db.prepare(`
      INSERT INTO audit_events (org_id, request_id, ts, type, actor, details_json)
      VALUES (?, ?, ?, 'RECEIVED', ?, ?)
    `).run(orgId, id, createdAt, 'system', JSON.stringify({ requestRef: body.requestRef ?? null, system: body.system ?? 'drop' }))
    return res.json({ id, status: 'RECEIVED' })
  })

  router.get('/requests/:id', requireAuth, (req, res) => {
    const orgId = req.user!.org_id
    const id = req.params.id
    const reqRow = db.prepare(`
      SELECT id, org_id, request_ref, subject_hash, payload_hash, system, status, received_at, meta_json, created_at
      FROM deletion_requests WHERE id = ? AND org_id = ?
    `).get(id, orgId)
    if (!reqRow) return res.status(404).json({ error: 'Not found' })
    const events = db.prepare(`
      SELECT id, request_id, ts, type, actor, details_json
      FROM audit_events WHERE org_id = ? AND request_id = ? ORDER BY id ASC
    `).all(orgId, id)
    const cascades = db.prepare(`
      SELECT cj.*, p.name as partner_name, p.endpoint_url as partner_endpoint
      FROM cascade_jobs cj JOIN partners p ON p.id = cj.partner_id
      WHERE cj.org_id = ? AND cj.request_id = ?
      ORDER BY cj.id ASC
    `).all(orgId, id)
    return res.json({ request: reqRow, events, cascades })
  })

  router.post('/requests/:id/events', requireAuth, (req, res) => {
    const orgId = req.user!.org_id
    const id = req.params.id
    const { type, actor, details } = (req.body || {}) as { type?: string; actor?: string; details?: unknown }
    if (!type || typeof type !== 'string') return res.status(400).json({ error: 'type is required' })
    const reqRow = db.prepare('SELECT id FROM deletion_requests WHERE id = ? AND org_id = ?').get(id, orgId)
    if (!reqRow) return res.status(404).json({ error: 'Not found' })
    db.prepare(`
      INSERT INTO audit_events (org_id, request_id, ts, type, actor, details_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(orgId, id, nowIso(), type.slice(0, 60), actor?.slice(0, 80) ?? req.user!.id, details ? JSON.stringify(details).slice(0, 100_000) : null)
    return res.json({ ok: true })
  })

  router.post('/requests/:id/dispatch-cascade-test', requireAuth, requireRole('OWNER', 'ADMIN'), (req, res) => {
    const orgId = req.user!.org_id
    const requestId = req.params.id
    const reqRow = db.prepare('SELECT id FROM deletion_requests WHERE id = ? AND org_id = ?').get(requestId, orgId)
    if (!reqRow) return res.status(404).json({ error: 'Request not found' })
    const result = dispatchTest(db, orgId, requestId, req.user!.id)
    if (!result.success) {
      return res.status(result.status).json({ error: result.error })
    }
    return res.json({ ok: true, tasksCreated: result.tasksCreated })
  })

  return router
}
