/**
 * Stub Postgres/Supabase repository implementations.
 * TODO: When migrating to Supabase/Postgres, implement using pg pool and DATABASE_URL.
 * See env.DB_PROVIDER and env.DATABASE_URL. Do not depend on auth.users in SQLite flow.
 */

import type { CustomerApiIntegrationsRepository, CustomerApiIntegrationRow, IntegrationSummaryDto, IntegrationSummaryRepository, OnboardingRepository, OnboardingStepsDto } from '../types.js'

export function createCustomerApiIntegrationsRepositoryPostgres(/* pool: Pool */): CustomerApiIntegrationsRepository {
  return {
    async listByOrg(_orgId: string): Promise<CustomerApiIntegrationRow[]> {
      throw new Error('Postgres adapter not implemented; use DB_PROVIDER=sqlite')
    },
    async getById(_orgId: string, _id: string): Promise<CustomerApiIntegrationRow | null> {
      throw new Error('Postgres adapter not implemented; use DB_PROVIDER=sqlite')
    },
    async create(_row: Omit<CustomerApiIntegrationRow, 'id'> & { id: string }): Promise<void> {
      throw new Error('Postgres adapter not implemented; use DB_PROVIDER=sqlite')
    },
    async update(_orgId: string, _id: string, _patch: Partial<CustomerApiIntegrationRow>): Promise<boolean> {
      throw new Error('Postgres adapter not implemented; use DB_PROVIDER=sqlite')
    },
    async delete(_orgId: string, _id: string): Promise<boolean> {
      throw new Error('Postgres adapter not implemented; use DB_PROVIDER=sqlite')
    }
  }
}

export function createIntegrationSummaryRepositoryPostgres(/* pool: Pool */): IntegrationSummaryRepository {
  return {
    async getSummary(_orgId: string): Promise<IntegrationSummaryDto> {
      throw new Error('Postgres adapter not implemented; use DB_PROVIDER=sqlite')
    }
  }
}

export function createOnboardingRepositoryPostgres(/* pool: Pool */): OnboardingRepository {
  return {
    async getStatus(_orgId: string): Promise<{ steps: OnboardingStepsDto; readinessScore: number; dropReady: boolean; blockers: string[] }> {
      throw new Error('Postgres adapter not implemented; use DB_PROVIDER=sqlite')
    }
  }
}
