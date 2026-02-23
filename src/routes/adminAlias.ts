import { Router } from 'express'
import type { DB } from '../db.js'
import { requireAuth, requireRole } from '../auth.js'
import { dispatchTest } from './cascade.js'

/** Alias: POST /api/app/admin/dispatch -> same as POST /api/app/cascade/dispatch-test. requestId required. */
export function createAdminAliasRouter(db: DB): Router {
  const router = Router()

  router.post('/dispatch', requireAuth, requireRole('OWNER', 'ADMIN'), (req, res) => {
    const body = req.body as { requestId?: string }
    const requestId = body?.requestId
    if (!requestId || typeof requestId !== 'string') {
      return res.status(400).json({
        error: 'requestId is required',
        message: 'Provide requestId in the request body to dispatch cascade test (e.g. { "requestId": "<deletion_request_id>" })'
      })
    }
    const orgId = req.user!.org_id
    const result = dispatchTest(db, orgId, requestId, req.user!.id)
    if (!result.success) {
      return res.status(result.status).json({ error: result.error })
    }
    return res.json({ ok: true, tasksCreated: result.tasksCreated })
  })

  return router
}
