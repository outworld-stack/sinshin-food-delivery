// ═══════════════════════════════════════════════════════════════
// round-36 — sinshin-food-delivery — فایل 7 از 14
// مسیر مقصد: apps/api/scripts/normalize-jsonb.ts
// وضعیت: فایل جدید — پوشه را در صورت نیاز بسازید
// کامیت پیشنهادی: stage thirty two
// ═══════════════════════════════════════════════════════════════

// apps/api/scripts/normalize-jsonb.ts
/**
 * round-36 — یکدست‌سازی ستون‌های jsonb (اسکریپت یک‌باره و idempotent).
 *
 * پیشینه: تا قبل از وصله‌ی client.ts (رارد ۳۶)، درایور drizzle/bun-sql
 * مقدار آرایه/شیء را «دوبار انکد» می‌کرد — یعنی به‌جای jsonb آرایه‌ای
 * مثل ["پنیر","قارچ"]، رشته‌ی jsonb "[\"پنیر\",\"قارچ\"]" ذخیره می‌شد.
 * خواندن از طریق API متقارن (پارس دوباره) بود و برنامه کار می‌کرد، اما:
 *   • کوئری‌های SQL-سطحی (jsonb_array_length) خطا می‌دادند؛
 *   • داده در DB ناهمگون بود (ردیف‌های پیش‌فرض آرایه، ردیف‌های نوشته‌شده رشته).
 *
 * این اسکریپت همه‌ی ستون‌های jsonb آرایه‌ای/شیء‌دارِ دوبار-انکد را یک‌بار
 * باز می‌کند (رشته → مقدار واقعی). ردیف‌های سالم دست نمی‌خورند. idempotent.
 *
 * اجرا:  cd apps/api && DATABASE_URL=postgres://... bun run scripts/normalize-jsonb.ts
 */
import { sql } from 'drizzle-orm'
import { Database } from '#/infra/db/client'

/** ستون‌های (جدول، ستون) که «آرایه» هستند — رشته‌ی دوبار-انکدِ داخلشان دوباره باز می‌شود */
const ARRAY_COLUMNS: Array<[table: string, column: string]> = [
        ['products', 'ingredients'],
        ['products', 'ingredients_ar'],
        ['products', 'gallery_images'],
        ['categories', 'size_names'],
        ['categories', 'size_names_ar'],
        ['articles', 'processes'],
        ['articles', 'processes_ar'],
        ['articles', 'gallery_images'],
]

/** ستون‌های «شیء-آرایه‌ای» — مثل بندهای قوانین که [{title,items}] است؛ همان منطق، پیشوند [ */
const OBJECT_ARRAY_COLUMNS: Array<[table: string, column: string]> = [
        ['terms', 'sections'],
        ['terms', 'sections_ar'],
]

interface Result {
        table: string
        column: string
        fixed: number
}

async function main(): Promise<void> {
        const url = process.env.DATABASE_URL
        if (!url || !url.startsWith('postgres')) {
                console.error('DATABASE_URL لازم است (postgres://…)')
                process.exit(1)
        }
        const database = new Database(url, { max: 2 })
        const db = database.db

        const all = [...ARRAY_COLUMNS.map((c) => [...c, '['] as const), ...OBJECT_ARRAY_COLUMNS.map((c) => [...c, '['] as const)]

        const results: Result[] = []
        for (const [table, column, prefix] of all) {
                // فقط رشته‌هایی که محتوایشان با [ شروع می‌شود (آرایه‌ی دوبار-انکد) باز شوند.
                // شناسه‌ها از لیست hardcode شدۀ بالا می‌آیند (بدون ورودی کاربر) → امن.
                const q =
                        `UPDATE "${table}" SET "${column}" = ("${column}" #>> '{}')::jsonb ` +
                        `WHERE jsonb_typeof("${column}") = 'string' ` +
                        `AND substring("${column}" #>> '{}' from 1 for 1) = '${prefix}' RETURNING 1`
                const res = (await db.execute(sql.raw(q))) as unknown as Array<unknown>
                const fixed = Array.isArray(res) ? res.length : 0
                results.push({ table, column, fixed })
        }

        await database.close()

        let total = 0
        for (const r of results) {
                if (r.fixed > 0) console.log(`[normalize] ${r.table}.${r.column}: ${r.fixed} ردیف یکدست شد`)
                total += r.fixed
        }
        console.log(`[normalize] پایان — مجموع ${total} ردیف اصلاح شد ✓`)
}

main().catch((e) => {
        console.error('[normalize] خطا:', e)
        process.exit(1)
})
