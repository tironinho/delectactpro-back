import { Router } from 'express'
import type { DB } from '../db.js'
import { nowIso } from '../util.js'
import { requireAuth } from '../auth.js'

export function createAuditRouter(db: DB): Router {
  const router = Router()

  router.get('/', requireAuth, (req, res) => {
    const orgId = req.user!.org_id
    const requestId = req.query.requestId as string | undefined
    if (!requestId) {
      return res.status(400).json({ error: 'requestId query is required' })
    }
    const reqRow = db.prepare('SELECT id FROM deletion_requests WHERE id = ? AND org_id = ?').get(requestId, orgId)
    if (!reqRow) {
      return res.status(404).json({ error: 'Request not found' })
    }
    const rows = db.prepare(`
      SELECT id, org_id, request_id, ts, type, actor, details_json
      FROM audit_events WHERE org_id = ? AND request_id = ? ORDER BY id ASC
    `).all(orgId, requestId) as Array<{
      id: number; org_id: string; request_id: string; ts: string; type: string; actor: string | null; details_json: string | null
    }>
    return res.json({
      items: rows.map((r) => ({
        id: r.id,
        requestId: r.request_id,
        ts: r.ts,
        type: r.type,
        actor: r.actor,
        detailsJson: r.details_json ? JSON.parse(r.details_json) : null
      }))
    })
  })

  router.get('/requests/:id/export', requireAuth, (req, res) => {
    const orgId = req.user!.org_id
    const id = req.params.id
    const reqRow = db.prepare(`
      SELECT id, org_id, request_ref, subject_hash, payload_hash, system, status, received_at, meta_json, created_at
      FROM deletion_requests WHERE id = ? AND org_id = ?
    `).get(id, orgId) as {
      id: string; org_id: string; request_ref: string | null; subject_hash: string; payload_hash: string | null;
      system: string | null; status: string; received_at: string | null; meta_json: string | null; created_at: string
    } | undefined
    if (!reqRow) return res.status(404).json({ error: 'Not found' })

    const events = db.prepare(`
      SELECT id, request_id, ts, type, actor, details_json
      FROM audit_events WHERE org_id = ? AND request_id = ? ORDER BY id ASC
    `).all(orgId, id) as Array<{ id: number; request_id: string; ts: string; type: string; actor: string | null; details_json: string | null }>

    const cascades = db.prepare(`
      SELECT cj.id, cj.request_id, cj.partner_id, cj.connector_id, cj.status, cj.attempts, cj.last_error, cj.updated_at,
             p.name as partner_name, p.endpoint_url as partner_endpoint
      FROM cascade_jobs cj
      JOIN partners p ON p.id = cj.partner_id
      WHERE cj.org_id = ? AND cj.request_id = ?
      ORDER BY cj.id ASC
    `).all(orgId, id) as Array<{
      id: string; request_id: string; partner_id: string; connector_id: string; status: string; attempts: number; last_error: string | null; updated_at: string; partner_name: string; partner_endpoint: string
    }>

    return res.json({
      exportVersion: 1,
      exportedAt: nowIso(),
      request: {
        id: reqRow.id,
        requestRef: reqRow.request_ref,
        subjectHash: reqRow.subject_hash,
        payloadHash: reqRow.payload_hash,
        system: reqRow.system,
        status: reqRow.status,
        receivedAt: reqRow.received_at,
        metaJson: reqRow.meta_json ? JSON.parse(reqRow.meta_json) : null,
        createdAt: reqRow.created_at
      },
      events: events.map((e) => ({
        id: e.id,
        requestId: e.request_id,
        ts: e.ts,
        type: e.type,
        actor: e.actor,
        detailsJson: e.details_json ? JSON.parse(e.details_json) : null
      })),
      cascades: cascades.map((c) => ({
        id: c.id,
        requestId: c.request_id,
        partnerId: c.partner_id,
        connectorId: c.connector_id,
        status: c.status,
        attempts: c.attempts,
        lastError: c.last_error,
        updatedAt: c.updated_at,
        partnerName: c.partner_name,
        partnerEndpoint: c.partner_endpoint
      }))
    })
  })

  return router
}
