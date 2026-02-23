import Stripe from 'stripe'
import { env } from '../../env.js'

const API_VERSION = '2024-06-20' as const

let stripeInstance: Stripe | null = null

/**
 * Shared Stripe client. Use for checkout, portal, webhooks verification.
 * Future: subscriptions, invoices, customer portal.
 */
export function getStripe(): Stripe {
  if (!stripeInstance) {
    const key = env.STRIPE_SECRET_KEY || 'sk_test_REPLACE_ME'
    stripeInstance = new Stripe(key, { apiVersion: API_VERSION })
  }
  return stripeInstance
}

export function getWebhookSecret(): string {
  return env.STRIPE_WEBHOOK_SECRET || 'whsec_REPLACE_ME'
}
