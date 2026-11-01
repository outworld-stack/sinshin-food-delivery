// ═══════════════════════════════════════════════════════════════
// hundred-eleven (فاز ۱ — آمار واقعی) — sinshin-food-delivery
// مسیر مقصد: apps/api/src/workers/jobs/product-stats-sync.job.ts
//
// جابِ همگرایی شبانه — فروشِ هر محصول از منبع حقیقت (order_itemsِ
// سفارش‌های پرداخت‌شده و غیر-لغو) بازسازی می‌شود. سه اثر با یک اجرا:
//   ۱) بک‌فیل سفارش‌های واقعیِ قبل از استقرار (سه هفته‌ی سایتِ آنلاین)
//   ۲) خودترمیمی refund/لغو (سفارش CANCELED از جمع خارج می‌شود)
//   ۳) پاکسازی ردیف‌های یتیم آمار (محصولِ حذف‌شده)
// ایدمپوتنت است — هر شب بی‌خطر تکرار می‌شود. ساعت 03:37 (مرده؛ جدا از
// 02:00 کوپن و 04:30 رتینشن).
// ═══════════════════════════════════════════════════════════════

// src/workers/jobs/product-stats-sync.job.ts
import type { ProductStatsService } from '#/domain/product-stats/product-stats.service'
import type { DailyJob } from '#/workers/scheduler'

export class ProductStatsSyncJob implements DailyJob {
	readonly name = 'product-stats-sync'
	readonly time = '03:37'
	readonly catchUp = true

	constructor(
		private readonly deps: { stats: ProductStatsService },
	) {}

	async run(): Promise<void> {
		await this.deps.stats.syncSales()
	}
}
