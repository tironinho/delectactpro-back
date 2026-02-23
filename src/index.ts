import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import Stripe from 'stripe'
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
import { requireAuth, requireAdmin, verifyToken } from './auth.js'

const app = express()

app.use(helmet({ contentSecurityPolicy: false }))
app.use(cors())
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: 'Too many requests' }
})
app.use(limiter)

const db = openDb()

// Stripe webhook must use raw body (mounted before JSON parser)
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const stripe = new Stripe(env.STRIPE_SECRET_KEY || 'sk_test_REPLACE_ME', { apiVersion: '2024-06-20' })
  const sig = req.headers['stripe-signature']
  const endpointSecret = env.STRIPE_WEBHOOK_SECRET || 'whsec_REPLACE_ME'

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(req.body as Buffer, sig as string, endpointSecret)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown'
    console.error('[webhook] signature verification failed:', message)
    return res.status(400).send(`Webhook Error: ${message}`)
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const orgId = session.metadata?.orgId
    if (orgId) {
      db.prepare('UPDATE orgs SET setup_fee_paid_at = ? WHERE id = ?').run(nowIso(), orgId)
      console.log('[webhook] checkout.session.completed, setup_fee_paid_at set for org:', orgId)
    } else {
      console.log('[webhook] checkout.session.completed:', session.id, session.metadata)
    }
  } else {
    console.log('[webhook] event:', event.type)
  }

  return res.json({ received: true })
})

app.use(express.json({ limit: '1mb' }))

app.get('/health', (_, res) => res.json({ ok: true }))

// Auth
app.use('/auth', createAuthRouter(db))

// App API (tenant-scoped via requireAuth)
app.use('/api/app/connectors', createConnectorsRouter(db))
app.use('/api/app/hash-recipes', createHashRecipesRouter(db))
app.use('/api/app/partners', createPartnersRouter(db))
app.use('/api/app/cascade', createCascadeRouter(db))
app.use('/api/app/runs', createRunsRouter(db))
app.use('/api/app/audit', createAuditRouter(db))
app.use('/api/app/dsar', createDsarRouter(db))
app.use('/api/app/billing', createBillingRouter(db))

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

// Stripe Checkout (setup fee $999). If auth: pass orgId in metadata for webhook to set setup_fee_paid_at.
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    const { planId } = (req.body || {}) as { planId?: string }
    if (planId && planId !== 'setup_fee_999') return res.status(400).json({ error: 'Unsupported planId' })

    let orgId: string | undefined
    const authHeader = req.headers.authorization
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : ''
    if (token) {
      const user = verifyToken(token)
      if (user) orgId = user.org_id
    }

    const stripe = new Stripe(env.STRIPE_SECRET_KEY || 'sk_test_REPLACE_ME', { apiVersion: '2024-06-20' })
    const metadata: Record<string, string> = { planId: 'setup_fee_999' }
    if (orgId) metadata.orgId = orgId

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'DROP Compliance Gateway — Early Access Setup Fee',
              description: 'One-time implementation acceleration for SB 362 / DROP readiness.'
            },
            unit_amount: 99900
          },
          quantity: 1
        }
      ],
      success_url: `${env.CLIENT_URL}/#pricing`,
      cancel_url: `${env.CLIENT_URL}/#pricing`,
      metadata
    })
    return res.json({ id: session.id })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Checkout session error'
    console.error('[checkout] failed:', message)
    return res.status(500).json({ error: message })
  }
})

app.listen(env.PORT, () => {
  console.log(`Backend running: http://localhost:${env.PORT}`)
})
