import { Router } from 'express';
import { z } from 'zod';
import { uuid, nowIso } from '../util.js';
import { requireAuth, requireRole } from '../auth.js';
const policyItemSchema = z.object({
    id: z.string().uuid().optional(),
    partnerId: z.string().uuid(),
    connectorId: z.string().uuid().optional(),
    targetType: z.enum(['connector', 'customer_api']).optional(),
    targetId: z.string().uuid().optional(),
    mode: z.string().min(1).max(60),
    retriesMax: z.number().int().min(0).optional(),
    backoffMinutes: z.number().int().min(0).optional(),
    slaDays: z.number().int().min(0).optional().nullable(),
    attestationRequired: z.boolean().optional(),
    escalationEmail: z.string().email().optional().nullable()
});
const putBodySchema = z.object({
    items: z.array(policyItemSchema)
});
const postPolicyV2Schema = z.object({
    partnerId: z.string().uuid(),
    targetType: z.enum(['connector', 'customer_api']),
    targetId: z.string().uuid(),
    mode: z.string().min(1).max(60),
    retriesMax: z.number().int().min(0).optional(),
    backoffMinutes: z.number().int().min(0).optional(),
    slaDays: z.number().int().min(0).optional().nullable(),
    attestationRequired: z.boolean().optional(),
    escalationEmail: z.string().email().optional().nullable()
});
const patchPolicySchema = postPolicyV2Schema.partial();
function mapLegacyPolicy(r) {
    return {
        id: r.id,
        orgId: r.org_id,
        partnerId: r.partner_id,
        connectorId: r.connector_id,
        targetType: 'connector',
        targetId: r.connector_id,
        mode: r.mode,
        retriesMax: r.retries_max,
        backoffMinutes: r.backoff_minutes,
        slaDays: r.sla_days,
        attestationRequired: Boolean(r.attestation_required),
        escalationEmail: r.escalation_email,
        createdAt: r.created_at
    };
}
function mapV2Policy(r) {
    return {
        id: r.id,
        orgId: r.org_id,
        partnerId: r.partner_id,
        connectorId: null,
        targetType: r.target_type,
        targetId: r.target_id,
        mode: r.mode,
        retriesMax: r.retries_max,
        backoffMinutes: r.backoff_minutes,
        slaDays: r.sla_days,
        attestationRequired: Boolean(r.attestation_required),
        escalationEmail: r.escalation_email,
        createdAt: r.created_at,
        updatedAt: r.updated_at
    };
}
/** Alias: GET/PUT /api/app/cascade-policies -> partners/policies + v2 generic. */
export function createCascadePoliciesAliasRouter(db) {
    const router = Router();
    router.get('/', requireAuth, (req, res) => {
        const orgId = req.user.org_id;
        const legacy = db.prepare(`
      SELECT id, org_id, partner_id, connector_id, mode, retries_max, backoff_minutes, sla_days, attestation_required, escalation_email, created_at
      FROM cascade_policies WHERE org_id = ?
    `).all(orgId);
        const v2 = db.prepare(`
      SELECT id, org_id, partner_id, target_type, target_id, mode, retries_max, backoff_minutes, sla_days, attestation_required, escalation_email, created_at, updated_at
      FROM cascade_policies_v2 WHERE org_id = ?
    `).all(orgId);
        const items = [...legacy.map(mapLegacyPolicy), ...v2.map(mapV2Policy)];
        return res.json({ items });
    });
    router.put('/', requireAuth, requireRole('OWNER', 'ADMIN'), (req, res) => {
        const parsed = putBodySchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });
        }
        const orgId = req.user.org_id;
        const now = nowIso();
        db.transaction(() => {
            db.prepare('DELETE FROM cascade_policies WHERE org_id = ?').run(orgId);
            db.prepare('DELETE FROM cascade_policies_v2 WHERE org_id = ?').run(orgId);
            for (const item of parsed.data.items) {
                if (item.targetType != null && item.targetId != null) {
                    const id = item.id ?? uuid();
                    db.prepare(`
            INSERT INTO cascade_policies_v2 (id, org_id, partner_id, target_type, target_id, mode, retries_max, backoff_minutes, sla_days, attestation_required, escalation_email, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(id, orgId, item.partnerId, item.targetType, item.targetId, item.mode, item.retriesMax ?? 3, item.backoffMinutes ?? 60, item.slaDays ?? null, item.attestationRequired ? 1 : 0, item.escalationEmail ?? null, now, now);
                }
                else {
                    const id = item.id ?? uuid();
                    const connectorId = item.connectorId ?? item.targetId ?? '';
                    if (!connectorId)
                        continue;
                    db.prepare(`
            INSERT INTO cascade_policies (id, org_id, partner_id, connector_id, mode, retries_max, backoff_minutes, sla_days, attestation_required, escalation_email, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(id, orgId, item.partnerId, connectorId, item.mode, item.retriesMax ?? 3, item.backoffMinutes ?? 60, item.slaDays ?? null, item.attestationRequired ? 1 : 0, item.escalationEmail ?? null, now);
                }
            }
        })();
        const legacy = db.prepare('SELECT id, org_id, partner_id, connector_id, mode, retries_max, backoff_minutes, sla_days, attestation_required, escalation_email, created_at FROM cascade_policies WHERE org_id = ?').all(orgId);
        const v2 = db.prepare('SELECT id, org_id, partner_id, target_type, target_id, mode, retries_max, backoff_minutes, sla_days, attestation_required, escalation_email, created_at, updated_at FROM cascade_policies_v2 WHERE org_id = ?').all(orgId);
        const items = [...legacy.map(mapLegacyPolicy), ...v2.map(mapV2Policy)];
        return res.json({ items });
    });
    router.post('/', requireAuth, requireRole('OWNER', 'ADMIN'), (req, res) => {
        const parsed = postPolicyV2Schema.safeParse(req.body);
        if (!parsed.success)
            return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });
        const orgId = req.user.org_id;
        const id = uuid();
        const now = nowIso();
        const d = parsed.data;
        try {
            db.prepare(`
        INSERT INTO cascade_policies_v2 (id, org_id, partner_id, target_type, target_id, mode, retries_max, backoff_minutes, sla_days, attestation_required, escalation_email, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, orgId, d.partnerId, d.targetType, d.targetId, d.mode, d.retriesMax ?? 3, d.backoffMinutes ?? 60, d.slaDays ?? null, d.attestationRequired ? 1 : 0, d.escalationEmail ?? null, now, now);
        }
        catch (e) {
            if (String(e?.message).includes('FOREIGN KEY'))
                return res.status(400).json({ error: 'Partner not found' });
            throw e;
        }
        const row = db.prepare('SELECT id, org_id, partner_id, target_type, target_id, mode, retries_max, backoff_minutes, sla_days, attestation_required, escalation_email, created_at, updated_at FROM cascade_policies_v2 WHERE id = ?').get(id);
        return res.status(201).json(mapV2Policy(row));
    });
    router.patch('/:id', requireAuth, requireRole('OWNER', 'ADMIN'), (req, res) => {
        const orgId = req.user.org_id;
        const id = req.params.id;
        const parsed = patchPolicySchema.safeParse(req.body);
        if (!parsed.success)
            return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });
        const inV2 = db.prepare('SELECT id FROM cascade_policies_v2 WHERE id = ? AND org_id = ?').get(id, orgId);
        if (inV2) {
            const d = parsed.data;
            const updates = [];
            const params = [];
            if (d.partnerId !== undefined) {
                updates.push('partner_id = ?');
                params.push(d.partnerId);
            }
            if (d.targetType !== undefined) {
                updates.push('target_type = ?');
                params.push(d.targetType);
            }
            if (d.targetId !== undefined) {
                updates.push('target_id = ?');
                params.push(d.targetId);
            }
            if (d.mode !== undefined) {
                updates.push('mode = ?');
                params.push(d.mode);
            }
            if (d.retriesMax !== undefined) {
                updates.push('retries_max = ?');
                params.push(d.retriesMax);
            }
            if (d.backoffMinutes !== undefined) {
                updates.push('backoff_minutes = ?');
                params.push(d.backoffMinutes);
            }
            if (d.slaDays !== undefined) {
                updates.push('sla_days = ?');
                params.push(d.slaDays);
            }
            if (d.attestationRequired !== undefined) {
                updates.push('attestation_required = ?');
                params.push(d.attestationRequired ? 1 : 0);
            }
            if (d.escalationEmail !== undefined) {
                updates.push('escalation_email = ?');
                params.push(d.escalationEmail);
            }
            const now = nowIso();
            updates.push('updated_at = ?');
            params.push(now, id, orgId);
            if (updates.length > 1)
                db.prepare(`UPDATE cascade_policies_v2 SET ${updates.join(', ')} WHERE id = ? AND org_id = ?`).run(...params);
            const row = db.prepare('SELECT id, org_id, partner_id, target_type, target_id, mode, retries_max, backoff_minutes, sla_days, attestation_required, escalation_email, created_at, updated_at FROM cascade_policies_v2 WHERE id = ?').get(id);
            return res.json(mapV2Policy(row));
        }
        const inLegacy = db.prepare('SELECT id FROM cascade_policies WHERE id = ? AND org_id = ?').get(id, orgId);
        if (!inLegacy)
            return res.status(404).json({ error: 'Not found' });
        const d = parsed.data;
        const updates = [];
        const params = [];
        if (d.partnerId !== undefined) {
            updates.push('partner_id = ?');
            params.push(d.partnerId);
        }
        if (d.targetId !== undefined) {
            updates.push('connector_id = ?');
            params.push(d.targetId);
        }
        if (d.mode !== undefined) {
            updates.push('mode = ?');
            params.push(d.mode);
        }
        if (d.retriesMax !== undefined) {
            updates.push('retries_max = ?');
            params.push(d.retriesMax);
        }
        if (d.backoffMinutes !== undefined) {
            updates.push('backoff_minutes = ?');
            params.push(d.backoffMinutes);
        }
        if (d.slaDays !== undefined) {
            updates.push('sla_days = ?');
            params.push(d.slaDays);
        }
        if (d.attestationRequired !== undefined) {
            updates.push('attestation_required = ?');
            params.push(d.attestationRequired ? 1 : 0);
        }
        if (d.escalationEmail !== undefined) {
            updates.push('escalation_email = ?');
            params.push(d.escalationEmail);
        }
        if (params.length) {
            params.push(id, orgId);
            db.prepare(`UPDATE cascade_policies SET ${updates.join(', ')} WHERE id = ? AND org_id = ?`).run(...params);
        }
        const row = db.prepare('SELECT id, org_id, partner_id, connector_id, mode, retries_max, backoff_minutes, sla_days, attestation_required, escalation_email, created_at FROM cascade_policies WHERE id = ?').get(id);
        return res.json(mapLegacyPolicy(row));
    });
    router.delete('/:id', requireAuth, requireRole('OWNER', 'ADMIN'), (req, res) => {
        const orgId = req.user.org_id;
        const id = req.params.id;
        const r2 = db.prepare('DELETE FROM cascade_policies_v2 WHERE id = ? AND org_id = ?').run(id, orgId);
        if (r2.changes > 0)
            return res.json({ ok: true });
        const r1 = db.prepare('DELETE FROM cascade_policies WHERE id = ? AND org_id = ?').run(id, orgId);
        if (r1.changes === 0)
            return res.status(404).json({ error: 'Not found' });
        return res.json({ ok: true });
    });
    return router;
}
