// ═══════════════════════════════════════════════════════════════
// hundred-twelve (فاز ۲ — محصولات مشابه) — sinshin-food-delivery
// مسیر مقصد: apps/web/scripts/test-similar-products.ts
//
// رفتار سمت کلاینتِ توصیه‌گر: مسیر درست fetch، و منطقِ خالصِ ادغامِ
// کاندیداهای سبد (RRF + حذف اقلام سبد + فقطِ موجود + سقف).
// ═══════════════════════════════════════════════════════════════
import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import type { CategoryId, Product, ProductId, SimilarProductsDto } from '@sinshin/shared'

// ── رهگیر fetch — URL/متدِ هر درخواست ثبت می‌شود ──
const calls: Array<{ url: string; method: string }> = []
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), method: init?.method ?? 'GET' })
        return new Response('{"products":[],"strict":false}', { status: 200 })
}) as typeof fetch

// ── محیط مرورگر — apiBase() به window.location.origin وصل است ──
Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: { location: { origin: 'http://localhost:5173' } },
})

const PID = '11111111-1111-1111-1111-111111111111'

// ── فچر: مسیر + متد ──
// توجه: import ماژول‌ها یک بیکنِ bootِ نشست هم می‌زند (auth/refresh در
// auth-session) — فقط فراخوانی‌های «بعد از» import خودِ ما شمرده می‌شوند.
const { getSimilarProducts } = await import('../src/server/products')
const { apiBase } = await import('../src/lib/api')
const beforeFetch = calls.length
await getSimilarProducts({ data: { id: PID } })
const mine = calls.slice(beforeFetch)
assert.equal(mine.length, 1, 'similar fetcher fires exactly one request')
assert.equal(
        mine[0]!.url.startsWith(
                `${apiBase()}/menu/products/${PID}/similar`,
        ),
        true,
        'similar fetcher hits the endpoint under apiBase() (lang query allowed)',
)
assert.equal(mine[0]!.method, 'GET', 'similar fetcher is a GET')
console.log('  ✓ fetcher → GET /api/menu/products/:id/similar')

const PID2 = '22222222-2222-2222-2222-222222222222'
const { similarProductsOptions } = await import('../src/utils/queryOptions')
const detailOptions = similarProductsOptions(PID)
const cartOptions = similarProductsOptions(PID, { context: 'cart', exclude: [PID2, PID, PID2] })
assert.notDeepEqual(cartOptions.queryKey, detailOptions.queryKey,
        'cart complements never reuse a product-detail similarity response')
assert.deepEqual(cartOptions.queryKey,
        similarProductsOptions(PID, { context: 'cart', exclude: [PID, PID2] }).queryKey,
        'equivalent baskets share one canonical recommendation query')
assert.notDeepEqual(cartOptions.queryKey,
        similarProductsOptions(PID, { context: 'cart', exclude: [PID] }).queryKey,
        'adding a product changes the recommendation query so the server can refill the list')
await (cartOptions.queryFn as () => Promise<unknown>)()
const cartUrl = new URL(calls.at(-1)!.url)
assert.equal(cartUrl.searchParams.get('context'), 'cart')
assert.equal(cartUrl.searchParams.get('exclude'), `${PID},${PID2}`,
        'the API receives the same canonical basket encoded in the cache key')
const manyIds = Array.from({ length: 60 }, (_, i) =>
        `11111111-1111-1111-1111-${String(i).padStart(12, '0')}`)
await getSimilarProducts({ data: { id: PID, context: 'cart', exclude: manyIds } })
assert.equal(new URL(calls.at(-1)!.url).searchParams.get('exclude')!.split(',').length, 50,
        'large carts respect the bounded API exclusion list')
console.log('  ✓ cart context, canonical exclusions and cache isolation reach the API')

// ── سازنده‌ی DTO محصول برای تستِ ادغام ──
let seq = 0
const p = (id: string, available = true): Product => ({
        id: id as ProductId,
        name: `محصول ${id}`,
        description: null,
        originalPrice: 10_000,
        finalPrice: 10_000,
        discountPercentage: 0,
        packagingCost: 0,
        categoryId: 'c1' as CategoryId,
        profileImage: null,
        galleryImages: [],
        sizesEnabled: false,
        sizes: [],
        ingredients: [],
        prepTime: 10,
        views: seq++,
        sales: 0,
        status: 'ACTIVE',
        isAvailable: available,
        courierAllowed: true,
        takeawayAllowed: true,
        dineInAllowed: true,
})

