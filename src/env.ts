import dotenv from 'dotenv'
dotenv.config()

export const env = {
  PORT: Number(process.env.PORT || 4242),
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:5173',
  ADMIN_TOKEN: process.env.ADMIN_TOKEN || 'dev_admin_token_change_me',
  DB_PATH: process.env.DB_PATH || './data/app.db',
  JWT_SECRET: process.env.JWT_SECRET || 'dev_jwt_secret_change_me',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || ''
}
