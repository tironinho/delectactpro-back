import { Router } from 'express';
import { requireAuth, requireRole } from '../auth.js';
const FORTY_FIVE_DAYS_MS = 45 * 24 * 60 * 60 * 1000;
/** GET /api/app/onboarding/status — readiness summary and blockers. */
export function createOnboardingRouter(db) {
    const router = Router();
    router.get('/status', requireAuth, (req, res) => {
        const orgId = req.user.org_id;
        const org = db.prepare('SELECT id, name, setup_fee_paid_at FROM orgs WHERE id = ?').get(orgId);
        const connectors = db.prepare('SELECT id, last_heartbeat_at FROM connectors WHERE org_id = ?').all(orgId);
        const customerApis = db.prepare('SELECT id, last_healthcheck_at, last_healthcheck_ok FROM customer_api_integrations WHERE org_id = ?').all(orgId);
        const hashRecipe = db.prepare('SELECT id FROM hash_recipes WHERE org_id = ? AND active = 1').get(orgId);
        const partners = db.prepare('SELECT id FROM partners WHERE org_id = ?').all(orgId);
        const targets = db.prepare('SELECT id FROM partner_targets WHERE org_id = ?').all(orgId);
        const legacyPolicies = db.prepare('SELECT id FROM cascade_policies WHERE org_id = ?').all(orgId);
        const v2Policies = db.prepare('SELECT id FROM cascade_policies_v2 WHERE org_id = ?').all(orgId);
        const lastRun = db.prepare(`
      SELECT id, ended_at, status FROM runs WHERE org_id = ? AND status = 'COMPLETED' ORDER BY ended_at DESC LIMIT 1
    `).get(orgId);
        const orgComplete = !!org;
        const connectorCount = connectors.length;
        const customerApiCount = customerApis.length;
        const totalIntegrations = connectorCount + customerApiCount;
        let modeDetected = 'NONE';
        if (connectorCount > 0 && customerApiCount > 0)
            modeDetected = 'HYBRID';
        else if (connectorCount > 0)
            modeDetected = 'AGENT';
        else if (customerApiCount > 0)
            modeDetected = 'CUSTOMER_APIS';
        const integrationsComplete = totalIntegrations > 0;
        const hashRecipeComplete = !!hashRecipe;
        const partnersComplete = partners.length > 0;
        const cascadeTargetsComplete = targets.length > 0 || legacyPolicies.length > 0;
        const policiesComplete = legacyPolicies.length > 0 || v2Policies.length > 0;
        const lastRunAt = lastRun?.ended_at ?? null;
        const lastRunAtMs = lastRunAt ? new Date(lastRunAt).getTime() : 0;
        const within45Days = lastRunAtMs > 0 && (Date.now() - lastRunAtMs) <= FORTY_FIVE_DAYS_MS;
        const dryRunComplete = !!lastRun && within45Days;
        const billingComplete = !!(org?.setup_fee_paid_at);
        const steps = {
            org: { complete: orgComplete, details: org ? { name: org.name } : null },
            integrations: { complete: integrationsComplete, counts: { connectors: connectorCount, customerApis: customerApiCount, total: totalIntegrations }, modeDetected },
            hashRecipe: { complete: hashRecipeComplete, activeRecipeId: hashRecipe?.id ?? null },
            partners: { complete: partnersComplete, count: partners.length },
            cascadeTargets: { complete: cascadeTargetsComplete, count: targets.length + legacyPolicies.length },
            policies: { complete: policiesComplete, count: legacyPolicies.length + v2Policies.length },
            dryRun: { complete: dryRunComplete, lastRunAt, within45Days },
            billing: { complete: billingComplete, setupFeePaidAt: org?.setup_fee_paid_at ?? null }
        };
        const stepKeys = Object.keys(steps);
        const completed = stepKeys.filter((k) => steps[k].complete).length;
        const readinessScore = stepKeys.length > 0 ? Math.round((completed / stepKeys.length) * 100) : 0;
        const blockers = [];
        if (!orgComplete)
            blockers.push('Organization not set');
        if (!integrationsComplete)
            blockers.push('At least one integration (connector or customer API) required');
        if (!hashRecipeComplete)
            blockers.push('No active hash recipe');
        if (!partnersComplete)
            blockers.push('At least one partner required');
        if (!policiesComplete)
            blockers.push('At least one cascade policy required');
        if (!dryRunComplete)
            blockers.push('Complete a dry run within the last 45 days');
        if (!billingComplete)
            blockers.push('Setup fee not paid');
        const dropReady = blockers.length === 0;
        return res.json({
            steps,
            readinessScore,
            dropReady,
            blockers
        });
    });
    router.post('/validate', requireAuth, (req, res) => {
        const orgId = req.user.org_id;
        const org = db.prepare('SELECT id FROM orgs WHERE id = ?').get(orgId);
        const connectors = db.prepare('SELECT id FROM connectors WHERE org_id = ?').all(orgId);
        const customerApis = db.prepare('SELECT id FROM customer_api_integrations WHERE org_id = ?').all(orgId);
        const hashRecipe = db.prepare('SELECT id FROM hash_recipes WHERE org_id = ? AND active = 1').get(orgId);
        const policies = db.prepare('SELECT id FROM cascade_policies WHERE org_id = ?').all(orgId);
        const v2Policies = db.prepare('SELECT id FROM cascade_policies_v2 WHERE org_id = ?').all(orgId);
        const lastRun = db.prepare(`
      SELECT ended_at FROM runs WHERE org_id = ? AND status = 'COMPLETED' ORDER BY ended_at DESC LIMIT 1
    `).get(orgId);
        const setupFee = db.prepare('SELECT setup_fee_paid_at FROM orgs WHERE id = ?').get(orgId);
        const valid = !!org &&
            (connectors.length > 0 || customerApis.length > 0) &&
            !!hashRecipe &&
            (policies.length > 0 || v2Policies.length > 0) &&
            !!lastRun?.ended_at &&
            (Date.now() - new Date(lastRun.ended_at).getTime()) <= FORTY_FIVE_DAYS_MS &&
            !!setupFee?.setup_fee_paid_at;
        const daysSinceLastRun = lastRun?.ended_at
            ? Math.floor((Date.now() - new Date(lastRun.ended_at).getTime()) / (24 * 60 * 60 * 1000))
            : null;
        return res.json({
            valid,
            daysSinceLastRun,
            within45Days: daysSinceLastRun != null && daysSinceLastRun <= 45
        });
    });
    router.post('/mark-ready', requireAuth, requireRole('OWNER', 'ADMIN'), (req, res) => {
        const orgId = req.user.org_id;
        const org = db.prepare('SELECT id FROM orgs WHERE id = ?').get(orgId);
        if (!org)
            return res.status(404).json({ error: 'Org not found' });
        const validate = db.prepare(`
      SELECT ended_at FROM runs WHERE org_id = ? AND status = 'COMPLETED' ORDER BY ended_at DESC LIMIT 1
    `).get(orgId);
        const daysSinceLastRun = validate?.ended_at
            ? Math.floor((Date.now() - new Date(validate.ended_at).getTime()) / (24 * 60 * 60 * 1000))
            : null;
        if (daysSinceLastRun == null || daysSinceLastRun > 45) {
            return res.status(400).json({
                error: 'Cannot mark ready: complete a dry run within the last 45 days first'
            });
        }
        return res.json({ ok: true, message: 'Readiness criteria met' });
    });
    return router;
}
