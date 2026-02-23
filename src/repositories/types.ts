/**
 * Repository interfaces for persistence abstraction.
 * Implementations: SQLite (current), Postgres/Supabase (stub for migration).
 */

export interface CustomerApiIntegrationRow {
  id: string
  org_id: string
  name: string
  base_url: string
  health_path: string
  delete_path: string
  status_path: string
  webhook_path: string | null
  auth_type: string
  shared_secret_encrypted: string | null
  bearer_token_encrypted: string | null
  headers_json: string | null
  timeout_ms: number
  retries: number
  hmac_header_name: string
  timestamp_header_name: string
  replay_window_seconds: number
  last_healthcheck_at: string | null
  last_healthcheck_ok: number | null
  last_healthcheck_status: number | null
  last_healthcheck_error: string | null
  created_at: string
  updated_at: string
}

export interface IntegrationSummaryDto {
  connectors: Array<{ id: string; name: string; lastHeartbeatAt: string | null; status: string }>
  customerApis: Array<{ id: string; name: string; lastHealthcheckAt: string | null; lastHealthcheckOk: boolean | null }>
  counts: { connectors: number; customerApis: number; total: number }
  modeDetected: 'AGENT' | 'CUSTOMER_APIS' | 'HYBRID' | 'NONE'
  lastOnlineConnectorAt: string | null
  lastHealthyCustomerApiAt: string | null
}

export interface OnboardingStepsDto {
  org: { complete: boolean; details: unknown }
  integrations: { complete: boolean; counts: { connectors: number; customerApis: number; total: number }; modeDetected: string }
  hashRecipe: { complete: boolean; activeRecipeId: string | null }
  partners: { complete: boolean; count: number }
  cascadeTargets: { complete: boolean; count: number }
  policies: { complete: boolean; count: number }
  dryRun: { complete: boolean; lastRunAt: string | null; within45Days: boolean }
  billing: { complete: boolean; setupFeePaidAt: string | null }
}

export interface CustomerApiIntegrationsRepository {
  listByOrg(orgId: string): Promise<CustomerApiIntegrationRow[]>
  getById(orgId: string, id: string): Promise<CustomerApiIntegrationRow | null>
  create(row: Omit<CustomerApiIntegrationRow, 'id'> & { id: string }): Promise<void>
  update(orgId: string, id: string, patch: Partial<CustomerApiIntegrationRow>): Promise<boolean>
  delete(orgId: string, id: string): Promise<boolean>
}

export interface IntegrationSummaryRepository {
  getSummary(orgId: string): Promise<IntegrationSummaryDto>
}

export interface OnboardingRepository {
  getStatus(orgId: string): Promise<{ steps: OnboardingStepsDto; readinessScore: number; dropReady: boolean; blockers: string[] }>
}
