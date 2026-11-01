// ═══════════════════════════════════════════════════════════════
// hundred-eleven (فاز ۱ — آمار واقعی) — sinshin-food-delivery
// مسیر مقصد: apps/api/src/domain/product-stats/product-stats.service.ts
//
// سه رویداد، یک لوله‌ی بافرِ واحد (الگوی مقاله‌ها — بدون write
// amplification روی WAL): بازدید / افزودن‌به‌سبد / تسویه‌ی سفارش.
// هر ۶۰ ثانیه یکجا اعمال می‌شود؛ shutdown فلش می‌کند (close()).
//
// اصل «آمار هرگز مسیر پول را نمی‌گیرد»: تسویه فقط «شناسه‌ی سفارش» را
// به بافر می‌سپارد — هیچ خواندن/نوشتنی داخل tx پرداخت انجام نمی‌شود؛
// فلش، بیرون از tx، وضعیت سفارش را دوباره چک می‌کند (PAID-or-later).
// همگرایی شبانه: sales از منبع حقیقت (order_items) بازمحاسبه می‌شود
// (syncSales) — سه هفته سفارش واقعی سایت از همان‌جا بک‌فیل می‌شود.
// ═══════════════════════════════════════════════════════════════

// src/domain/product-stats/product-stats.service.ts
import { and, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm'

import { sha256 } from '#/domain/shared/crypto'
import type { OrderId } from '#/domain/shared/brand'
import type { Db, Tx } from '#/infra/db/client'
import { orderItems, orders } from '#/infra/db/schema'
import type { RedisService } from '#/infra/redis/redis'

/** روزِ تقویمیِ تهرانی ('YYYY-MM-DD') — مبنا برای شمارنده‌های روزانه.
 *  همان الگوی en-CA زمان‌بند (یا برای یکتاییِ روز مرزی). */
export function tehranDay(now: Date = new Date()): string {
	const fmt = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Asia/Tehran',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	})
	const parts = Object.fromEntries(
		fmt.formatToParts(now).map((p) => [p.type, p.value]),
	) as Record<'year' | 'month' | 'day', string>
	return `${parts.year}-${parts.month}-${parts.day}`
}

/** دداپ ۲۴ ساعته — یک بازدید/یک افزودن‌به‌سبد به‌ازای (بازدیدکننده، محصول) */
const DEDUP_TTL_SECONDS = 24 * 60 * 60
const FLUSH_INTERVAL_MS = 60_000

/** v=بازدید c=افزودن‌به‌سبد o=فروش — همه از یک شمارنده‌ی بافر می‌گذرند */
type Kind = 'v' | 'c' | 'o'

interface PendingView {
	productId: string
	/** sha256(vid) — هیچ داده‌ی شخصی ذخیره نمی‌شود */
	visitorId: string
	day: string
}

export class ProductStatsService {
	/** ردیف‌های لاگ در انتظارِ فلش */
	private readonly pendingViews: PendingView[] = []
	/** `${kind}:${productId}:${day}` → تعداد تجمعی در انتظارِ فلش */
	private readonly counters = new Map<string, number>()
	/** Order ID → settlement day, retained across midnight and failed flushes. */
	private readonly pendingOrderIds = new Map<string, string>()
	private readonly recording = new Set<Promise<boolean>>()
	private flushTimer: ReturnType<typeof setInterval> | null = null
	private flushing: Promise<void> | null = null

	constructor(
		private readonly deps: { db: Db; redis: RedisService },
	) {}

	// ── رویدادها ──

	/**
	 * بازدید صفحه‌ی محصول. دداپ: (بازدیدکننده، محصول) در ۲۴ ساعت فقط
	 * یک‌بار — رفرش‌ها شمرده نمی‌شوند. ردیس پایین ⇒ شمارشِ باز (fail-open):
	 * آمار حیاتی نیست؛ سقف نرخ IP خودش سپر است.
	 */
	async recordView(productId: string, visitorId: string): Promise<boolean> {
		return this.record('v', productId, visitorId)
	}

	/** افزودن به سبد (قیف تبدیل بازدید→سبد→خرید). همان دداپِ ۲۴ ساعته. */
	async recordCartAdd(productId: string, visitorId: string): Promise<boolean> {
		return this.record('c', productId, visitorId)
	}

	private async record(kind: 'v' | 'c', productId: string, visitorId: string): Promise<boolean> {
		const pending = this.recordEvent(kind, productId, visitorId)
		this.recording.add(pending)
		try {
			return await pending
		} finally {
			this.recording.delete(pending)
		}
	}

	private async recordEvent(kind: 'v' | 'c', productId: string, visitorId: string): Promise<boolean> {
		const day = tehranDay()
		const visitorHash = sha256(visitorId)
		// null = ردیس در دسترس نیست → شمارشِ باز (شکست‌بسته فقط برای مسیر پول است)
		const first = await this.deps.redis.setNx(
			`pv:${kind}:${productId}:${visitorHash}`,
			'1',
			{ ex: DEDUP_TTL_SECONDS },
		)
		if (first === false) return false
		this.push(kind, productId, 1, day)
		if (kind === 'v') {
			this.pendingViews.push({ productId, visitorId: visitorHash, day })
		}
		return true
	}

	/**
	 * Called once after the payment transaction commits its PENDING_PAYMENT → PAID
	 * transition. No statistics IO belongs in that transaction. Keep the event's
	 * day here; a later flush must not move a pre-midnight sale into the next day.
	 */
	recordOrderSettlement(orderId: string): void {
		if (!this.pendingOrderIds.has(orderId)) this.pendingOrderIds.set(orderId, tehranDay())
		this.ensureTimer()
	}

	private push(kind: Kind, productId: string, n: number, day: string): void {
		const key = `${kind}:${productId}:${day}`
		this.counters.set(key, (this.counters.get(key) ?? 0) + n)
		this.ensureTimer()
	}

	private ensureTimer(): void {
		if (this.flushTimer === null) {
			this.flushTimer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS)
			this.flushTimer.unref?.()
		}
	}

	// ── Flush in its own transaction, outside payment transactions ──

	flush(): Promise<void> {
		if (this.flushing) return this.flushing
		this.flushing = this.apply().finally(() => {
			this.flushing = null
		})
		return this.flushing
	}

	/**
	 * Apply the entire batch atomically, outside payment transactions. A failed
	 * batch requeues only its original events, never the derived order quantities.
	 */
	private async apply(): Promise<void> {
		if (
			this.pendingViews.length === 0 &&
			this.counters.size === 0 &&
			this.pendingOrderIds.size === 0
		) {
			return
		}

		const views = [...this.pendingViews]
		this.pendingViews.length = 0
		const pendingCounters = [...this.counters.entries()]
		this.counters.clear()
		const orderDays = new Map(this.pendingOrderIds)
		this.pendingOrderIds.clear()

		try {
			await this.deps.db.transaction(async (tx) => {
				// Serialize statistics batches/rebuilds across API replicas. This lock is
				// never taken by payment transactions, and precedes all statistics writes.
				await this.lockStats(tx)
				const orderCounts = await this.settledOrderQuantities(tx, orderDays)
				const counters = [...pendingCounters, ...orderCounts.entries()]

				// (۲) لاگ بازدید — یک insert چندردیفی
				if (views.length > 0) {
					await tx.execute(sql`
						insert into product_view_log (product_id, visitor_id, day)
						values ${sql.join(
							views.map(
								(v) => sql`(${v.productId}::uuid, ${v.visitorId}::varchar, ${v.day}::date)`,
							),
							sql`, `,
						)}
					`)
				}

				// (۳) شمارنده‌های روزانه — یک upsert چندردیفیِ افزونه‌ای
				const byCell = new Map<
					string,
					{ productId: string; day: string; v: number; c: number; o: number }
				>()
				for (const [key, n] of counters) {
					const kind = key.slice(0, 1)
					const productId = key.slice(2, key.lastIndexOf(':'))
					const day = key.slice(key.lastIndexOf(':') + 1)
					const cellKey = `${productId}|${day}`
					const cell = byCell.get(cellKey) ?? { productId, day, v: 0, c: 0, o: 0 }
					if (kind === 'v') cell.v += n
					else if (kind === 'c') cell.c += n
					else cell.o += n
					byCell.set(cellKey, cell)
				}
				if (byCell.size > 0) {
					const cells = [...byCell.values()]
					await tx.execute(sql`
						insert into product_daily_stats (product_id, day, views, cart_adds, orders)
						values ${sql.join(
							cells.map(
								(c) =>
									sql`(${c.productId}::uuid, ${c.day}::date, ${c.v}::int, ${c.c}::int, ${c.o}::int)`,
							),
							sql`, `,
						)}
						on conflict (product_id, day) do update set
							views = product_daily_stats.views + excluded.views,
							cart_adds = product_daily_stats.cart_adds + excluded.cart_adds,
							orders = product_daily_stats.orders + excluded.orders,
							updated_at = now()
					`)
				}

				// Lifetime views are additive; deleted product rows are harmless no-ops.
				await this.bumpViews(
					tx,
					counters.filter(([key]) => key.startsWith('v:')),
				)
				// A nightly rebuild may already include these orders. Recompute affected
				// products instead of adding their quantities a second time.
				const soldProducts = [...new Set([...orderCounts.keys()].map((key) => key.slice(2, key.lastIndexOf(':'))))]
				if (soldProducts.length > 0) await this.rebuildSales(tx, soldProducts)
			})
		} catch (error) {
			// برگشت به بافر — تیک بعدی دوباره؛ آمار جلوی ترافیک را نمی‌گیرد
			console.error('[product-stats] flush failed; re-queued:', error)
			this.pendingViews.push(...views)
			for (const [key, n] of pendingCounters) {
				this.counters.set(key, (this.counters.get(key) ?? 0) + n)
			}
			for (const [id, day] of orderDays) this.pendingOrderIds.set(id, day)
		}
	}

	/**
	 * Group paid, non-canceled items by their settlement day. Historical order
	 * snapshots may have no product ID; those cannot contribute to product stats.
	 */
	private async settledOrderQuantities(tx: Tx, orderDays: Map<string, string>): Promise<Map<string, number>> {
		const out = new Map<string, number>()
		if (orderDays.size === 0) return out
		const items = await tx
			.select({
				orderId: orderItems.orderId,
				productId: orderItems.productId,
				qty: sql<number>`sum(${orderItems.quantity})::int`,
			})
			.from(orderItems)
			.innerJoin(orders, eq(orders.id, orderItems.orderId))
			.where(and(
				inArray(orderItems.orderId, [...orderDays.keys()] as OrderId[]),
				isNotNull(orderItems.productId),
				eq(orders.paymentStatus, 'SUCCESS'),
				ne(orders.status, 'PENDING_PAYMENT'),
				ne(orders.status, 'CANCELED'),
			))
			.groupBy(orderItems.orderId, orderItems.productId)
		for (const it of items) {
			const key = `o:${it.productId}:${orderDays.get(it.orderId)!}`
			out.set(key, (out.get(key) ?? 0) + it.qty)
		}
		return out
	}

	private async bumpViews(
		tx: Tx,
		entries: Array<[string, number]>,
	): Promise<void> {
		if (entries.length === 0) return
		const merged = new Map<string, number>()
		for (const [key, n] of entries) {
			const productId = key.slice(2, key.lastIndexOf(':'))
			merged.set(productId, (merged.get(productId) ?? 0) + n)
		}
		const rows = [...merged.entries()]
		await tx.execute(sql`
			update products set views = views + v.n
			from (values ${sql.join(
				rows.map(([id, n]) => sql`(${id}::uuid, ${n}::int)`),
				sql`, `,
			)}) as v(id, n)
			where products.id = v.id
		`)
	}

	private async lockStats(tx: Tx): Promise<void> {
		await tx.execute(sql`select pg_advisory_xact_lock(hashtext('product-stats:write'))`)
	}

	private async rebuildSales(tx: Tx, productIds?: string[]): Promise<void> {
		await tx.execute(sql`
			update products p set sales = coalesce((
				select sum(oi.quantity)
				from order_items oi
				join orders o on o.id = oi.order_id
				where oi.product_id = p.id
					and o.payment_status = 'SUCCESS'
					and o.status <> 'PENDING_PAYMENT'
					and o.status <> 'CANCELED'
			), 0)
			${productIds ? sql`where p.id in (${sql.join(productIds.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``}
		`)
	}

	// ── همگرایی شبانه (جابِ 03:37) + بستن ──

	/**
	 * بازسازی sales از منبع حقیقت: order_items سفارش‌های پرداخت‌شده و
	 * غیر-لغو. ایدمپوتنت و خودترمیم (refund / گم‌شدنِ بافر / بک‌فیلِ
	 * سفارش‌های قبل از استقرار — همه با یک دستور). + پاکسازی ردیف‌های
	 * یتیمِ آمار (محصولِ حذف‌شده). views عمداً بازساخته نمی‌شود: منبعِ
	 * آن لاگِ ۶۰-روزه است و بازسازی از آن، شمارنده‌ی lifetime را با
	 * رتینشن می‌کاست.
	 */
	async syncSales(): Promise<void> {
		await this.deps.db.transaction(async (tx) => {
			await this.lockStats(tx)
			await this.rebuildSales(tx)
			await tx.execute(sql`
				delete from product_view_log l
				where not exists (select 1 from products p where p.id = l.product_id)
			`)
			await tx.execute(sql`
				delete from product_daily_stats s
				where not exists (select 1 from products p where p.id = s.product_id)
			`)
		})
		console.log('[product-stats] nightly sync: sales rebuilt from order_items; orphan rows pruned')
	}

	/** shutdown — تایمر خاموش + بافرِ باقی‌مانده فلش (الگوی مقاله‌ها) */
	async close(): Promise<void> {
		// A beacon accepted before shutdown may still be awaiting Redis deduplication.
		await Promise.allSettled([...this.recording])
		if (this.flushTimer !== null) clearInterval(this.flushTimer)
		this.flushTimer = null
		if (this.flushing) await this.flushing
		await this.flush()
	}
}
