import { Router } from 'express';
import { requireAuth } from '../auth.js';
/**
 * GET /api/app/integrations/summary
 * Returns connectors, customerApis, counts, modeDetected, lastOnlineConnectorAt, lastHealthyCustomerApiAt.
 */
export function createIntegrationsRouter(db) {
    const router = Router();
    router.get('/summary', requireAuth, (req, res) => {
        const orgId = req.user.org_id;
        const connectors = db.prepare(`
      SELECT id, name, last_heartbeat_at, status
      FROM connectors WHERE org_id = ? ORDER BY last_heartbeat_at DESC
    `).all(orgId);
        const customerApis = db.prepare(`
      SELECT id, name, last_healthcheck_at, last_healthcheck_ok
      FROM customer_api_integrations WHERE org_id = ? ORDER BY last_healthcheck_at DESC
    `).all(orgId);
        const connectorCount = connectors.length;
        const customerApiCount = customerApis.length;
        const total = connectorCount + customerApiCount;
        let modeDetected = 'NONE';
        if (connectorCount > 0 && customerApiCount > 0)
            modeDetected = 'HYBRID';
        else if (connectorCount > 0)
            modeDetected = 'AGENT';
        else if (customerApiCount > 0)
            modeDetected = 'CUSTOMER_APIS';
        const lastOnlineConnectorAt = connectors.find((c) => c.last_heartbeat_at)?.last_heartbeat_at ?? null;
        const lastHealthy = customerApis.filter((c) => c.last_healthcheck_ok === 1);
        const lastHealthyCustomerApiAt = lastHealthy.length > 0
            ? lastHealthy.reduce((a, c) => (c.last_healthcheck_at && (!a || c.last_healthcheck_at > a) ? c.last_healthcheck_at : a), null)
            : null;
        return res.json({
            connectors: connectors.map((c) => ({
                id: c.id,
                name: c.name,
                lastHeartbeatAt: c.last_heartbeat_at,
                status: c.status
            })),
            customerApis: customerApis.map((c) => ({
                id: c.id,
                name: c.name,
                lastHealthcheckAt: c.last_healthcheck_at,
                lastHealthcheckOk: c.last_healthcheck_ok == null ? null : Boolean(c.last_healthcheck_ok)
            })),
            counts: { connectors: connectorCount, customerApis: customerApiCount, total },
            modeDetected,
            lastOnlineConnectorAt,
            lastHealthyCustomerApiAt
        });
    });
    return router;
}
