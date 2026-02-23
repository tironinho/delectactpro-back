import { Router } from 'express'
import type { DB } from '../db.js'
import { requireAuth } from '../auth.js'

export function createRunsRouter(db: DB): Router {
  const router = Router()

  router.get('/', requireAuth, (req, res) => {
    const orgId = req.user!.org_id
    const rows = db.prepare(`
      SELECT id, org_id, connector_id, type, started_at, ended_at, status, stats_json
      FROM runs WHERE org_id = ? ORDER BY started_at DESC LIMIT 200
    `).all(orgId) as Array<{
      id: string; org_id: string; connector_id: string; type: string; started_at: string; ended_at: string | null; status: string; stats_json: string | null
    }>
    return res.json({
      items: rows.map((r) => ({
        id: r.id,
        orgId: r.org_id,
        connectorId: r.connector_id,
        type: r.type,
        startedAt: r.started_at,
        endedAt: r.ended_at,
        status: r.status,
        statsJson: r.stats_json ? JSON.parse(r.stats_json) : null
      }))
    })
  })

  router.get('/:id', requireAuth, (req, res) => {
    const orgId = req.user!.org_id
    const id = req.params.id
    const row = db.prepare(`
      SELECT id, org_id, connector_id, type, started_at, ended_at, status, stats_json
      FROM runs WHERE id = ? AND org_id = ?
    `).get(id, orgId) as {
      id: string; org_id: string; connector_id: string; type: string; started_at: string; ended_at: string | null; status: string; stats_json: string | null
    } | undefined
    if (!row) return res.status(404).json({ error: 'Not found' })
    return res.json({
      id: row.id,
      orgId: row.org_id,
      connectorId: row.connector_id,
      type: row.type,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      status: row.status,
      statsJson: row.stats_json ? JSON.parse(row.stats_json) : null
    })
  })

  return router
}
