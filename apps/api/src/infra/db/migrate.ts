//src/infra/db/migrate.ts
/**
 * اجراکننده‌ی مهاجرت‌ها — همان درایورِ خود اپ (Bun.sql)، بدون ابزار اضافه.
 *
 *   bun run db:generate  # drizzle-kit (محلی): اسکیما → ./drizzle
 *   bun run db:migrate   # همین اسکریپت: اعمال روی دیتابیس
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