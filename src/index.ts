import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { env } from './env.js'
import { openDb } from './db.js'
import { nowIso } from './util.js'
import { createAuthRouter } from './routes/auth.js'
import { createConnectorsRouter } from './routes/connectors.js'
import { createHashRecipesRouter } from './routes/hashRecipes.js'
import { createPartnersRouter } from './routes/partners.js'
import { createCascadeRouter } from './routes/cascade.js'
import { createRunsRouter } from './routes/runs.js'
import { createAuditRouter } from './routes/audit.js'
import { createDsarRouter } from './routes/dsar.js'
import { createBillingRouter } from './routes/billing.js'
import { createConnectorAgentRouter } from './routes/connectorAgent.js'
import { createCustomerApisRouter } from './routes/customerApis.js'
import { createIntegrationsRouter } from './routes/integrations.js'
import { createCascadePoliciesAliasRouter } from './routes/cascadePoliciesAlias.js'
import { createAdminAliasRouter } from './routes/adminAlias.js'
import { createOnboardingRouter } from './routes/onboarding.js'
import { createHashMatchRouter } from './routes/hashMatch.js'
import { createStripeCheckoutRouter } from './routes/stripeCheckout.js'
import { createPublicPricingRouter } from './routes/publicPricing.js'
import { requireAdmin } from './auth.js'
import { correlationId } from './middleware/correlationId.js'
import { constructEvent, handleStripeEvent } from './services/stripe/webhooks.js'

const app = express()

app.use(helmet({ contentSecurityPolicy: false }))
app.use(cors())
app.use(correlationId)
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: 'Too many requests' }
})
app.use(limiter)

const db = openDb()

const stripeWebhookHandler = (req: express.Request, res: express.Response): void => {
  const sig = req.headers['stripe-signature']
  let event
  try {
    event = constructEvent(req.body as Buffer, sig as string)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown'
    console.error('[webhook] signature verification failed')
    res.status(400).send(`Webhook Error: ${message}`)
    return
  }
  const correlationIdVal = req.correlationId
  try {
    const { ok, alreadyProcessed } = handleStripeEvent(db, event)
    if (correlationIdVal) console.log('[webhook]', { stripeEventId: event.id, type: event.type, alreadyProcessed, correlationId: correlationIdVal })
    res.status(200).json({ received: true, id: event.id })
  } catch (err) {
    console.error('[webhook] processing failed', { stripeEventId: event.id, type: event.type, correlationId: correlationIdVal })
    res.status(500).json({ error: 'Webhook processing failed' })
  }
}

app.post('/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler)
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler)

app.use(express.json({ limit: '1mb' }))

const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { error: 'Too many checkout attempts' }
})
app.use('/api/create-checkout-session', checkoutLimiter, createStripeCheckoutRouter())

app.get('/health', (_, res) => res.json({ ok: true }))

// Auth
app.use('/auth', createAuthRouter(db))

// App API (tenant-scoped via requireAuth)
app.use('/api/app/connectors', createConnectorsRouter(db))
app.use('/api/app/hash-recipes', createHashRecipesRouter(db))
app.use('/api/app/partners', createPartnersRouter(db))
app.use('/api/app/cascade', createCascadeRouter(db))
app.use('/api/app/customer-apis', createCustomerApisRouter(db))
app.use('/api/app/integrations', createIntegrationsRouter(db))
app.use('/api/app/cascade-policies', createCascadePoliciesAliasRouter(db))
app.use('/api/app/admin', createAdminAliasRouter(db))
app.use('/api/app/onboarding', createOnboardingRouter(db))
app.use('/api/app/hash-match', createHashMatchRouter(db))
app.use('/api/app/runs', createRunsRouter(db))
app.use('/api/app/audit', createAuditRouter(db))
app.use('/api/app/dsar', createDsarRouter(db))
app.use('/api/app/billing', createBillingRouter(db))
app.use('/api/public', createPublicPricingRouter())

// Connector Agent API (Bearer connector token)
app.use('/api/connector', createConnectorAgentRouter(db))

// Public leads (early access)
app.post('/api/leads', (req, res) => {
  const { email, company, role, source } = (req.body || {}) as { email?: string; company?: string; role?: string; source?: string }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email is required' })
  }
  db.prepare(`
    INSERT INTO leads (email, company, role, source, created_at)
    VALUES (@email, @company, @role, @source, @created_at)
    ON CONFLICT(email) DO UPDATE SET company=excluded.company, role=excluded.role, source=excluded.source
  `).run({
    email: email.toLowerCase(),
    company: company?.slice(0, 200) || null,
    role: role?.slice(0, 200) || null,
    source: source?.slice(0, 100) || 'landing',
    created_at: nowIso()
  })
  return res.json({ ok: true })
})

// Legacy admin leads (Bearer ADMIN_TOKEN or JWT OWNER/ADMIN)
app.get('/api/admin/leads', requireAdmin, (_, res) => {
  const rows = db.prepare('SELECT id, email, company, role, source, created_at FROM leads ORDER BY id DESC LIMIT 200').all()
  return res.json({ items: rows })
})

app.listen(env.PORT, () => {
  console.log(`Backend running: http://localhost:${env.PORT}`)
})
