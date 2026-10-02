//src/domain/order/order-lookup.ts
// یافتن سفارش با شناسه‌ی نمایشی — منبع واحد رارد ۴۸ (اسکن A5).
// همین بلوکِ «گارد الگو + select + خطای نبود/مالکیت» در ۹ نقطه across
// سرویس‌های سفارش/نظر/پیک/زنده تکرار می‌شد و دو سرویس خودشان جدا جدا
// نسخه‌ی خصوصی mustGet را نوشته بودند.

import { eq } from 'drizzle-orm'

import type { DbOrTx } from '#/infra/db/client'
import { orders, type OrderRow } from '#/infra/db/schema'
import { Err } from '#/domain/shared/errors'
import { DISPLAY_RE } from '#/domain/shared/ids'

/** یافتن خام — الگوی نادرست یا نبودِ ردیف = null */
export async function findOrder(
  db: DbOrTx,
  displayId: string,
  opts: { forUpdate?: boolean } = {},
): Promise<OrderRow | null> {
  if (!DISPLAY_RE.test(displayId)) return null
  const q = db.select().from(orders).where(eq(orders.displayId, displayId))
  const row = (await (opts.forUpdate ? q.for('update') : q))[0]
  return row ?? null
}

/** مسیرهای ستاد (فاکتور/پیک/پنل زنده) — بدون چک مالکیت */
export async function requireOrder(
  db: DbOrTx,
  displayId: string,
  opts: { forUpdate?: boolean } = {},
): Promise<OrderRow> {
  const row = await findOrder(db, displayId, opts)
  if (!row) throw Err.notFound('سفارش پیدا نشد.')
  return row
}

/** مسیرهای مشتری — مالکیت هم چک می‌شود (پیام عمداً همان «پیدا نشد» است) */
export async function requireOwnedOrder(
  db: DbOrTx,
  userId: string,
  displayId: string,
): Promise<OrderRow> {
  const row = await findOrder(db, displayId)
  if (!row || row.userId !== userId) throw Err.notFound('سفارش پیدا نشد.')
  return row
}