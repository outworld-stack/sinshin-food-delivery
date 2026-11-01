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
// X = 1/1 + 1/2 = 1.5 │ W = 1 │ Y = 1/2 │ Z = 1/3
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

// ── قطعیت: ورودی یکسان → خروجی یکسان (تساوی با اولین ظهور) ──
const first = mergeSimilarCandidates([a, b], { excludeIds: new Set(), limit: 4 })
const second = mergeSimilarCandidates([a, b], { excludeIds: new Set(), limit: 4 })
assert.deepEqual(
        first.map((m) => m.id),
        second.map((m) => m.id),
        'merge is deterministic',
)
console.log('  ✓ merge is deterministic')

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
        useQueries: ({ queries }: { queries: Array<{ id: string }> }) => {
                requestedAnchors = queries.map((query) => query.id)
                return cartResults
        },
}))
mock.module('#/utils/queryOptions', () => ({
        similarProductsOptions: (id: string) => ({ id }),
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
