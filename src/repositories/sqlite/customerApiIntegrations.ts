import type { DB } from '../../db.js'
import type { CustomerApiIntegrationsRepository, CustomerApiIntegrationRow } from '../types.js'

export function createCustomerApiIntegrationsRepositorySqlite(db: DB): CustomerApiIntegrationsRepository {
  return {
    async listByOrg(orgId: string): Promise<CustomerApiIntegrationRow[]> {
      const rows = db.prepare(`
        SELECT * FROM customer_api_integrations WHERE org_id = ? ORDER BY updated_at DESC
      `).all(orgId)
      return rows as CustomerApiIntegrationRow[]
    },
    async getById(orgId: string, id: string): Promise<CustomerApiIntegrationRow | null> {
      const row = db.prepare('SELECT * FROM customer_api_integrations WHERE id = ? AND org_id = ?').get(id, orgId)
      return (row as CustomerApiIntegrationRow) ?? null
    },
    async create(row: Omit<CustomerApiIntegrationRow, 'id'> & { id: string }): Promise<void> {
      db.prepare(`
        INSERT INTO customer_api_integrations (
          id, org_id, name, base_url, health_path, delete_path, status_path, webhook_path,
          auth_type, shared_secret_encrypted, bearer_token_encrypted, headers_json,
          timeout_ms, retries, hmac_header_name, timestamp_header_name, replay_window_seconds,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        row.id, row.org_id, row.name, row.base_url, row.health_path, row.delete_path, row.status_path, row.webhook_path,
        row.auth_type, row.shared_secret_encrypted, row.bearer_token_encrypted, row.headers_json,
        row.timeout_ms, row.retries, row.hmac_header_name, row.timestamp_header_name, row.replay_window_seconds,
        row.created_at, row.updated_at
      )
    },
    async update(orgId: string, id: string, patch: Partial<CustomerApiIntegrationRow>): Promise<boolean> {
      const allowed = ['name', 'base_url', 'health_path', 'delete_path', 'status_path', 'webhook_path', 'auth_type',
        'shared_secret_encrypted', 'bearer_token_encrypted', 'headers_json', 'timeout_ms', 'retries',
        'hmac_header_name', 'timestamp_header_name', 'replay_window_seconds', 'last_healthcheck_at', 'last_healthcheck_ok',
        'last_healthcheck_status', 'last_healthcheck_error', 'updated_at']
      const updates: string[] = []
      const params: unknown[] = []
      for (const [k, v] of Object.entries(patch)) {
        const snake = k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
        if (allowed.includes(snake) && v !== undefined) {
          updates.push(`${snake} = ?`)
          params.push(v)
        }
      }
      if (updates.length === 0) return true
      params.push(id, orgId)
      const r = db.prepare(`UPDATE customer_api_integrations SET ${updates.join(', ')} WHERE id = ? AND org_id = ?`).run(...params)
      return r.changes > 0
    },
    async delete(orgId: string, id: string): Promise<boolean> {
      const r = db.prepare('DELETE FROM customer_api_integrations WHERE id = ? AND org_id = ?').run(id, orgId)
      return r.changes > 0
    }
  }
}
