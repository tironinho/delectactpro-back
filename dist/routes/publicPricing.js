import { Router } from 'express';
import { SETUP_FEE_CENTS, PLAN_ID_SETUP_FEE } from '../services/stripe/checkout.js';
/**
 * GET /api/public/pricing — single source of truth for frontend pricing display.
 */
export function createPublicPricingRouter() {
    const router = Router();
    router.get('/pricing', (_req, res) => {
        return res.json({
            setupFee: {
                planId: PLAN_ID_SETUP_FEE,
                amountCents: SETUP_FEE_CENTS,
                currency: 'usd',
                label: 'Early Access Setup Fee',
                description: 'One-time implementation acceleration for SB 362 / DROP readiness.'
            },
            plans: [
                { id: PLAN_ID_SETUP_FEE, name: 'Setup Fee', amountCents: SETUP_FEE_CENTS, type: 'one_time' }
            ]
        });
    });
    return router;
}