const { mergeSimilarCandidates } = await import('../src/lib/similar-products')

// ── ادغام RRF: کاندیدِ مشترکِ دو لنگر با جمعِ رتبه‌ها بالا می‌آید ──
const a: SimilarProductsDto = {
        strict: false,
        products: [p('X'), p('Y'), p('Z')],
}
const b: SimilarProductsDto = {
        strict: false,
        products: [p('W'), p('X')],
}
let merged = mergeSimilarCandidates([a, b], { excludeIds: new Set(), limit: 4 })
// X = 1/9 + 1/10 │ W = 1/9 │ Y = 1/10 │ Z = 1/11
assert.deepEqual(
        merged.map((m) => m.id),
        ['X', 'W', 'Y', 'Z'],
        'RRF: candidate shared by both anchors ranks first',
)
console.log('  ✓ RRF fusion ranks the shared candidate first')

// ── حذف اقلام سبد از کاندیدها ──
merged = mergeSimilarCandidates([a], {
        excludeIds: new Set(['X', 'Z']),
        limit: 4,
})
assert.deepEqual(
        merged.map((m) => m.id),
        ['Y'],
        'cart items are excluded from recommendations',
)
console.log('  ✓ cart items are excluded')

// ── فقطِ موجودها (تصمیم قفل‌شده‌ی بلوک سبد) ──
const withUnavailable: SimilarProductsDto = {
        strict: false,
        products: [p('U1', false), p('U2', true)],
}
merged = mergeSimilarCandidates([withUnavailable], {
        excludeIds: new Set(),
        limit: 4,
})
assert.deepEqual(
        merged.map((m) => m.id),
        ['U2'],
        'unavailable candidates are filtered out',
)
console.log('  ✓ unavailable candidates are filtered')

merged = mergeSimilarCandidates([{
        strict: false,
        products: [{ ...p('locked'), purchasable: false }, p('buyable')],
}], { excludeIds: new Set(), limit: 4 })
assert.deepEqual(merged.map((m) => m.id), ['buyable'],
        'category purchase locks are excluded from cart recommendations')
console.log('  ✓ category purchase-locked candidates are filtered')

// ── سقف ──
merged = mergeSimilarCandidates([a, b], { excludeIds: new Set(), limit: 2 })
assert.equal(merged.length, 2, 'limit is respected')
assert.deepEqual(
        merged.map((m) => m.id),
        ['X', 'W'],
        'top-scored candidates fill the limit',
)
console.log('  ✓ limit keeps only the top-scored candidates')

// ── null/undefined (لودینگ/خطا/لنگرِ مرده) نادیده ──
merged = mergeSimilarCandidates([null, undefined, a], {
        excludeIds: new Set(),
        limit: 4,
})
assert.equal(merged.length, 3, 'loading/failed anchors are skipped without breaking the merge')
console.log('  ✓ null/undefined anchor results are skipped')

// ── قطعیت: ورودی یکسان → خروجی یکسان (تساوی با شناسهٔ محصول) ──
const first = mergeSimilarCandidates([a, b], { excludeIds: new Set(), limit: 4 })
const second = mergeSimilarCandidates([a, b], { excludeIds: new Set(), limit: 4 })
assert.deepEqual(
        first.map((m) => m.id),
        second.map((m) => m.id),
        'merge is deterministic',
)
console.log('  ✓ merge is deterministic')

const consensus: SimilarProductsDto[] = [
        { strict: false, products: [p('first-only'), p('a-only'), p('b-only'), p('shared')] },
        { strict: false, products: [p('second-only'), p('c-only'), p('d-only'), p('shared')] },
]
assert.equal(mergeSimilarCandidates(consensus, { excludeIds: new Set(), limit: 4 })[0]!.id,
        'shared', 'agreement between cart anchors beats an isolated first-place suggestion')
