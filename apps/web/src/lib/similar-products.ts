// ═══════════════════════════════════════════════════════════════
// hundred-twelve (فاز ۲ — محصولات مشابه) — sinshin-food-delivery
// مسیر مقصد: apps/web/src/lib/similar-products.ts
//
// ادغامِ لیست‌های «مشابه» برای بلوک سبد — خالص و بدون React تا
// مستقیم تست شود. ورودی: پاسخ‌های /menu/products/:id/similar برای
// تا ۳ لنگرِ سبد؛ خروجی: حداکثر `limit` کاندیدِ «موجود» که خودِ
// سبد ندارد.
//
// امتیاز = Reciprocal Rank Fusion: رتبه‌ی k در هر لیست سهم ۱/(k+۱)
// می‌دهد و سهم‌ها جمع می‌شوند — روش استانداردِ ادغامِ رتبه‌بندی‌ها:
// بدون نرمال‌سازیِ امتیازهای ناهم‌مقیاسِ سرور، قطعی (deterministic)
// و ساده. تساوی: اولین ظهور (شماره‌ی لیست، بعد رتبه) جلوتر می‌افتد.
// ═══════════════════════════════════════════════════════════════

// src/lib/similar-products.ts
import type { Product, SimilarProductsDto } from '@sinshin/shared'

/** ورودی‌های undefined/null (لودینگ/خطا/لنگرِ مرده) نادیده گرفته می‌شوند */
export function mergeSimilarCandidates(
        results: ReadonlyArray<SimilarProductsDto | null | undefined>,
        opts: { excludeIds: ReadonlySet<string>; limit: number },
): Product[] {
        // id → { product, rrf, order } — order = اولین ظهور برای تساوی‌شکنی
        const best = new Map<
                string,
                { product: Product; rrf: number; order: number }
        >()
        let order = 0
        for (const res of results) {
                if (!res) continue
                for (const [rank, p] of res.products.entries()) {
                        // سبدِ فعلی و خودِ لنگرها هرگز توصیه نمی‌شوند
                        if (opts.excludeIds.has(p.id)) continue
                        // بلوک سبد فقط «موجود» می‌دهد — افزودنِ ناموجود به
                        // سبد ممکن نیست و کارتِ خاکستری اینجا فقط نویز است
                        if (p.isAvailable === false) continue
                        const entry = best.get(p.id)
                        if (entry) {
                                entry.rrf += 1 / (rank + 1)
                        } else {
                                best.set(p.id, {
                                        product: p,
                                        rrf: 1 / (rank + 1),
                                        order: order++,
                                })
                        }
                }
        }
        return [...best.values()]
                .sort((a, b) => b.rrf - a.rrf || a.order - b.order)
                .slice(0, opts.limit)
                .map((e) => e.product)
}
