import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { env } from './env.js'
import { runMigrations } from './migrations/runner.js'

export type DB = Database.Database

export function openDb(): DB {
  const dbPath = path.resolve(process.cwd(), env.DB_PATH)
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })

  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return db
}
