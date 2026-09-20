//src/infra/db/migrate.ts
/**
 * Migration runner — same driver as the app (Bun.sql), no extra tooling.
 *
 *   bun run db:generate  # drizzle-kit (local): schema → ./drizzle
 *   bun run db:migrate   # this script: apply to the database
 */
import { migrate } from 'drizzle-orm/bun-sql/migrator'

import { AppConfig } from '#/infra/config/env'
import { Database } from '#/infra/db/client'

const config = new AppConfig()
const database = new Database(config.databaseUrl, { max: 2 })

const t0 = performance.now()
await migrate(database.db, { migrationsFolder: './drizzle' })
console.log(`[db] migrations applied in ${(performance.now() - t0).toFixed(0)}ms`)
await database.close()