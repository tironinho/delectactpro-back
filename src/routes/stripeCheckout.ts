import { Router } from 'express'
import { createCheckoutSession } from '../services/stripe/checkout.js'
import { createCheckoutSessionSchema } from '../schemas/checkout.js'
import { verifyToken } from '../auth.js'
import { maskEmail } from '../util.js'

/**
 * POST /api/create-checkout-session
 * Creates Stripe Checkout Session (setup fee). Optional JWT for orgId.
 */
export function createStripeCheckoutRouter(): Router {
  const router = Router()

  router.post('/', async (req, res) => {
    const parsed = createCheckoutSessionSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues })
    }

    let orgId: string | undefined
    const authHeader = req.headers.authorization
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : ''
    if (token) {
      const user = verifyToken(token)
      if (user) orgId = user.org_id
    }

    const leadId = parsed.data.leadId != null ? String(parsed.data.leadId) : undefined
    try {
      const result = await createCheckoutSession({
        planId: parsed.data.planId,
        email: parsed.data.email,
        companyName: parsed.data.companyName,
        leadId,
        sourcePage: parsed.data.sourcePage,
        referrer: parsed.data.referrer,
        utm: parsed.data.utm,
        orgId
      })
      const correlationId = req.correlationId
      if (parsed.data.email && correlationId) {
        console.log('[checkout] session created', { sessionId: result.id, correlationId, email: maskEmail(parsed.data.email) })
      }
      return res.json({ id: result.id, url: result.url ?? undefined })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Checkout session error'
      console.error('[checkout] failed:', message)
      return res.status(500).json({ error: message })
    }
  })

  return router
}
