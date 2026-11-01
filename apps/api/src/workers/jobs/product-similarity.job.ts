// ═══════════════════════════════════════════════════════════════
// hundred-twelve (فاز ۲ — محصولات مشابه) — sinshin-food-delivery
// مسیر مقصد: apps/api/src/workers/jobs/product-similarity.job.ts
//
// جابِ شبانه‌ی شباهت — ۰۳:۴۱ تهران؛ بعد از همگرایی آمار (۰۳:۳۷) و
// قبل از رتینشن (۰۴:۳۰) که لاگِ ۶۰روزه را می‌گیرد (پنجره‌ی جاب از
// همان لاگ می‌خواند؛ هم‌پوشانی جلسه‌ای مشکلی ندارد — لاگ فردا هم
// همین مرز را می‌بیند). catchUp: سروری که ۰۳:۴۱ خواب بوده، موقع بوت
// جبران می‌کند.
//
// بعد از بازمحاسه‌ی موفق، کشِ نسخه‌دارِ منو باطل می‌شود تا
// «محصولات مشابه» از همان دقیقه روی داده‌ی تازه برود (INCR menu:ver
// — کلیدهای sim:* هم مثل بقیه‌ی کلیدهای منو با نسخه دور می‌ریزند).
// ═══════════════════════════════════════════════════════════════

// src/workers/jobs/product-similarity.job.ts
import type { ProductSimilarityService } from '#/domain/product-similarity/similarity.service'
import type { MenuService } from '#/domain/menu/menu.service'
import type { DailyJob } from '#/workers/scheduler'

export class ProductSimilarityJob implements DailyJob {
        readonly name = 'product-similarity'
        readonly time = '03:41'
        readonly catchUp = true

        constructor(
                private readonly deps: { similarity: ProductSimilarityService; menu: MenuService },
        ) {}

        async run(): Promise<void> {
                await this.deps.similarity.recompute()
                await this.deps.menu.bustCache()
        }
}
