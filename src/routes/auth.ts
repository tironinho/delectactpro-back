import { Router } from 'express'
import { z } from 'zod'
import type { DB } from '../db.js'
import { uuid, nowIso } from '../util.js'
import { hashPassword, verifyPassword, signToken, requireAuth } from '../auth.js'

export function createAuthRouter(db: DB): Router {
  const signupSchema = z.object({
    orgName: z.string().min(1).max(200),
    email: z.string().email(),
    password: z.string().min(8).max(200)
  })
  const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1)
  })

  const router = Router()

  router.post('/signup', async (req, res) => {
    const parsed = signupSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues })
    }
    const { orgName, email, password } = parsed.data
    const emailLower = email.toLowerCase()
    const existing = db.prepare('SELECT 1 FROM users WHERE email = ?').get(emailLower)
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' })
    }
    const orgId = uuid()
    const userId = uuid()
    const createdAt = nowIso()
    const passwordHash = await hashPassword(password)
    db.transaction(() => {
      db.prepare(
        'INSERT INTO orgs (id, name, created_at, stripe_customer_id, setup_fee_paid_at) VALUES (?, ?, ?, NULL, NULL)'
      ).run(orgId, orgName.slice(0, 200), createdAt)
      db.prepare(
        'INSERT INTO users (id, org_id, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(userId, orgId, emailLower, passwordHash, 'OWNER', createdAt)
    })()
    const user = { id: userId, org_id: orgId, email: emailLower, role: 'OWNER' as const }
    const token = signToken(user)
    return res.status(201).json({ token, user: { id: user.id, orgId: user.org_id, email: user.email, role: user.role } })
  })

  router.post('/login', async (req, res) => {
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues })
    }
    const { email, password } = parsed.data
    const emailLower = email.toLowerCase()
    const row = db.prepare(
      'SELECT id, org_id, email, password_hash, role FROM users WHERE email = ?'
    ).get(emailLower) as { id: string; org_id: string; email: string; password_hash: string; role: string } | undefined
    if (!row) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }
    const ok = await verifyPassword(password, row.password_hash)
    if (!ok) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }
    const user = { id: row.id, org_id: row.org_id, email: row.email, role: row.role as 'OWNER' | 'ADMIN' | 'VIEWER' }
    const token = signToken(user)
    return res.json({ token, user: { id: user.id, orgId: user.org_id, email: user.email, role: user.role } })
  })

  router.get('/me', requireAuth, (req, res) => {
    const user = req.user!
    const org = db.prepare(
      'SELECT id, name, created_at, stripe_customer_id, setup_fee_paid_at FROM orgs WHERE id = ?'
    ).get(user.org_id) as { id: string; name: string; created_at: string; stripe_customer_id: string | null; setup_fee_paid_at: string | null } | undefined
    if (!org) {
      return res.status(404).json({ error: 'Org not found' })
    }
    return res.json({
      user: { id: user.id, orgId: user.org_id, email: user.email, role: user.role },
      org: { id: org.id, name: org.name, createdAt: org.created_at, stripeCustomerId: org.stripe_customer_id, setupFeePaidAt: org.setup_fee_paid_at }
    })
  })

  router.post('/logout', (_req, res) => {
    return res.json({ ok: true })
  })

  return router
}
