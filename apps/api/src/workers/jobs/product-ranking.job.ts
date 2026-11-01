// ═══════════════════════════════════════════════════════════════
// hundred-fifteen (فاز ۳ — «منتخب») — sinshin-food-delivery
// مسیر مقصد: apps/api/src/workers/jobs/product-ranking.job.ts
//
// جابِ شبانه‌ی رتبه‌بندی هوشمند — ۰۳:۴۷ تهران؛ بعد از همگرایی آمار
// (۰۳:۳۷) و شباهت (۰۳:۴۱) و قبل از رتینشن (۰۴:۳۰). زنجیره‌ی کامل:
// داده‌ی تمیز ← شباهت ← رتبه‌ی «منتخب» ← مرتب‌سازیِ کش. catchUp:
// سروری که ۰۳:۴۷ خواب بوده، موقع بوت جبران می‌کند.
//
// بعد از بازمحاسبه‌ی موفق، کشِ نسخه‌دارِ منو باطل می‌شود تا
// smartScore در پاسخ‌های productsByMain از همان دقیقه تازه شود
// (INCR menu:ver — کلیدهای prods:* هم مثل بقیه‌ی کلیدهای منو با
// نسخه دور می‌ریزند).
// ═══════════════════════════════════════════════════════════════

// src/workers/jobs/product-ranking.job.ts
import type { ProductRankingService } from '#/domain/product-ranking/ranking.service'
import type { MenuService } from '#/domain/menu/menu.service'
import type { DailyJob } from '#/workers/scheduler'

export class ProductRankingJob implements DailyJob {
        readonly name = 'product-ranking'
        readonly time = '03:47'
        readonly catchUp = true

        constructor(
                private readonly deps: { ranking: ProductRankingService; menu: MenuService },
        ) {}

        async run(): Promise<void> {
                await this.deps.ranking.recompute()
                await this.deps.menu.bustCache()
        }
}
