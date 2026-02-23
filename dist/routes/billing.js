import { Router } from 'express';
import { env } from '../env.js';
import { requireAuth } from '../auth.js';
import { getStripe } from '../services/stripe/stripeClient.js';
import { SETUP_FEE_CENTS, PLAN_ID_SETUP_FEE } from '../services/stripe/checkout.js';
export function createBillingRouter(db) {
    const router = Router();
    router.post('/portal', requireAuth, async (req, res) => {
        const stripe = getStripe();
        const orgId = req.user.org_id;
        const row = db.prepare('SELECT stripe_customer_id FROM orgs WHERE id = ?').get(orgId);
        if (!row)
            return res.status(404).json({ error: 'Org not found' });
        let customerId = row.stripe_customer_id;
        if (!customerId) {
            const org = db.prepare('SELECT name FROM orgs WHERE id = ?').get(orgId);
            const customer = await stripe.customers.create({
                email: req.user.email,
                name: org?.name ?? undefined
            });
            customerId = customer.id;
            db.prepare('UPDATE orgs SET stripe_customer_id = ? WHERE id = ?').run(customerId, orgId);
        }
        const session = await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: `${env.CLIENT_URL}/#/settings`
        });
        return res.json({ url: session.url });
    });
    /** GET /api/billing/checkout-session/:sessionId — status for success page (no auth; sessionId is the key). */
    router.get('/checkout-session/:sessionId', async (req, res) => {
        const sessionId = req.params.sessionId?.trim();
        if (!sessionId)
            return res.status(400).json({ error: 'sessionId required' });
        const row = db.prepare(`
      SELECT stripe_checkout_session_id, amount_cents, currency, status, plan_id, email, created_at
      FROM billing_payments WHERE stripe_checkout_session_id = ?
    `).get(sessionId);
        if (row) {
            const paymentStatus = row.status === 'paid' ? 'paid' : row.status === 'failed' || row.status === 'expired' ? 'unpaid' : 'unpaid';
            const status = row.status === 'paid' ? 'complete' : row.status === 'expired' ? 'expired' : 'open';
            return res.json({
                sessionId: row.stripe_checkout_session_id,
                status,
                paymentStatus,
                planId: row.plan_id,
                amountCents: row.amount_cents,
                currency: row.currency,
                customerEmail: row.email ?? undefined,
                createdAt: row.created_at
            });
        }
        const stripe = getStripe();
        try {
            const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['payment_intent'] });
            const status = session.status === 'complete' ? 'complete' : session.status === 'expired' ? 'expired' : 'open';
            const paymentStatus = session.payment_status === 'paid' ? 'paid' : session.payment_status === 'unpaid' ? 'unpaid' : 'no_payment_required';
            return res.json({
                sessionId: session.id,
                status,
                paymentStatus,
                planId: session.metadata?.planId || PLAN_ID_SETUP_FEE,
                amountCents: session.amount_total ?? SETUP_FEE_CENTS,
                currency: (session.currency ?? 'usd').toLowerCase(),
                customerEmail: session.customer_email ?? session.customer_details?.email ?? undefined,
                createdAt: session.created ? new Date(session.created * 1000).toISOString() : undefined
            });
        }
        catch {
            return res.status(404).json({ error: 'Session not found' });
        }
    });
    return router;
}
