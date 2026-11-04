import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import { getServerEnv } from '#/server/env.server'

import * as schema from './schema.ts'

export function createDatabase(path: string) {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true })
  }

  const sqlite = new Database(path)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')

  return drizzle(sqlite, { schema })
}

let database: ReturnType<typeof createDatabase> | undefined

export function getDatabase(): ReturnType<typeof createDatabase> {
  database ??= createDatabase(getServerEnv().APP_DATABASE_PATH)
  return database
}