const tied: SimilarProductsDto[] = [
        { strict: false, products: [p('Z')] },
        { strict: false, products: [p('A')] },
]
assert.deepEqual(mergeSimilarCandidates(tied, { excludeIds: new Set(), limit: 4 }).map((x) => x.id), ['A', 'Z'])
assert.deepEqual(mergeSimilarCandidates([...tied].reverse(), { excludeIds: new Set(), limit: 4 }).map((x) => x.id), ['A', 'Z'],
        'tie order does not depend on which cart anchor was added first')
const filteredRanks: SimilarProductsDto[] = [
        { strict: false, products: [p('cart'), p('sold-out', false), { ...p('hidden'), status: 'INACTIVE' }, p('A')] },
        { strict: false, products: [p('Z'), p('Z'), p('Z')] },
]
const ranksSnapshot = JSON.stringify(filteredRanks)
assert.deepEqual(mergeSimilarCandidates(filteredRanks, { excludeIds: new Set(['cart']), limit: 4 }).map((x) => x.id), ['A', 'Z'],
        'filtering leaves comparable ranks and duplicate rows cannot manufacture consensus')
assert.equal(JSON.stringify(filteredRanks), ranksSnapshot, 'fusion never mutates cached responses')
for (const limit of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        assert.deepEqual(mergeSimilarCandidates([a], { excludeIds: new Set(), limit }), [],
                'invalid or zero limits never expose an unintended recommendation list')
}
console.log('  ✓ consensus, stable ties, eligible ranks and distinct anchor votes')

// React Query retains old data after a refetch fails. Optional recommendations
// must hide that anchor while other successful cart anchors remain usable.
const react = { ...await import('react') }
mock.module('react', () => ({
        ...react,
        memo: (component: unknown) => component,
        useMemo: (compute: () => unknown) => compute(),
        useCallback: (callback: unknown) => callback,
}))
type Result = { data?: SimilarProductsDto | null; isError?: boolean }
let detailResult: Result = {}
let cartResults: Result[] = []
let requestedAnchors: string[] = []
let requestedOptions: Array<{ context?: string; exclude?: string[] }> = []
let cartItems: Array<{ productId: string }> = []
let refetches = 0
const invalidated: Array<readonly unknown[]> = []
const menuListeners: Array<() => void> = []
mock.module('@tanstack/react-query', () => ({
        useQuery: (options: { kind?: string }) => options.kind === 'cart'
                ? { data: { items: [], total: 0 }, refetch: () => { refetches++ } }
                : detailResult,
        useQueryClient: () => ({ invalidateQueries: async ({ queryKey }: { queryKey: readonly unknown[] }) => {
                invalidated.push(queryKey)
        } }),
        useQueries: ({ queries }: { queries: Array<{ id: string; options: { context?: string; exclude?: string[] } }> }) => {
                requestedAnchors = queries.map((query) => query.id)
                requestedOptions = queries.map((query) => query.options)
                return cartResults
        },
}))
mock.module('#/utils/queryOptions', () => ({
        similarProductsOptions: (id: string, options = {}) => ({ id, options }),
        cartDetailsOptions: () => ({ kind: 'cart' }),
}))
mock.module('#/stores/cartStore', () => ({
        CART_MAX_QTY: 99,
        useCartStore: (select: (state: { items: typeof cartItems }) => unknown) =>
                select({ items: cartItems }),
        cartItemKey: (productId: string, sizeId: string | null) => `${productId}|${sizeId ?? ''}`,
}))
mock.module('#/hooks/shared/useMenuLive', () => ({
        useMenuLive: (listener: () => void) => { menuListeners.push(listener) },
}))
mock.module('#/hooks/site/useCartPage', () => ({ useCartPage: () => ({ items: cartItems }) }))
mock.module('#/hooks/useHydrated', () => ({ useHydrated: () => true }))
mock.module('#/hooks/useBack', () => ({ useBack: () => () => {} }))
mock.module('#/lib/seo', () => ({ noindexHead: () => ({}) }))
mock.module('@tanstack/react-router', () => ({
        createFileRoute: () => (options: unknown) => options,
        Link: () => null,
}))
const t = { 'simil.title': 'Similar', 'simil.alternatives': 'Alternatives', 'simil.cartTitle': 'Complements' }
mock.module('#/i18n', () => ({
        useI18n: () => ({ t }),
        useI18nSafe: () => ({ t }),
        tpl: (value: string) => value,
}))
const Card = () => null
mock.module('#/components/ProductCard', () => ({ ProductCard: Card }))

