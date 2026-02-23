import type Stripe from 'stripe'
import type { DB } from '../../db.js'
import { getStripe, getWebhookSecret } from './stripeClient.js'
import { nowIso, uuid } from '../../util.js'

const PROCESSED = 'processed'
const IGNORED = 'ignored'
const FAILED = 'failed'

/**
 * Persist event for idempotency. Returns true if already seen (skip processing).
 */
function ensureEvent(db: DB, eventId: string, eventType: string, payloadSanitized: string | null): boolean {
  const existing = db.prepare('SELECT 1 FROM stripe_events WHERE stripe_event_id = ?').get(eventId)
  if (existing) return true
  const id = uuid()
  db.prepare(`
    INSERT INTO stripe_events (id, stripe_event_id, event_type, status, created_at, payload_json)
    VALUES (?, ?, ?, 'pending', ?, ?)
  `).run(id, eventId, eventType, nowIso(), payloadSanitized)
  return false
}

function markEventProcessed(db: DB, eventId: string, status: 'processed' | 'ignored' | 'failed', errorMessage: string | null): void {
  db.prepare(`
    UPDATE stripe_events SET processed_at = ?, status = ?, error_message = ? WHERE stripe_event_id = ?
  `).run(nowIso(), status, errorMessage, eventId)
}

/**
 * Apply setup fee payment from checkout session: upsert payment, link lead/org, set org.setup_fee_paid_at when applicable.
 */
export function applySetupFeePaymentFromCheckoutSession(db: DB, session: Stripe.Checkout.Session): void {
  const sessionId = session.id
  if (!sessionId) return

  const metadata = session.metadata || {}
  const planId = metadata.planId || 'setup_fee_999'
  const orgId = metadata.orgId || null
  const leadId = metadata.leadId ? parseInt(metadata.leadId, 10) : null
  const email = (session.customer_email || session.customer_details?.email) ?? null
  const amountTotal = session.amount_total ?? 99900
  const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null

  const now = nowIso()
  const paymentId = sessionId + '_payment'

  const existing = db.prepare('SELECT id, status FROM billing_payments WHERE stripe_checkout_session_id = ?').get(sessionId) as { id: string; status: string } | undefined
  const status = 'paid'

  if (existing) {
    if (existing.status === status) return
    db.prepare(`
      UPDATE billing_payments SET status = ?, paid_at = ?, updated_at = ?, stripe_payment_intent_id = ?, stripe_customer_id = ?, amount_cents = ?
      WHERE stripe_checkout_session_id = ?
    `).run(status, now, now, paymentIntentId, customerId, amountTotal, sessionId)
  } else {
    db.prepare(`
      INSERT INTO billing_payments (id, org_id, lead_id, stripe_checkout_session_id, stripe_payment_intent_id, stripe_customer_id, amount_cents, currency, status, plan_id, email, company_name, metadata_json, paid_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'usd', ?, ?, ?, NULL, ?, ?, ?, ?)
    `).run(paymentId, orgId, leadId, sessionId, paymentIntentId, customerId, amountTotal, planId, email, JSON.stringify(metadata), now, now, now)
  }

  if (orgId) {
    db.prepare('UPDATE orgs SET setup_fee_paid_at = ? WHERE id = ?').run(now, orgId)
  } else if (email) {
    const orgByEmail = db.prepare(`
      SELECT o.id FROM orgs o JOIN users u ON u.org_id = o.id WHERE u.email = ? LIMIT 1
    `).get(email) as { id: string } | undefined
    if (orgByEmail) {
      db.prepare('UPDATE orgs SET setup_fee_paid_at = ? WHERE id = ?').run(now, orgByEmail.id)
      db.prepare('UPDATE billing_payments SET org_id = ? WHERE stripe_checkout_session_id = ?').run(orgByEmail.id, sessionId)
    }
  }
}

function handleCheckoutSessionCompleted(db: DB, session: Stripe.Checkout.Session): void {
  if (session.payment_status === 'paid') {
    applySetupFeePaymentFromCheckoutSession(db, session)
  }
}

function handlePaymentIntentSucceeded(db: DB, _pi: Stripe.PaymentIntent): void {
  // Payment recorded via checkout.session.completed; optional: sync status to billing_payments by payment_intent_id
}

function handlePaymentIntentPaymentFailed(db: DB, pi: Stripe.PaymentIntent): void {
  const paymentIntentId = pi.id
  const now = nowIso()
  db.prepare(`
    UPDATE billing_payments SET status = 'failed', updated_at = ? WHERE stripe_payment_intent_id = ?
  `).run(now, paymentIntentId)
}

function handleCheckoutSessionExpired(db: DB, session: Stripe.Checkout.Session): void {
  const sessionId = session.id
  if (!sessionId) return
  const now = nowIso()
  db.prepare(`
    UPDATE billing_payments SET status = 'expired', updated_at = ? WHERE stripe_checkout_session_id = ?
  `).run(now, sessionId)
}

/**
 * Verify signature and parse event (raw body).
 */
export function constructEvent(body: Buffer, signature: string | undefined): Stripe.Event {
  const stripe = getStripe()
  const secret = getWebhookSecret()
  return stripe.webhooks.constructEvent(body, signature || '', secret)
}

/**
 * Process Stripe event with idempotency. Returns 200-friendly outcome.
 */
export function handleStripeEvent(db: DB, event: Stripe.Event): { ok: boolean; alreadyProcessed: boolean } {
  const eventId = event.id
  const eventType = event.type
  const payloadSanitized = null

  const alreadyProcessed = ensureEvent(db, eventId, eventType, payloadSanitized)
  if (alreadyProcessed) {
    markEventProcessed(db, eventId, IGNORED, null)
    return { ok: true, alreadyProcessed: true }
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        handleCheckoutSessionCompleted(db, event.data.object as Stripe.Checkout.Session)
        break
      case 'payment_intent.succeeded':
        handlePaymentIntentSucceeded(db, event.data.object as Stripe.PaymentIntent)
        break
      case 'payment_intent.payment_failed':
        handlePaymentIntentPaymentFailed(db, event.data.object as Stripe.PaymentIntent)
        break
      case 'checkout.session.expired':
        handleCheckoutSessionExpired(db, event.data.object as Stripe.Checkout.Session)
        break
      default:
        break
    }
    markEventProcessed(db, eventId, PROCESSED, null)
    return { ok: true, alreadyProcessed: false }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    markEventProcessed(db, eventId, FAILED, message.slice(0, 1000))
    throw err
  }
}
