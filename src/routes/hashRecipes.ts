import { Router } from 'express'
import { z } from 'zod'
import type { DB } from '../db.js'
import { uuid, nowIso } from '../util.js'
import { requireAuth, requireRole } from '../auth.js'

export function createHashRecipesRouter(db: DB): Router {
  const router = Router()

  const createSchema = z.object({
    name: z.string().min(1).max(120),
    delimiter: z.string().optional(),
    fieldsJson: z.union([z.string(), z.array(z.string())]).transform((v) =>
      typeof v === 'string' ? v : JSON.stringify(v)
    ),
    normalizationJson: z.union([z.record(z.unknown()), z.string()]).optional().transform((v) =>
      v === undefined ? undefined : typeof v === 'string' ? v : JSON.stringify(v)
    )
  })

  const patchSchema = z.object({
    name: z.string().min(1).max(120).optional(),
    delimiter: z.string().optional(),
    fieldsJson: z.union([z.string(), z.array(z.string())]).optional().transform((v) =>
      v === undefined ? undefined : typeof v === 'string' ? v : JSON.stringify(v)
    ),
    normalizationJson: z.union([z.record(z.unknown()), z.string()]).optional().transform((v) =>
      v === undefined ? undefined : typeof v === 'string' ? v : JSON.stringify(v)
    )
  })

  router.get('/', requireAuth, (req, res) => {
    const orgId = req.user!.org_id
    const rows = db.prepare(`
      SELECT id, org_id, name, version, delimiter, fields_json, normalization_json, created_at, updated_at, active
      FROM hash_recipes WHERE org_id = ? ORDER BY updated_at DESC
    `).all(orgId) as Array<{
      id: string; org_id: string; name: string; version: number; delimiter: string | null;
      fields_json: string; normalization_json: string | null; created_at: string; updated_at: string; active: number
    }>
    return res.json({
      items: rows.map((r) => ({
        id: r.id,
        orgId: r.org_id,
        name: r.name,
        version: r.version,
        delimiter: r.delimiter,
        fieldsJson: r.fields_json,
        normalizationJson: r.normalization_json,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        active: Boolean(r.active)
      }))
    })
  })

  router.post('/', requireAuth, requireRole('OWNER', 'ADMIN'), (req, res) => {
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues })
    }
    const orgId = req.user!.org_id
    const id = uuid()
    const now = nowIso()
    db.prepare(`
      INSERT INTO hash_recipes (id, org_id, name, version, delimiter, fields_json, normalization_json, created_at, updated_at, active)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, 0)
    `).run(
      id,
      orgId,
      parsed.data.name,
      parsed.data.delimiter ?? null,
      parsed.data.fieldsJson,
      parsed.data.normalizationJson ?? null,
      now,
      now
    )
    return res.status(201).json({
      id,
      orgId,
      name: parsed.data.name,
      version: 1,
      delimiter: parsed.data.delimiter ?? null,
      fieldsJson: parsed.data.fieldsJson,
      normalizationJson: parsed.data.normalizationJson ?? null,
      createdAt: now,
      updatedAt: now,
      active: false
    })
  })

  router.patch('/:id', requireAuth, requireRole('OWNER', 'ADMIN'), (req, res) => {
    const orgId = req.user!.org_id
    const id = req.params.id
    const existing = db.prepare('SELECT id, version FROM hash_recipes WHERE id = ? AND org_id = ?').get(id, orgId)
    if (!existing) {
      return res.status(404).json({ error: 'Not found' })
    }
    const parsed = patchSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues })
    }
    const now = nowIso()
    const updates: string[] = ['updated_at = ?']
    const params: unknown[] = [now]
    if (parsed.data.name !== undefined) {
      updates.push('name = ?')
      params.push(parsed.data.name)
    }
    if (parsed.data.delimiter !== undefined) {
      updates.push('delimiter = ?')
      params.push(parsed.data.delimiter)
    }
    if (parsed.data.fieldsJson !== undefined) {
      updates.push('fields_json = ?')
      params.push(parsed.data.fieldsJson)
    }
    if (parsed.data.normalizationJson !== undefined) {
      updates.push('normalization_json = ?')
      params.push(parsed.data.normalizationJson)
    }
    params.push(id, orgId)
    db.prepare(`UPDATE hash_recipes SET ${updates.join(', ')} WHERE id = ? AND org_id = ?`).run(...params)
    const row = db.prepare(
      'SELECT id, org_id, name, version, delimiter, fields_json, normalization_json, created_at, updated_at, active FROM hash_recipes WHERE id = ?'
    ).get(id) as { id: string; org_id: string; name: string; version: number; delimiter: string | null; fields_json: string; normalization_json: string | null; created_at: string; updated_at: string; active: number }
    return res.json({
      id: row.id,
      orgId: row.org_id,
      name: row.name,
      version: row.version,
      delimiter: row.delimiter,
      fieldsJson: row.fields_json,
      normalizationJson: row.normalization_json,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      active: Boolean(row.active)
    })
  })

  router.post('/:id/activate', requireAuth, requireRole('OWNER', 'ADMIN'), (req, res) => {
    const orgId = req.user!.org_id
    const id = req.params.id
    const existing = db.prepare('SELECT id FROM hash_recipes WHERE id = ? AND org_id = ?').get(id, orgId)
    if (!existing) {
      return res.status(404).json({ error: 'Not found' })
    }
    const now = nowIso()
    db.transaction(() => {
      db.prepare('UPDATE hash_recipes SET active = 0, updated_at = ? WHERE org_id = ?').run(now, orgId)
      db.prepare('UPDATE hash_recipes SET active = 1, updated_at = ? WHERE id = ? AND org_id = ?').run(now, id, orgId)
    })()
    return res.json({ ok: true, activeId: id })
  })

  return router
}
