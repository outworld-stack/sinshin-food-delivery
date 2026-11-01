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
import { inArray, sql } from 'drizzle-orm'

import { sha256 } from '#/domain/shared/crypto'
import type { OrderId } from '#/domain/shared/brand'
import type { Db } from '#/infra/db/client'
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
	/** شناسه‌ی سفارش‌های تسویه‌شده در انتظارِ فلش (وضعیت در فلش چک می‌شود) */
	private readonly pendingOrderIds = new Set<string>()
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
		// null = ردیس در دسترس نیست → شمارشِ باز (شکست‌بسته فقط برای مسیر پول است)
		const first = await this.deps.redis.setNx(
			`pv:${kind}:${productId}:${sha256(visitorId)}`,
			'1',
			{ ex: DEDUP_TTL_SECONDS },
		)
		if (first === false) return false
		this.push(kind, productId, 1)
		if (kind === 'v') {
			this.pendingViews.push({ productId, visitorId: sha256(visitorId), day: tehranDay() })
		}
		return true
	}

	/**
	 * صدورِ فروش — فقط از داخل settlePayment، «بعد از» گارد وضعیت
	 * (PENDING_PAYMENT→PAID) صدا می‌شود ⇒ به‌ازای هر پرداختِ موفق دقیقاً
	 * یک‌بار (تکرارِ تسویه به گارد می‌خورد و دیگر به اینجا نمی‌رسد؛
	 * کلیدِ set هم بدرقه است). عمداً هیچ کاری داخل tx پرداخت نمی‌کند:
	 * فقط شناسه را می‌سپارد؛ فلش وضعیت را می‌خواند — tx که برگشت بخورد،
	 * سفارش PAID نیست و رد می‌شود. refund/لغو شبانه توسط syncSales از
	 * ستون sales کنار می‌رود (بازسازی از منبع حقیقت).
	 */
	recordOrderSettlement(orderId: string): void {
		this.pendingOrderIds.add(orderId)
		this.ensureTimer()
	}

	private push(kind: Kind, productId: string, n: number): void {
		const key = `${kind}:${productId}:${tehranDay()}`
		this.counters.set(key, (this.counters.get(key) ?? 0) + n)
		this.ensureTimer()
	}

	private ensureTimer(): void {
		if (this.flushTimer === null) {
			this.flushTimer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS)
			this.flushTimer.unref?.()
		}
	}

	// ── فلش — یکجا روی اتصال اصلی (بیرون از هر tx) ──

	flush(): Promise<void> {
		if (this.flushing) return this.flushing
		this.flushing = this.apply().finally(() => {
			this.flushing = null
		})
		return this.flushing
	}

	/**
	 * ترتیب گام‌ها: (۱) اقلامِ سفارش‌های واقعاً تسویه‌شده به شمارنده‌ها
	 * اضافه می‌شود (۲) لاگ بازدید (۳) upsert روزانه (۴) ستون‌های lifetime.
	 * خطا در هر گام ⇒ همه‌چیز به بافر برمی‌گردد و تیک بعدی دوباره تلاش
	 * می‌کند (شمارشِ مضاعفِ نادر در رویداد مرزی = بی‌ضرر؛ sales شبانه
	 * همگرا می‌شود).
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
		const counters = [...this.counters.entries()]
		this.counters.clear()
		const orderIds = [...this.pendingOrderIds]
		this.pendingOrderIds.clear()

		try {
			// (۱) سفارش‌ها — وضعیتِ زنده دوباره چک می‌شود (بیرون از tx پرداخت)
			const orderCounts = await this.settledOrderQuantities(orderIds)
			for (const [productId, qty] of orderCounts) {
				this.mergeCounter(counters, `o:${productId}:${tehranDay()}`, qty)
			}

			// (۲) لاگ بازدید — یک insert چندردیفی
			if (views.length > 0) {
				await this.deps.db.execute(sql`
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
				await this.deps.db.execute(sql`
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

			// (۴) ستون‌های lifetime — views از بازدیدها، sales از فروش (دستورِ
			// batch یک‌عباره با VALUES؛ آپدیتِ ردیفِ حذف‌شده = no-op بی‌ضرر)
			await this.bumpColumn(
				'views',
				counters.filter(([key]) => key.startsWith('v:')),
			)
			await this.bumpColumn(
				'sales',
				counters.filter(([key]) => key.startsWith('o:')),
			)
		} catch (error) {
			// برگشت به بافر — تیک بعدی دوباره؛ آمار جلوی ترافیک را نمی‌گیرد
			console.error('[product-stats] flush failed; re-queued:', error)
			this.pendingViews.push(...views)
			for (const [key, n] of counters) {
				this.counters.set(key, (this.counters.get(key) ?? 0) + n)
			}
			for (const id of orderIds) this.pendingOrderIds.add(id)
		}
	}

	/** تجمیع در آرایه‌ی لحظه‌ایِ شمارنده‌ها (بین سفارش‌های هم‌محصول) */
	private mergeCounter(counters: Array<[string, number]>, key: string, n: number): void {
		const existing = counters.find(([k]) => k === key)
		if (existing) existing[1] += n
		else counters.push([key, n])
	}

	/**
	 * اقلامِ سفارش‌های «واقعاً تسویه‌شده» را تجمیع می‌کند: هر وضعتی جز
	 * PENDING_PAYMENT و CANCELED یعنی پرداخت جا افتاده (PAID/CONFIRMED/
	 * ON_THE_WAY/DELIVERED). تمامِ خواندن‌ها بیرون از tx پرداخت.
	 */
	private async settledOrderQuantities(orderIds: string[]): Promise<Map<string, number>> {
		const out = new Map<string, number>()
		if (orderIds.length === 0) return out
		const rows = await this.deps.db
			.select({ id: orders.id, status: orders.status })
			.from(orders)
			.where(inArray(orders.id, orderIds as OrderId[]))
		const live = rows.filter((r) => r.status !== 'PENDING_PAYMENT' && r.status !== 'CANCELED')
		if (live.length === 0) return out
		const items = await this.deps.db
			.select({
				productId: orderItems.productId,
				qty: sql<number>`sum(${orderItems.quantity})::int`,
			})
			.from(orderItems)
			.where(inArray(orderItems.orderId, live.map((r) => r.id)))
			.groupBy(orderItems.productId)
		for (const it of items) {
			const productId = String(it.productId)
			out.set(productId, (out.get(productId) ?? 0) + it.qty)
		}
		return out
	}

	/** ستون whitelist شده — sql.raw فقط دو ثابتِ خودِ این فایل است */
	private async bumpColumn(
		column: 'views' | 'sales',
		entries: Array<[string, number]>,
	): Promise<void> {
		if (entries.length === 0) return
		const merged = new Map<string, number>()
		for (const [key, n] of entries) {
			const productId = key.slice(2, key.lastIndexOf(':'))
			merged.set(productId, (merged.get(productId) ?? 0) + n)
		}
		const rows = [...merged.entries()]
		await this.deps.db.execute(sql`
			update products set ${sql.raw(column)} = ${sql.raw(column)} + v.n
			from (values ${sql.join(
				rows.map(([id, n]) => sql`(${id}::uuid, ${n}::int)`),
				sql`, `,
			)}) as v(id, n)
			where products.id = v.id
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
		await this.deps.db.execute(sql`
			update products p set sales = coalesce((
				select sum(oi.quantity)
				from order_items oi
				join orders o on o.id = oi.order_id
				where oi.product_id = p.id
					and o.payment_status = 'SUCCESS'
					and o.status <> 'CANCELED'
			), 0)
		`)
		await this.deps.db.execute(sql`
			delete from product_view_log l
			where not exists (select 1 from products p where p.id = l.product_id)
		`)
		await this.deps.db.execute(sql`
			delete from product_daily_stats s
			where not exists (select 1 from products p where p.id = s.product_id)
		`)
		console.log('[product-stats] nightly sync: sales rebuilt from order_items; orphan rows pruned')
	}

	/** shutdown — تایمر خاموش + بافرِ باقی‌مانده فلش (الگوی مقاله‌ها) */
	async close(): Promise<void> {
		if (this.flushTimer !== null) clearInterval(this.flushTimer)
		this.flushTimer = null
		if (this.flushing) await this.flushing
		await this.flush()
	}
}
