import dotenv from 'dotenv';
dotenv.config();
export const env = {
    PORT: Number(process.env.PORT || 4242),
    CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:5173',
    ADMIN_TOKEN: process.env.ADMIN_TOKEN || 'dev_admin_token_change_me',
    DB_PATH: process.env.DB_PATH || './data/app.db',
    JWT_SECRET: process.env.JWT_SECRET || 'dev_jwt_secret_change_me',
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || '',
    /** Optional: use Stripe Price ID instead of inline price_data for setup fee */
    STRIPE_SETUP_FEE_PRICE_ID: process.env.STRIPE_SETUP_FEE_PRICE_ID || '',
    /** Frontend app URL (success/cancel redirects). Default CLIENT_URL. */
    APP_URL: process.env.APP_URL || process.env.CLIENT_URL || 'http://localhost:5173',
    /** API base URL (if different from origin). Optional. */
    API_BASE_URL: process.env.API_BASE_URL || '',
    /** Required for HMAC/BEARER customer APIs. If missing, creation of integrations with auth will fail. */
    APP_ENCRYPTION_KEY: process.env.APP_ENCRYPTION_KEY || '',
    /** sqlite (default) | postgres. Enables Postgres adapter when set. */
    DB_PROVIDER: (process.env.DB_PROVIDER || 'sqlite'),
    /** Postgres connection string when DB_PROVIDER=postgres */
    DATABASE_URL: process.env.DATABASE_URL || ''
};