type Element = { type: unknown; props: Record<string, any> }
function nodes(value: any): Element[] {
        if (Array.isArray(value)) return value.flatMap(nodes)
        if (!value || typeof value !== 'object' || !('props' in value)) return []
        return [value, ...nodes(value.props.children)]
}
const cardIds = (tree: unknown) => nodes(tree)
        .filter((node) => node.type === Card)
        .map((node) => node.props.product.id)

try {
        const { SimilarProducts } = await import('../src/components/site/product-detail/SimilarProducts')
        const { CartComplements } = await import('../src/components/site/cart/CartComplements')
        const { qk } = await import('../src/utils/queryKeys')
        const renderDetail = SimilarProducts as unknown as (props: { product: Product }) => Element | null
        const renderCart = CartComplements as unknown as () => Element | null
        const anchor = p('anchor')

        assert.equal(renderDetail({ product: anchor }), null, 'loading recommendations do not occupy the product page')
        detailResult = { data: { strict: true, products: [p('alternative')] } }
        assert.equal(renderDetail({ product: anchor })?.props['aria-label'], 'Alternatives')
        detailResult = { ...detailResult, isError: true }
        assert.equal(renderDetail({ product: anchor }), null, 'failed refetches do not render stale alternatives')
        detailResult = { data: { strict: false, products: [p('similar')] } }
        assert.deepEqual(cardIds(renderDetail({ product: anchor })), ['similar'], 'recovered queries render recommendations again')
        menuListeners.at(-1)!()
        assert.deepEqual(invalidated.at(-1), qk.similarProductsAll, 'live product changes invalidate recommendations, including changed candidates')

        cartItems = ['anchor', 'anchor', 'second', 'third', 'fourth'].map((productId) => ({ productId }))
        cartResults = [
                { data: { strict: false, products: [p('stale')] }, isError: true },
                { data: { strict: false, products: [p('fourth'), p('fresh'), p('unavailable', false), { ...p('locked'), purchasable: false }] } },
                {},
        ]
        assert.deepEqual(cardIds(renderCart()), ['fresh'], 'cart ignores failed anchors, all cart items and products that cannot be purchased')
        assert.deepEqual(requestedAnchors, ['anchor', 'second', 'third'], 'cart queries at most three distinct products')
        assert(requestedOptions.every((options) => options.context === 'cart'), 'every cart anchor requests purchase complements')
        assert(requestedOptions.every((options) => JSON.stringify(options.exclude) === JSON.stringify(['anchor', 'second', 'third', 'fourth'])),
                'the API excludes all cart products, including products beyond the anchor cap')
        cartResults = [{ data: { strict: false, products: [p('stale')] }, isError: true }]
        assert.equal(renderCart(), null, 'cart recommendation block disappears when no successful anchor supplies products')
        cartItems = []
        cartResults = []
        assert.equal(renderCart(), null)
        assert.deepEqual(requestedAnchors, [], 'empty carts issue no recommendation requests')
        const { Route } = await import('../src/routes/cart/index')
        const beforeCartListeners = menuListeners.length
        ;(Route as unknown as { component: () => unknown }).component()
        assert.equal(menuListeners.length, beforeCartListeners + 1, 'cart keeps one menu subscription for prices and recommendations')
        menuListeners.at(-1)!()
        assert.equal(refetches, 1, 'cart live events still refresh cart prices')
        assert.deepEqual(invalidated.at(-1), qk.similarProductsAll, 'the cart menu subscription also refreshes recommendation queries')
        console.log('  ✓ recommendation blocks handle failed refetches, recovery, empty carts and bounded distinct anchors')
} finally {
        mock.restore()
}

console.log('\n══ Similar products client regressions passed ══')
