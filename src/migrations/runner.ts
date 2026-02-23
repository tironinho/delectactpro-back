import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export type DB = Database.Database

/**
 * Creates schema_migrations table and runs all *.sql files in migrations/ in order.
 * Called at startup after openDb().
 */
export function runMigrations(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `)

  const migrationsDir = __dirname
  if (!fs.existsSync(migrationsDir)) {
    return
  }

  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
  for (const file of files) {
    const version = file.replace(/\.sql$/, '')
    const existing = db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(version)
    if (existing) continue

    const sql = fs.readFileSync(path.join(__dirname, file), 'utf-8')
    db.exec(sql)
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
      version,
      new Date().toISOString()
    )
    console.log('[migrations] applied:', version)
  }
}
