import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

config({
  path: process.env.NODE_ENV === 'production' ? '.env' : '.env.local',
})

export default defineConfig({
  out: './drizzle',
  schema: './src/db/schema.ts',
  dialect: 'sqlite',
  dbCredentials: {
    url:
      process.env.APP_DATABASE_PATH ??
      process.env.DATABASE_URL ??
      './data/platform.sqlite',
  },
})
