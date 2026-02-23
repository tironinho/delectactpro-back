import { Router } from 'express';
import { uuid, nowIso, generateApiSecret, encryptSecret, decryptSecret } from '../util.js';
import { requireAuth, requireRole } from '../auth.js';
import { createCustomerApiSchema, patchCustomerApiSchema } from '../schemas/customerApis.js';
import { env } from '../env.js';
import { testHealth, testStatus, testDelete } from '../services/customerApiClient.js';
function rowToItem(r) {
    return {
        id: r.id,
        orgId: r.org_id,
        name: r.name,
        baseUrl: r.base_url,
        healthPath: r.health_path,
        deletePath: r.delete_path,
        statusPath: r.status_path,
        webhookPath: r.webhook_path,
        authType: r.auth_type,
        headers: r.headers_json ? JSON.parse(r.headers_json) : null,
        timeoutMs: r.timeout_ms,
        retries: r.retries,
        hmacHeaderName: r.hmac_header_name,
        timestampHeaderName: r.timestamp_header_name,
        replayWindowSeconds: r.replay_window_seconds,
        lastHealthcheckAt: r.last_healthcheck_at,
        lastHealthcheckOk: r.last_healthcheck_ok == null ? null : Boolean(r.last_healthcheck_ok),
        lastHealthcheckStatus: r.last_healthcheck_status,
        lastHealthcheckError: r.last_healthcheck_error,
        createdAt: r.created_at,
        updatedAt: r.updated_at
    };
}
function buildConfig(row, sharedSecretPlain, bearerTokenPlain) {
    return {
        baseUrl: row.base_url,
        healthPath: row.health_path,
        deletePath: row.delete_path,
        statusPath: row.status_path,
        authType: row.auth_type,
        sharedSecretPlain: sharedSecretPlain ?? null,
        bearerTokenPlain: bearerTokenPlain ?? null,
        headersJson: row.headers_json,
        timeoutMs: row.timeout_ms,
        retries: row.retries,
        hmacHeaderName: row.hmac_header_name,
        timestampHeaderName: row.timestamp_header_name
    };
}
export function createCustomerApisRouter(db) {
    const router = Router();
    router.get('/', requireAuth, (req, res) => {
        const orgId = req.user.org_id;
        const rows = db.prepare(`
      SELECT id, org_id, name, base_url, health_path, delete_path, status_path, webhook_path,
             auth_type, shared_secret_encrypted, bearer_token_encrypted, headers_json,
             timeout_ms, retries, hmac_header_name, timestamp_header_name, replay_window_seconds,
             last_healthcheck_at, last_healthcheck_ok, last_healthcheck_status, last_healthcheck_error,
             created_at, updated_at
      FROM customer_api_integrations WHERE org_id = ? ORDER BY updated_at DESC
    `).all(orgId);
        return res.json({ items: rows.map(rowToItem) });
    });
    router.post('/', requireAuth, requireRole('OWNER', 'ADMIN'), (req, res) => {
        const parsed = createCustomerApiSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });
        }
        const orgId = req.user.org_id;
        const d = parsed.data;
        if (d.authType !== 'NONE') {
            if (!env.APP_ENCRYPTION_KEY || env.APP_ENCRYPTION_KEY.length < 32) {
                return res.status(400).json({
                    error: 'APP_ENCRYPTION_KEY must be set (min 32 chars) to create integrations with HMAC or BEARER auth'
                });
            }
            if (d.authType === 'HMAC' && !d.sharedSecret) {
                return res.status(400).json({ error: 'sharedSecret is required for HMAC' });
            }
            if (d.authType === 'BEARER' && !d.bearerToken) {
                return res.status(400).json({ error: 'bearerToken is required for BEARER' });
            }
        }
        const id = uuid();
        const now = nowIso();
        let sharedSecretPlain = null;
        let sharedSecretEncrypted = null;
        let bearerTokenEncrypted = null;
        if (d.authType === 'HMAC') {
            sharedSecretPlain = d.sharedSecret ?? generateApiSecret();
            sharedSecretEncrypted = encryptSecret(sharedSecretPlain);
        }
        else if (d.authType === 'BEARER' && d.bearerToken) {
            bearerTokenEncrypted = encryptSecret(d.bearerToken);
        }
        db.prepare(`
      INSERT INTO customer_api_integrations (
        id, org_id, name, base_url, health_path, delete_path, status_path, webhook_path,
        auth_type, shared_secret_encrypted, bearer_token_encrypted, headers_json,
        timeout_ms, retries, hmac_header_name, timestamp_header_name, replay_window_seconds,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, orgId, d.name, d.baseUrl, d.healthPath ?? '/deleteactpro/health', d.deletePath ?? '/deleteactpro/delete', d.statusPath ?? '/deleteactpro/status', d.webhookPath ?? null, d.authType, sharedSecretEncrypted, bearerTokenEncrypted, d.headers ? JSON.stringify(d.headers) : null, d.timeoutMs ?? 8000, d.retries ?? 2, d.hmacHeaderName ?? 'X-DAP-Signature', d.timestampHeaderName ?? 'X-DAP-Timestamp', d.replayWindowSeconds ?? 300, now, now);
        const row = db.prepare('SELECT * FROM customer_api_integrations WHERE id = ?').get(id);
        const item = rowToItem(row);
        const out = { ...item };
        if (d.authType === 'HMAC' && sharedSecretPlain) {
            out.sharedSecret = sharedSecretPlain;
        }
        return res.status(201).json(out);
    });
    router.patch('/:id', requireAuth, requireRole('OWNER', 'ADMIN'), (req, res) => {
        const orgId = req.user.org_id;
        const id = req.params.id;
        const existing = db.prepare('SELECT * FROM customer_api_integrations WHERE id = ? AND org_id = ?').get(id, orgId);
        if (!existing)
            return res.status(404).json({ error: 'Not found' });
        const parsed = patchCustomerApiSchema.safeParse(req.body);
        if (!parsed.success)
            return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });
        const d = parsed.data;
        const updates = [];
        const params = [];
        if (d.name !== undefined) {
            updates.push('name = ?');
            params.push(d.name);
        }
        if (d.baseUrl !== undefined) {
            updates.push('base_url = ?');
            params.push(d.baseUrl);
        }
        if (d.healthPath !== undefined) {
            updates.push('health_path = ?');
            params.push(d.healthPath);
        }
        if (d.deletePath !== undefined) {
            updates.push('delete_path = ?');
            params.push(d.deletePath);
        }
        if (d.statusPath !== undefined) {
            updates.push('status_path = ?');
            params.push(d.statusPath);
        }
        if (d.webhookPath !== undefined) {
            updates.push('webhook_path = ?');
            params.push(d.webhookPath);
        }
        if (d.authType !== undefined) {
            updates.push('auth_type = ?');
            params.push(d.authType);
        }
        if (d.headers !== undefined) {
            updates.push('headers_json = ?');
            params.push(d.headers ? JSON.stringify(d.headers) : null);
        }
        if (d.timeoutMs !== undefined) {
            updates.push('timeout_ms = ?');
            params.push(d.timeoutMs);
        }
        if (d.retries !== undefined) {
            updates.push('retries = ?');
            params.push(d.retries);
        }
        if (d.hmacHeaderName !== undefined) {
            updates.push('hmac_header_name = ?');
            params.push(d.hmacHeaderName);
        }
        if (d.timestampHeaderName !== undefined) {
            updates.push('timestamp_header_name = ?');
            params.push(d.timestampHeaderName);
        }
        if (d.replayWindowSeconds !== undefined) {
            updates.push('replay_window_seconds = ?');
            params.push(d.replayWindowSeconds);
        }
        if (d.authType === 'BEARER' && d.bearerToken) {
            if (!env.APP_ENCRYPTION_KEY || env.APP_ENCRYPTION_KEY.length < 32) {
                return res.status(400).json({ error: 'APP_ENCRYPTION_KEY required to set bearer token' });
            }
            updates.push('bearer_token_encrypted = ?');
            params.push(encryptSecret(d.bearerToken));
        }
        if (d.authType === 'HMAC' && d.sharedSecret) {
            if (!env.APP_ENCRYPTION_KEY || env.APP_ENCRYPTION_KEY.length < 32) {
                return res.status(400).json({ error: 'APP_ENCRYPTION_KEY required to set shared secret' });
            }
            updates.push('shared_secret_encrypted = ?');
            params.push(encryptSecret(d.sharedSecret));
        }
        const now = nowIso();
        updates.push('updated_at = ?');
        params.push(now);
        params.push(id, orgId);
        if (updates.length > 1) {
            db.prepare(`UPDATE customer_api_integrations SET ${updates.join(', ')} WHERE id = ? AND org_id = ?`).run(...params);
        }
        const row = db.prepare('SELECT * FROM customer_api_integrations WHERE id = ?').get(id);
        return res.json(rowToItem(row));
    });
    router.delete('/:id', requireAuth, requireRole('OWNER', 'ADMIN'), (req, res) => {
        const orgId = req.user.org_id;
        const id = req.params.id;
        const r = db.prepare('DELETE FROM customer_api_integrations WHERE id = ? AND org_id = ?').run(id, orgId);
        if (r.changes === 0)
            return res.status(404).json({ error: 'Not found' });
        return res.json({ ok: true });
    });
    function getRow(orgId, id) {
        return db.prepare('SELECT * FROM customer_api_integrations WHERE id = ? AND org_id = ?').get(id, orgId);
    }
    router.post('/:id/test-health', requireAuth, requireRole('OWNER', 'ADMIN'), async (req, res) => {
        const orgId = req.user.org_id;
        const id = req.params.id;
        const row = getRow(orgId, id);
        if (!row)
            return res.status(404).json({ error: 'Not found' });
        let sharedPlain = null;
        let bearerPlain = null;
        if (row.auth_type === 'HMAC' && row.shared_secret_encrypted) {
            try {
                sharedPlain = decryptSecret(row.shared_secret_encrypted);
            }
            catch {
                return res.status(500).json({ error: 'Decryption failed (check APP_ENCRYPTION_KEY)' });
            }
        }
        if (row.auth_type === 'BEARER' && row.bearer_token_encrypted) {
            try {
                bearerPlain = decryptSecret(row.bearer_token_encrypted);
            }
            catch {
                return res.status(500).json({ error: 'Decryption failed (check APP_ENCRYPTION_KEY)' });
            }
        }
        const config = buildConfig(row, sharedPlain, bearerPlain);
        const result = await testHealth(config);
        const now = nowIso();
        db.prepare(`
      UPDATE customer_api_integrations
      SET last_healthcheck_at = ?, last_healthcheck_ok = ?, last_healthcheck_status = ?, last_healthcheck_error = ?, updated_at = ?
      WHERE id = ? AND org_id = ?
    `).run(now, result.ok ? 1 : 0, result.statusCode, result.message ?? null, now, id, orgId);
        return res.json(result);
    });
    router.post('/:id/test-status', requireAuth, requireRole('OWNER', 'ADMIN'), async (req, res) => {
        const orgId = req.user.org_id;
        const id = req.params.id;
        const row = getRow(orgId, id);
        if (!row)
            return res.status(404).json({ error: 'Not found' });
        let sharedPlain = null;
        let bearerPlain = null;
        if (row.auth_type === 'HMAC' && row.shared_secret_encrypted) {
            try {
                sharedPlain = decryptSecret(row.shared_secret_encrypted);
            }
            catch {
                return res.status(500).json({ error: 'Decryption failed (check APP_ENCRYPTION_KEY)' });
            }
        }
        if (row.auth_type === 'BEARER' && row.bearer_token_encrypted) {
            try {
                bearerPlain = decryptSecret(row.bearer_token_encrypted);
            }
            catch {
                return res.status(500).json({ error: 'Decryption failed (check APP_ENCRYPTION_KEY)' });
            }
        }
        const config = buildConfig(row, sharedPlain, bearerPlain);
        const result = await testStatus(config);
        return res.json(result);
    });
    router.post('/:id/test-delete', requireAuth, requireRole('OWNER', 'ADMIN'), async (req, res) => {
        const orgId = req.user.org_id;
        const id = req.params.id;
        const body = (req.body || {});
        const row = getRow(orgId, id);
        if (!row)
            return res.status(404).json({ error: 'Not found' });
        let sharedPlain = null;
        let bearerPlain = null;
        if (row.auth_type === 'HMAC' && row.shared_secret_encrypted) {
            try {
                sharedPlain = decryptSecret(row.shared_secret_encrypted);
            }
            catch {
                return res.status(500).json({ error: 'Decryption failed (check APP_ENCRYPTION_KEY)' });
            }
        }
        if (row.auth_type === 'BEARER' && row.bearer_token_encrypted) {
            try {
                bearerPlain = decryptSecret(row.bearer_token_encrypted);
            }
            catch {
                return res.status(500).json({ error: 'Decryption failed (check APP_ENCRYPTION_KEY)' });
            }
        }
        const config = buildConfig(row, sharedPlain, bearerPlain);
        const result = await testDelete(config, body.requestId, body.subjectHash);
        return res.json(result);
    });
    router.post('/:id/rotate-secret', requireAuth, requireRole('OWNER', 'ADMIN'), (req, res) => {
        const orgId = req.user.org_id;
        const id = req.params.id;
        const row = getRow(orgId, id);
        if (!row)
            return res.status(404).json({ error: 'Not found' });
        if (row.auth_type !== 'HMAC') {
            return res.status(400).json({ error: 'rotate-secret only applies to HMAC integrations' });
        }
        if (!env.APP_ENCRYPTION_KEY || env.APP_ENCRYPTION_KEY.length < 32) {
            return res.status(400).json({ error: 'APP_ENCRYPTION_KEY required to rotate secret' });
        }
        const newSecret = generateApiSecret();
        const encrypted = encryptSecret(newSecret);
        const now = nowIso();
        db.prepare(`
      UPDATE customer_api_integrations SET shared_secret_encrypted = ?, updated_at = ? WHERE id = ? AND org_id = ?
    `).run(encrypted, now, id, orgId);
        return res.json({ sharedSecret: newSecret });
    });
    return router;
}
