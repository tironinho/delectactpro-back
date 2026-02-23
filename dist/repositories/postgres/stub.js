/**
 * Stub Postgres/Supabase repository implementations.
 * TODO: When migrating to Supabase/Postgres, implement using pg pool and DATABASE_URL.
 * See env.DB_PROVIDER and env.DATABASE_URL. Do not depend on auth.users in SQLite flow.
 */
export function createCustomerApiIntegrationsRepositoryPostgres( /* pool: Pool */) {
    return {
        async listByOrg(_orgId) {
            throw new Error('Postgres adapter not implemented; use DB_PROVIDER=sqlite');
        },
        async getById(_orgId, _id) {
            throw new Error('Postgres adapter not implemented; use DB_PROVIDER=sqlite');
        },
        async create(_row) {
            throw new Error('Postgres adapter not implemented; use DB_PROVIDER=sqlite');
        },
        async update(_orgId, _id, _patch) {
            throw new Error('Postgres adapter not implemented; use DB_PROVIDER=sqlite');
        },
        async delete(_orgId, _id) {
            throw new Error('Postgres adapter not implemented; use DB_PROVIDER=sqlite');
        }
    };
}
export function createIntegrationSummaryRepositoryPostgres( /* pool: Pool */) {
    return {
        async getSummary(_orgId) {
            throw new Error('Postgres adapter not implemented; use DB_PROVIDER=sqlite');
        }
    };
}
export function createOnboardingRepositoryPostgres( /* pool: Pool */) {
    return {
        async getStatus(_orgId) {
            throw new Error('Postgres adapter not implemented; use DB_PROVIDER=sqlite');
        }
    };
}
