import { defineConfig } from 'drizzle-kit'

const url = process.env.DATABASE_URL
if (!url) {
  throw new Error('DATABASE_URL تنظیم نشده است — apps/api/.env را بررسی کن')
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/infra/db/schema',
  out: './drizzle',
  dbCredentials: { url },
})