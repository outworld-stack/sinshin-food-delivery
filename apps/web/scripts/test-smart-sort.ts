/**
 * تست کلاینت فاز ۳ (hundred-fifteen) — سورت «منتخب» + گیتِ سنجاشِ ویژه.
 *
 *   bun scripts/test-smart-sort.ts
 *
 * منطقِ خالصِ useProductsPage مستقیم روی ProductDto مصنوعی: کلاسِ
 * موجودی قبل از امتیاز، امتیاز نزولی در کلاس، null در تهِ کلاس، پایداریِ
 * ترتیبِ سرور روی تساوی، و گیتِ موجودیِ فلگ‌دارها (PRNG/ادغام دست‌نخورده).
 */
import assert from 'node:assert/strict'
import type { Product } from '@sinshin/shared'

import {
        DEFAULT_SORT,
        eligibleForFeaturedPinning,
        SORT_OPTIONS,
        sortProducts,
} from '../src/hooks/site/useProductsPage'

let checks = 0
const check = (condition: unknown, message: string) => {
        assert.ok(condition, message)
        checks++
        console.log(`  ✓ ${message}`)
}

const base = {
        description: null,
        originalPrice: 1000,
        finalPrice: 1000,
        discountPercentage: 0,
        packagingCost: 0,
        profileImage: null,
        galleryImages: [],
        sizesEnabled: false,
        sizes: [],
        ingredients: [],
        prepTime: 10,
        courierAllowed: true,
        takeawayAllowed: true,
        dineInAllowed: true,
        isAvailable: true,
        purchasable: true,
        status: 'ACTIVE',
        smartScore: null,
        smartRank: null,
} as const

let seq = 0
const p = (over: Partial<Product>): Product =>
        ({
                id: `id-${String(++seq).padStart(2, '0')}`,
                name: `محصول ${seq}`,
                categoryId: 'cat-1',
                categoryName: 'دسته',
                views: 0,
                sales: 0,
                ...base,
                ...over,
        }) as Product

// ── «منتخب» پیش‌فرض و اولین گزینه ──
check(DEFAULT_SORT === 'smart', 'DEFAULT_SORT is the new smart key')
check(
        SORT_OPTIONS[0]?.key === 'smart' && SORT_OPTIONS.some((o) => o.labelKey === 'products.sort.smart'),
        '«منتخب» is the first sort option with its own i18n label',
)

// ── کلاسِ موجودی قبل از امتیاز ──
const hiScoreUnavailable = p({ isAvailable: false, smartScore: 0.99 }) // ناموجودِ پرامتیاز — باید ته بیفتد
const lowScore = p({ smartScore: 0.2 })
const lockedHiScore = p({ purchasable: false, smartScore: 0.95 }) // قفل‌خرید هم تهِ کلاس
const midScore = p({ smartScore: 0.8 })
const ordered = sortProducts([hiScoreUnavailable, lowScore, lockedHiScore, midScore], 'smart')
check(
        ordered.length === 4 && new Set(ordered.map((x) => x.id)).size === 4,
        'smart sort returns every product exactly once',
)
check(
        ordered.map((x) => x.id).join(',') ===
                `${midScore.id},${lowScore.id},${hiScoreUnavailable.id},${lockedHiScore.id}`,
        'purchasable available products lead by smartScore desc; unavailable/purchase-locked sink regardless of score',
)

// ── null در تهِ کلاس؛ تساوی = ترتیبِ سرور (پایدار) ──
const a = p({ smartScore: 0.5 })
const b = p({ smartScore: null })
const c = p({ smartScore: 0.9 })
const d = p({ smartScore: null })
const stable = sortProducts([a, b, c, d], 'smart')
check(
        stable.map((x) => x.id).join(',') === `${c.id},${a.id},${b.id},${d.id}`,
        'null scores sort last within their class and ties keep server order (stable)',
)

// ── تخریبِ امن: جاب نرانده ⇒ «منتخب» = جدیدترینِ قابل‌خرید، ناموجود ته ──
const fresh1 = p({})
const fresh2 = p({})
const gone = p({ isAvailable: false })
const degraded = sortProducts([gone, fresh1, fresh2], 'smart')
check(
        degraded.map((x) => x.id).join(',') === `${fresh1.id},${fresh2.id},${gone.id}`,
        'all-null smartScore degrades safely: available products in server order, unavailable last',
)

// ── سورت‌های دیگر دست‌نخورده ──
const byPrice = sortProducts([p({ finalPrice: 500 }), p({ finalPrice: 900 })], 'expensive')
check(byPrice[0]!.finalPrice === 900, 'expensive sort unchanged')

// ── گیتِ سنجاشِ ویژه (فاز ۳): فلگ‌دارِ ناموجود/قفل‌خرید سنجاش نمی‌شود ──
check(
        eligibleForFeaturedPinning(p({ isFeatured: true })),
        'available featured product stays pinning-eligible',
)
check(
        !eligibleForFeaturedPinning(p({ isFeatured: true, isAvailable: false })),
        'unavailable featured product is excluded from pinning',
)
check(
        !eligibleForFeaturedPinning(p({ isFeatured: true, purchasable: false })),
        'purchase-locked featured product is excluded from pinning',
)
check(
        !eligibleForFeaturedPinning(p({ isAvailable: true })),
        'non-featured product is never pinning-eligible',
)

console.log(`\n══ Smart sort client: ${checks} پاس ══`)
