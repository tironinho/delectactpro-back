import { Router } from 'express'
import type { DB } from '../db.js'
import { uuid, nowIso } from '../util.js'
import { requireAuth, requireRole } from '../auth.js'

export interface DispatchTestResult { ok: true; tasksCreated: number }

/** Shared logic for dispatch-test (used by cascade router and admin/dispatch alias). Uses legacy + v2 policies. */
export function dispatchTest(
  db: DB,
  orgId: string,
  requestId: string,
  actorId: string
): { success: true; tasksCreated: number } | { success: false; error: string; status: number } {
  const reqRow = db.prepare('SELECT id FROM deletion_requests WHERE id = ? AND org_id = ?').get(requestId, orgId)
  if (!reqRow) {
    return { success: false, error: 'Request not found', status: 404 }
  }

  const legacyPolicies = db.prepare(`
    SELECT cp.id, cp.partner_id, cp.connector_id
    FROM cascade_policies cp
    JOIN partners p ON p.id = cp.partner_id AND p.enabled = 1
    WHERE cp.org_id = ?
  `).all(orgId) as Array<{ id: string; partner_id: string; connector_id: string }>

  const v2Policies = db.prepare(`
    SELECT id, partner_id, target_type, target_id
    FROM cascade_policies_v2 cp
    JOIN partners p ON p.id = cp.partner_id AND p.enabled = 1
    WHERE cp.org_id = ?
  `).all(orgId) as Array<{ id: string; partner_id: string; target_type: string; target_id: string }>

  const now = nowIso()
  const insertLegacy = db.prepare(`
    INSERT INTO cascade_jobs (id, org_id, request_id, partner_id, connector_id, target_type, target_id, status, attempts, last_error, updated_at)
    VALUES (?, ?, ?, ?, ?, NULL, NULL, 'PENDING', 0, NULL, ?)
    ON CONFLICT(request_id, partner_id, connector_id) DO UPDATE SET updated_at = excluded.updated_at
  `)
  let created = 0
  for (const p of legacyPolicies) {
    const id = uuid()
    const r = insertLegacy.run(id, orgId, requestId, p.partner_id, p.connector_id, now)
    if (r.changes > 0) created++
  }
  for (const p of v2Policies) {
    const id = uuid()
    const syntheticConnectorId = `v2:${p.target_type}:${p.target_id}`
    const insertV2 = db.prepare(`
      INSERT INTO cascade_jobs (id, org_id, request_id, partner_id, connector_id, target_type, target_id, status, attempts, last_error, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, NULL, ?)
      ON CONFLICT(request_id, partner_id, connector_id) DO UPDATE SET updated_at = excluded.updated_at
    `)
    try {
      const r = insertV2.run(id, orgId, requestId, p.partner_id, syntheticConnectorId, p.target_type, p.target_id, now)
      if (r.changes > 0) created++
    } catch (e) {
      if (!String((e as { message?: string })?.message).includes('UNIQUE')) throw e
    }
  }

  db.prepare(`
    INSERT INTO audit_events (org_id, request_id, ts, type, actor, details_json)
    VALUES (?, ?, ?, 'CASCADE_DISPATCHED', ?, ?)
  `).run(orgId, requestId, now, actorId, JSON.stringify({ legacy: legacyPolicies.length, v2: v2Policies.length }))

  return { success: true, tasksCreated: created }
}

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
    const result = dispatchTest(db, orgId, requestId, req.user!.id)
    if (!result.success) {
      return res.status(result.status).json({ error: result.error })
    }
    return res.json({ ok: true, tasksCreated: result.tasksCreated })
  })

  return router
}
