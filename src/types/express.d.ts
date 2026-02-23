import type { JwtPayload } from 'jsonwebtoken'

export type UserRole = 'OWNER' | 'ADMIN' | 'VIEWER'

export interface AuthUser {
  id: string
  org_id: string
  email: string
  role: UserRole
}

export interface ConnectorContext {
  connectorId: string
  orgId: string
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser
      connector?: ConnectorContext
    }
  }
}

export interface JwtPayloadUser extends JwtPayload {
  sub: string
  org_id: string
  email: string
  role: UserRole
}
