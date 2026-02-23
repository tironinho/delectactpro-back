import { hashToken } from '../util.js';
/** Validates Bearer CONNECTOR_TOKEN and sets req.connector (connectorId, orgId). */
export function requireConnector(db) {
    return (req, res, next) => {
        const hdr = req.headers.authorization || '';
        const token = hdr.startsWith('Bearer ') ? hdr.slice(7).trim() : '';
        if (!token) {
            res.status(401).json({ error: 'Missing connector token' });
            return;
        }
        const tokenHash = hashToken(token);
        const row = db.prepare(`
      SELECT ct.connector_id, c.org_id
      FROM connector_tokens ct
      JOIN connectors c ON c.id = ct.connector_id
      WHERE ct.token_hash = ? AND ct.revoked_at IS NULL
    `).get(tokenHash);
        if (!row) {
            res.status(401).json({ error: 'Invalid or revoked connector token' });
            return;
        }
        req.connector = { connectorId: row.connector_id, orgId: row.org_id };
        next();
    };
}
