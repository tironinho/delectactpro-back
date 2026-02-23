import { env } from '../../env.js';
import { getStripe } from './stripeClient.js';
const SETUP_FEE_CENTS = 99900;
const PLAN_ID_SETUP_FEE = 'setup_fee_999';
/**
 * Create Stripe Checkout Session for one-time payment (setup fee).
 * Prefers STRIPE_SETUP_FEE_PRICE_ID if set; otherwise uses price_data inline.
 */
export async function createCheckoutSession(params) {
    const stripe = getStripe();
    const appUrl = env.APP_URL.replace(/\/$/, '');
    const metadata = {
        planId: params.planId,
        ...(params.leadId && { leadId: String(params.leadId) }),
        ...(params.sourcePage && { sourcePage: params.sourcePage.slice(0, 200) }),
        ...(params.orgId && { orgId: params.orgId }),
        ...(params.utm?.source && { utm_source: params.utm.source.slice(0, 100) }),
        ...(params.utm?.medium && { utm_medium: params.utm.medium.slice(0, 100) }),
        ...(params.utm?.campaign && { utm_campaign: params.utm.campaign.slice(0, 100) }),
        ...(params.utm?.term && { utm_term: params.utm.term.slice(0, 100) }),
        ...(params.utm?.content && { utm_content: params.utm.content.slice(0, 100) })
    };
    const lineItems = env.STRIPE_SETUP_FEE_PRICE_ID
        ? [{ price: env.STRIPE_SETUP_FEE_PRICE_ID, quantity: 1 }]
        : [
            {
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: 'DROP Compliance Gateway — Early Access Setup Fee',
                        description: 'One-time implementation acceleration for SB 362 / DROP readiness.'
                    },
                    unit_amount: SETUP_FEE_CENTS
                },
                quantity: 1
            }
        ];
    const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: lineItems,
        success_url: `${appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl}/billing/cancel`,
        customer_email: params.email?.slice(0, 254) || undefined,
        metadata,
        allow_promotion_codes: false
    });
    return {
        id: session.id,
        url: session.url ?? null
    };
}
export { PLAN_ID_SETUP_FEE, SETUP_FEE_CENTS };
