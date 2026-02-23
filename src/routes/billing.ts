import { Router } from 'express'
import Stripe from 'stripe'
import { env } from '../env.js'
import type { DB } from '../db.js'
import { requireAuth } from '../auth.js'

export function createBillingRouter(db: DB): Router {
  const router = Router()
  const stripe = new Stripe(env.STRIPE_SECRET_KEY || 'sk_test_REPLACE_ME', { apiVersion: '2024-06-20' })

  router.post('/portal', requireAuth, async (req, res) => {
    const orgId = req.user!.org_id
    const row = db.prepare('SELECT stripe_customer_id FROM orgs WHERE id = ?').get(orgId) as { stripe_customer_id: string | null } | undefined
    if (!row) return res.status(404).json({ error: 'Org not found' })
    let customerId = row.stripe_customer_id
    if (!customerId) {
      const org = db.prepare('SELECT name FROM orgs WHERE id = ?').get(orgId) as { name: string }
      const customer = await stripe.customers.create({
        email: req.user!.email,
        name: org?.name ?? undefined
      })
      customerId = customer.id
      db.prepare('UPDATE orgs SET stripe_customer_id = ? WHERE id = ?').run(customerId, orgId)
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${env.CLIENT_URL}/#/settings`
    })
    return res.json({ url: session.url })
  })

  return router
}
