import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

describe('production database migration', () => {
  it('creates the platform schema in an empty SQLite database', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-migrate-test-'))
    const databasePath = join(root, 'platform.sqlite')
    try {
      const { migrateDatabase } =
        require('../../../scripts/migrate-database.cjs') as {
          migrateDatabase: (input: {
            databasePath: string
            migrationsFolder: string
          }) => void
        }

      migrateDatabase({
        databasePath,
        migrationsFolder: join(process.cwd(), 'drizzle'),
      })

      const sqlite = new Database(databasePath, { readonly: true })
      try {
        expect(
          sqlite
            .prepare(
              "select name from sqlite_master where type = 'table' and name = 'users'",
            )
            .get(),
        ).toEqual({ name: 'users' })
      } finally {
        sqlite.close()
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
