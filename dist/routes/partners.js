import { Router } from 'express';
import { z } from 'zod';
import { uuid, nowIso } from '../util.js';
import { requireAuth, requireRole } from '../auth.js';
export function createPartnersRouter(db) {
    const router = Router();
    const partnerSchema = z.object({
        name: z.string().min(1).max(120),
        type: z.string().max(60).optional(),
        endpointUrl: z.string().url().max(500),
        enabled: z.boolean().optional()
    });
    const linkSchema = z.object({
        partnerId: z.string().uuid(),
        connectorId: z.string().uuid()
    });
    const policySchema = z.object({
        partnerId: z.string().uuid(),
        connectorId: z.string().uuid(),
        mode: z.string().min(1).max(60),
        retriesMax: z.number().int().min(0).optional(),
        backoffMinutes: z.number().int().min(0).optional(),
        slaDays: z.number().int().min(0).optional(),
        attestationRequired: z.boolean().optional(),
        escalationEmail: z.string().email().optional()
    });
    const targetSchema = z.object({
        partnerId: z.string().uuid(),
        targetType: z.enum(['connector', 'customer_api']),
        targetId: z.string().uuid()
    });
    router.get('/', requireAuth, (req, res) => {
        const orgId = req.user.org_id;
        const rows = db.prepare('SELECT id, org_id, name, type, endpoint_url, enabled, created_at FROM partners WHERE org_id = ? ORDER BY created_at DESC').all(orgId);
        return res.json({
            items: rows.map((r) => ({
                id: r.id,
                orgId: r.org_id,
                name: r.name,
                type: r.type,
                endpointUrl: r.endpoint_url,
                enabled: Boolean(r.enabled),
                createdAt: r.created_at
            }))
        });
    });
    router.post('/', requireAuth, requireRole('OWNER', 'ADMIN'), (req, res) => {
        const parsed = partnerSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });
        }
        const orgId = req.user.org_id;
        const id = uuid();
        const now = nowIso();
        db.prepare(`
      INSERT INTO partners (id, org_id, name, type, endpoint_url, enabled, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, orgId, parsed.data.name, parsed.data.type ?? null, parsed.data.endpointUrl, parsed.data.enabled !== false ? 1 : 0, now);
        return res.status(201).json({
            id,
            orgId,
            name: parsed.data.name,
            type: parsed.data.type ?? null,
            endpointUrl: parsed.data.endpointUrl,
            enabled: parsed.data.enabled !== false,
            createdAt: now
        });
    });
    router.patch('/:id', requireAuth, requireRole('OWNER', 'ADMIN'), (req, res) => {
        const orgId = req.user.org_id;
        const id = req.params.id;
        const existing = db.prepare('SELECT id FROM partners WHERE id = ? AND org_id = ?').get(id, orgId);
        if (!existing)
            return res.status(404).json({ error: 'Not found' });
        const parsed = partnerSchema.partial().safeParse(req.body);
        if (!parsed.success)
            return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });
        const now = nowIso();
        const d = parsed.data;
        if (d.name !== undefined)
            db.prepare('UPDATE partners SET name = ?, type = COALESCE(?, type), endpoint_url = COALESCE(?, endpoint_url), enabled = COALESCE(?, enabled) WHERE id = ? AND org_id = ?').run(d.name, d.type ?? null, d.endpointUrl ?? null, d.enabled === undefined ? undefined : d.enabled ? 1 : 0, id, orgId);
        else if (Object.keys(d).length) {
            const updates = [];
            const params = [];
            if (d.type !== undefined) {
                updates.push('type = ?');
                params.push(d.type);
            }
            if (d.endpointUrl !== undefined) {
                updates.push('endpoint_url = ?');
                params.push(d.endpointUrl);
            }
            if (d.enabled !== undefined) {
                updates.push('enabled = ?');
                params.push(d.enabled ? 1 : 0);
            }
            if (params.length) {
                params.push(id, orgId);
                db.prepare(`UPDATE partners SET ${updates.join(', ')} WHERE id = ? AND org_id = ?`).run(...params);
            }
        }
        const row = db.prepare('SELECT id, org_id, name, type, endpoint_url, enabled, created_at FROM partners WHERE id = ?').get(id);
        return res.json({ id: row.id, orgId: row.org_id, name: row.name, type: row.type, endpointUrl: row.endpoint_url, enabled: Boolean(row.enabled), createdAt: row.created_at });
    });
    router.delete('/:id', requireAuth, requireRole('OWNER', 'ADMIN'), (req, res) => {
        const orgId = req.user.org_id;
        const id = req.params.id;
        const r = db.prepare('DELETE FROM partners WHERE id = ? AND org_id = ?').run(id, orgId);
        if (r.changes === 0)
            return res.status(404).json({ error: 'Not found' });
        return res.json({ ok: true });
    });
    // Partner links
    router.get('/links', requireAuth, (req, res) => {
        const orgId = req.user.org_id;
        const rows = db.prepare(`
      SELECT id, org_id, partner_id, connector_id FROM partner_links WHERE org_id = ?
    `).all(orgId);
        return res.json({ items: rows });
    });
    router.post('/links', requireAuth, requireRole('OWNER', 'ADMIN'), (req, res) => {
        const parsed = linkSchema.safeParse(req.body);
        if (!parsed.success)
            return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });
        const orgId = req.user.org_id;
        const id = uuid();
        try {
            db.prepare('INSERT INTO partner_links (id, org_id, partner_id, connector_id) VALUES (?, ?, ?, ?)').run(id, orgId, parsed.data.partnerId, parsed.data.connectorId);
        }
        catch (e) {
            if (String(e?.message).includes('FOREIGN KEY'))
                return res.status(400).json({ error: 'Partner or connector not found' });
            if (String(e?.message).includes('UNIQUE'))
                return res.status(409).json({ error: 'Link already exists' });
            throw e;
        }
        return res.status(201).json({ id, orgId, partnerId: parsed.data.partnerId, connectorId: parsed.data.connectorId });
    });
    router.delete('/links/:id', requireAuth, requireRole('OWNER', 'ADMIN'), (req, res) => {
        const orgId = req.user.org_id;
        const id = req.params.id;
        const r = db.prepare('DELETE FROM partner_links WHERE id = ? AND org_id = ?').run(id, orgId);
        if (r.changes === 0)
            return res.status(404).json({ error: 'Not found' });
        return res.json({ ok: true });
    });
    // Cascade policies
    router.get('/policies', requireAuth, (req, res) => {
        const orgId = req.user.org_id;
        const rows = db.prepare(`
      SELECT id, org_id, partner_id, connector_id, mode, retries_max, backoff_minutes, sla_days, attestation_required, escalation_email, created_at
      FROM cascade_policies WHERE org_id = ?
    `).all(orgId);
        return res.json({
            items: rows.map((r) => ({
                id: r.id,
                orgId: r.org_id,
                partnerId: r.partner_id,
                connectorId: r.connector_id,
                mode: r.mode,
                retriesMax: r.retries_max,
                backoffMinutes: r.backoff_minutes,
                slaDays: r.sla_days,
                attestationRequired: Boolean(r.attestation_required),
                escalationEmail: r.escalation_email,
                createdAt: r.created_at
            }))
        });
    });
    router.post('/policies', requireAuth, requireRole('OWNER', 'ADMIN'), (req, res) => {
        const parsed = policySchema.safeParse(req.body);
        if (!parsed.success)
            return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });
        const orgId = req.user.org_id;
        const id = uuid();
        const now = nowIso();
        try {
            db.prepare(`
        INSERT INTO cascade_policies (id, org_id, partner_id, connector_id, mode, retries_max, backoff_minutes, sla_days, attestation_required, escalation_email, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, orgId, parsed.data.partnerId, parsed.data.connectorId, parsed.data.mode, parsed.data.retriesMax ?? 3, parsed.data.backoffMinutes ?? 60, parsed.data.slaDays ?? null, parsed.data.attestationRequired ? 1 : 0, parsed.data.escalationEmail ?? null, now);
        }
        catch (e) {
            if (String(e?.message).includes('FOREIGN KEY'))
                return res.status(400).json({ error: 'Partner or connector not found' });
            throw e;
        }
        return res.status(201).json({
            id, orgId,
            partnerId: parsed.data.partnerId,
            connectorId: parsed.data.connectorId,
            mode: parsed.data.mode,
            retriesMax: parsed.data.retriesMax ?? 3,
            backoffMinutes: parsed.data.backoffMinutes ?? 60,
            slaDays: parsed.data.slaDays ?? null,
            attestationRequired: parsed.data.attestationRequired ?? false,
            escalationEmail: parsed.data.escalationEmail ?? null,
            createdAt: now
        });
    });
    router.patch('/policies/:id', requireAuth, requireRole('OWNER', 'ADMIN'), (req, res) => {
        const orgId = req.user.org_id;
        const id = req.params.id;
        const existing = db.prepare('SELECT id FROM cascade_policies WHERE id = ? AND org_id = ?').get(id, orgId);
        if (!existing)
            return res.status(404).json({ error: 'Not found' });
        const parsed = policySchema.partial().safeParse(req.body);
        if (!parsed.success)
            return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });
        const d = parsed.data;
        const updates = [];
        const params = [];
        if (d.partnerId !== undefined) {
            updates.push('partner_id = ?');
            params.push(d.partnerId);
        }
        if (d.connectorId !== undefined) {
            updates.push('connector_id = ?');
            params.push(d.connectorId);
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
        const row = db.prepare('SELECT * FROM cascade_policies WHERE id = ?').get(id);
        return res.json({
            id: row.id, orgId: row.org_id, partnerId: row.partner_id, connectorId: row.connector_id,
            mode: row.mode, retriesMax: row.retries_max, backoffMinutes: row.backoff_minutes, slaDays: row.sla_days,
            attestationRequired: Boolean(row.attestation_required), escalationEmail: row.escalation_email, createdAt: row.created_at
        });
    });
    router.delete('/policies/:id', requireAuth, requireRole('OWNER', 'ADMIN'), (req, res) => {
        const orgId = req.user.org_id;
        const id = req.params.id;
        const r = db.prepare('DELETE FROM cascade_policies WHERE id = ? AND org_id = ?').run(id, orgId);
        if (r.changes === 0)
            return res.status(404).json({ error: 'Not found' });
        return res.json({ ok: true });
    });
    // Partner targets (generic: connector | customer_api)
    router.get('/targets', requireAuth, (req, res) => {
        const orgId = req.user.org_id;
        const rows = db.prepare(`
      SELECT id, org_id, partner_id, target_type, target_id, created_at
      FROM partner_targets WHERE org_id = ? ORDER BY created_at DESC
    `).all(orgId);
        return res.json({
            items: rows.map((r) => ({
                id: r.id,
                orgId: r.org_id,
                partnerId: r.partner_id,
                targetType: r.target_type,
                targetId: r.target_id,
                createdAt: r.created_at
            }))
        });
    });
    router.post('/targets', requireAuth, requireRole('OWNER', 'ADMIN'), (req, res) => {
        const parsed = targetSchema.safeParse(req.body);
        if (!parsed.success)
            return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });
        const orgId = req.user.org_id;
        const id = uuid();
        const now = nowIso();
        try {
            db.prepare(`
        INSERT INTO partner_targets (id, org_id, partner_id, target_type, target_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, orgId, parsed.data.partnerId, parsed.data.targetType, parsed.data.targetId, now);
        }
        catch (e) {
            if (String(e?.message).includes('FOREIGN KEY'))
                return res.status(400).json({ error: 'Partner not found' });
            if (String(e?.message).includes('UNIQUE'))
                return res.status(409).json({ error: 'Target already linked' });
            throw e;
        }
        return res.status(201).json({
            id,
            orgId,
            partnerId: parsed.data.partnerId,
            targetType: parsed.data.targetType,
            targetId: parsed.data.targetId,
            createdAt: now
        });
    });
    router.delete('/targets/:id', requireAuth, requireRole('OWNER', 'ADMIN'), (req, res) => {
        const orgId = req.user.org_id;
        const id = req.params.id;
        const r = db.prepare('DELETE FROM partner_targets WHERE id = ? AND org_id = ?').run(id, orgId);
        if (r.changes === 0)
            return res.status(404).json({ error: 'Not found' });
        return res.json({ ok: true });
    });
    return router;
}
