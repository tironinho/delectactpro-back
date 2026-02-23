import { Router } from 'express'
import { z } from 'zod'
import type { DB } from '../db.js'
import { isHex64 } from '../util.js'
import { requireAuth } from '../auth.js'

const validateSchema = z.object({
  subjectHash: z.string().refine((s) => isHex64(s), { message: 'subjectHash must be 64 hex chars' }),
  sourceType: z.enum(['drop', 'manual-test']).optional(),
  dryRun: z.boolean().optional()
})

/** POST /api/app/hash-match/validate — validate org has mappings for a subject hash (no PII). */
export function createHashMatchRouter(db: DB): Router {
  const router = Router()

  router.post('/validate', requireAuth, (req, res) => {
    const parsed = validateSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues })
    }
    const orgId = req.user!.org_id
    const { subjectHash } = parsed.data

    const connectors = db.prepare('SELECT id, name FROM connectors WHERE org_id = ?').all(orgId) as Array<{ id: string; name: string }>
    const customerApis = db.prepare('SELECT id, name FROM customer_api_integrations WHERE org_id = ?').all(orgId) as Array<{ id: string; name: string }>
    const partners = db.prepare(`
      SELECT p.id, p.name
      FROM partners p
      WHERE p.org_id = ? AND p.enabled = 1
    `).all(orgId) as Array<{ id: string; name: string }>

    const legacyPolicies = db.prepare(`
      SELECT cp.partner_id, cp.connector_id, cp.mode, p.name as partner_name
      FROM cascade_policies cp
      JOIN partners p ON p.id = cp.partner_id
      WHERE cp.org_id = ?
    `).all(orgId) as Array<{ partner_id: string; connector_id: string; mode: string; partner_name: string }>

    const v2Policies = db.prepare(`
      SELECT cp.partner_id, cp.target_type, cp.target_id, cp.mode, p.name as partner_name
      FROM cascade_policies_v2 cp
      JOIN partners p ON p.id = cp.partner_id
      WHERE cp.org_id = ?
    `).all(orgId) as Array<{ partner_id: string; target_type: string; target_id: string; mode: string; partner_name: string }>

    const matchedTargets = {
      connectors: connectors.length,
      customerApis: customerApis.length,
      partners: partners.length
    }

    const cascadeCandidates: Array<{ partnerId: string; partnerName: string; targetType: string; targetId: string; mode: string }> = []
    for (const p of legacyPolicies) {
      cascadeCandidates.push({
        partnerId: p.partner_id,
        partnerName: p.partner_name,
        targetType: 'connector',
        targetId: p.connector_id,
        mode: p.mode
      })
    }
    for (const p of v2Policies) {
      cascadeCandidates.push({
        partnerId: p.partner_id,
        partnerName: p.partner_name,
        targetType: p.target_type,
        targetId: p.target_id,
        mode: p.mode
      })
    }

    const notes: string[] = []
    if (connectors.length === 0 && customerApis.length === 0) {
      notes.push('No connectors or customer APIs configured')
    }
    if (cascadeCandidates.length === 0) {
      notes.push('No cascade policies configured; no downstream targets will receive this request')
    }

    return res.json({
      ok: true,
      subjectHash,
      matchedTargets,
      cascadeCandidates,
      notes
    })
  })

  return router
}
