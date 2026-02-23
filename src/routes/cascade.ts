import { Router } from 'express'
import type { DB } from '../db.js'
import { uuid, nowIso } from '../util.js'
import { requireAuth, requireRole } from '../auth.js'

/** POST /api/app/cascade/dispatch-test — creates PENDING cascade_jobs for simulation (no outbound calls). */
export function createCascadeRouter(db: DB): Router {
  const router = Router()

  router.post('/dispatch-test', requireAuth, requireRole('OWNER', 'ADMIN'), (req, res) => {
    const orgId = req.user!.org_id
    const body = req.body as { requestId?: string }
    const requestId = body?.requestId
    if (!requestId || typeof requestId !== 'string') {
      return res.status(400).json({ error: 'requestId is required' })
    }
    const reqRow = db.prepare('SELECT id FROM deletion_requests WHERE id = ? AND org_id = ?').get(requestId, orgId)
    if (!reqRow) {
      return res.status(404).json({ error: 'Request not found' })
    }

    const policies = db.prepare(`
      SELECT cp.id, cp.partner_id, cp.connector_id
      FROM cascade_policies cp
      JOIN partners p ON p.id = cp.partner_id AND p.enabled = 1
      WHERE cp.org_id = ?
    `).all(orgId) as Array<{ id: string; partner_id: string; connector_id: string }>

    const now = nowIso()
    const insert = db.prepare(`
      INSERT INTO cascade_jobs (id, org_id, request_id, partner_id, connector_id, status, attempts, last_error, updated_at)
      VALUES (?, ?, ?, ?, ?, 'PENDING', 0, NULL, ?)
      ON CONFLICT(request_id, partner_id, connector_id) DO UPDATE SET updated_at = excluded.updated_at
    `)
    let created = 0
    for (const p of policies) {
      const id = uuid()
      const r = insert.run(id, orgId, requestId, p.partner_id, p.connector_id, now)
      if (r.changes > 0) created++
    }

    db.prepare(`
      INSERT INTO audit_events (org_id, request_id, ts, type, actor, details_json)
      VALUES (?, ?, ?, 'CASCADING', ?, ?)
    `).run(orgId, requestId, now, req.user!.id, JSON.stringify({ partners: policies.length }))

    return res.json({ ok: true, tasksCreated: created })
  })

  return router
}
