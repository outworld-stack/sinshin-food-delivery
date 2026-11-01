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
import { mock } from 'bun:test'
import type { Product } from '@sinshin/shared'

const react = { ...await import('react') }
mock.module('react', () => ({
        ...react,
        useMemo: (compute: () => unknown) => compute(),
        useCallback: (callback: unknown) => callback,
        useReducer: (_reducer: unknown, initial: unknown) => [initial, () => {}],
}))
let search: { tab?: string; category?: string; sort?: 'smart' | 'newest' } = {}
let mainSlug = 'food'
let pageProducts: Product[] = []
mock.module('@tanstack/react-router', () => ({
        useSearch: () => search,
        useNavigate: () => () => {},
}))
mock.module('@tanstack/react-query', () => ({
        keepPreviousData: (previous: unknown) => previous,
        useQuery: (options: { queryKey: readonly unknown[] }) => ({
                isLoading: false,
                data: options.queryKey[0] === 'active-main-categories'
                        ? [{ id: 'main-1', slug: mainSlug, isDefault: true }]
                        : { products: pageProducts, categories: [{ id: 'cat-1', slug: 'pizza', name: 'Pizza' }] },
        }),
}))
mock.module('#/utils/queryOptions', () => ({
        activeMainCategoriesOptions: { queryKey: ['active-main-categories'] },
        productsByMainOptions: (slug: string | null) => ({ queryKey: ['products-by-main', slug] }),
}))
mock.module('#/i18n', () => ({ useI18n: () => ({ t: { 'common.all': 'All' } }) }))

const {
        DEFAULT_SORT,
        eligibleForFeaturedPinning,
        SORT_OPTIONS,
        sortProducts,
        useProductsPage,
} = await import('../src/hooks/site/useProductsPage')

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

// Exercise the actual page pipeline: featured insertion runs after smart sorting.
// A category with only unavailable items still receives available featured items
// from the main category; random slots must not move those below unavailable ones.
const featured = p({ isFeatured: true, categoryId: 'cat-2' as Product['categoryId'], smartScore: 0.1 })
const unavailableFeatured = p({ isFeatured: true, isAvailable: false, smartScore: 0.9 })
const lockedFeatured = p({ isFeatured: true, purchasable: false, smartScore: 0.8 })
pageProducts = [unavailableFeatured, lockedFeatured, featured]
search = { category: 'pizza' }
for (let i = 0; i < 20; i++) {
        mainSlug = `food-${i}`
        const page = useProductsPage()
        assert.equal(page.state.sortBy, 'smart', 'URLs without a sort use smart ordering')
        assert.deepEqual(page.filteredProducts.map((product) => product.id),
                [featured.id, unavailableFeatured.id, lockedFeatured.id],
                `available featured products precede unavailable products after category filtering (seed ${i})`)
}
check(true, 'featured slot insertion preserves availability priority in short category lists for every seed')

const normalLow = p({ smartScore: 0.2 })
const normalHigh = p({ smartScore: 0.7 })
pageProducts = [unavailableFeatured, normalLow, lockedFeatured, featured, normalHigh]
search = {}
for (let i = 0; i < 20; i++) {
        mainSlug = `food-${i}`
        const result = useProductsPage().filteredProducts
        assert.equal(result.length, pageProducts.length)
        assert.equal(new Set(result.map((product) => product.id)).size, pageProducts.length)
        assert(result.slice(0, 3).every((product) => product.isAvailable !== false && product.purchasable !== false))
        assert.deepEqual(result.filter((product) => !product.isFeatured).map((product) => product.id),
                [normalHigh.id, normalLow.id], 'normal products retain smart score order after pinning')
        assert(result.indexOf(featured) < 4, 'available featured products keep their first-four placement')
        assert.deepEqual(result.map((product) => product.id),
                useProductsPage().filteredProducts.map((product) => product.id), 'rerenders preserve deterministic placement')
}
check(true, 'smart page ordering preserves every item, score order, featured placement and determinism')

search = { sort: 'newest' }
check(useProductsPage().state.sortBy === 'newest', 'an explicit newest URL still overrides the smart default')

console.log(`\n══ Smart sort client: ${checks} پاس ══`)
