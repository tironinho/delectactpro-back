import { Router } from 'express'
import { z } from 'zod'
import type { DB } from '../db.js'
import { uuid, nowIso, hashToken, generateConnectorToken } from '../util.js'
import { requireAuth, requireRole } from '../auth.js'

export function createConnectorsRouter(db: DB): Router {
  const router = Router()

  const createSchema = z.object({
    name: z.string().min(1).max(120),
    dbType: z.enum(['postgres', 'mysql'])
  })

  router.post('/', requireAuth, requireRole('OWNER', 'ADMIN'), (req, res) => {
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues })
    }
    const orgId = req.user!.org_id
    const id = uuid()
    const createdAt = nowIso()
    const tokenPlain = generateConnectorToken()
    const tokenHash = hashToken(tokenPlain)
    const tokenId = uuid()

    db.transaction(() => {
      db.prepare(
        'INSERT INTO connectors (id, org_id, name, db_type, created_at, last_heartbeat_at, agent_version, status) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)'
      ).run(id, orgId, parsed.data.name, parsed.data.dbType, createdAt, 'PENDING')
      db.prepare(
        'INSERT INTO connector_tokens (id, connector_id, token_hash, created_at, revoked_at) VALUES (?, ?, ?, ?, NULL)'
      ).run(tokenId, id, tokenHash, createdAt)
    })()

    return res.status(201).json({
      id,
      name: parsed.data.name,
      dbType: parsed.data.dbType,
      status: 'PENDING',
      createdAt,
      token: tokenPlain
    })
  })

  router.get('/', requireAuth, (req, res) => {
    const orgId = req.user!.org_id
    const rows = db.prepare(`
      SELECT id, org_id, name, db_type, created_at, last_heartbeat_at, agent_version, status
      FROM connectors WHERE org_id = ? ORDER BY created_at DESC
    `).all(orgId) as Array<{
      id: string; org_id: string; name: string; db_type: string; created_at: string;
      last_heartbeat_at: string | null; agent_version: string | null; status: string
    }>
    return res.json({
      items: rows.map((r) => ({
        id: r.id,
        orgId: r.org_id,
        name: r.name,
        dbType: r.db_type,
        createdAt: r.created_at,
        lastHeartbeatAt: r.last_heartbeat_at,
        agentVersion: r.agent_version,
        status: r.status
      }))
    })
  })

  router.post('/:id/rotate-token', requireAuth, requireRole('OWNER', 'ADMIN'), (req, res) => {
    const orgId = req.user!.org_id
    const connectorId = req.params.id
    const conn = db.prepare('SELECT id FROM connectors WHERE id = ? AND org_id = ?').get(connectorId, orgId)
    if (!conn) {
      return res.status(404).json({ error: 'Connector not found' })
    }
    const tokenPlain = generateConnectorToken()
    const tokenHash = hashToken(tokenPlain)
    const tokenId = uuid()
    const now = nowIso()
    db.prepare(
      'INSERT INTO connector_tokens (id, connector_id, token_hash, created_at, revoked_at) VALUES (?, ?, ?, ?, NULL)'
    ).run(tokenId, connectorId, tokenHash, now)
    return res.json({ token: tokenPlain })
  })

  return router
}
