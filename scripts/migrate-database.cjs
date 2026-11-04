const { mkdirSync } = require('node:fs')
const { dirname, resolve } = require('node:path')

const Database = require('better-sqlite3')
const { drizzle } = require('drizzle-orm/better-sqlite3')
const { migrate } = require('drizzle-orm/better-sqlite3/migrator')

function migrateDatabase({ databasePath, migrationsFolder }) {
  if (!databasePath) {
    throw new Error('APP_DATABASE_PATH is required')
  }
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(resolve(databasePath)), { recursive: true })
  }
  const sqlite = new Database(databasePath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
  try {
    migrate(drizzle(sqlite), {
      migrationsFolder: resolve(migrationsFolder),
    })
  } finally {
    sqlite.close()
  }
}

if (require.main === module) {
  migrateDatabase({
    databasePath: process.env.APP_DATABASE_PATH,
    migrationsFolder: resolve(__dirname, '..', 'drizzle'),
  })
  console.log('Database migrations applied successfully.')
}

module.exports = { migrateDatabase }
