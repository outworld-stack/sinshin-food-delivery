// ═══════════════════════════════════════════════════════════════
// hundred-twelve (فاز ۲ — محصولات مشابه) — sinshin-food-delivery
// مسیر مقصد: apps/web/scripts/test-similar-products.ts
//
// رفتار سمت کلاینتِ توصیه‌گر: مسیر درست fetch، و منطقِ خالصِ ادغامِ
// کاندیداهای سبد (RRF + حذف اقلام سبد + فقطِ موجود + سقف).
// ═══════════════════════════════════════════════════════════════
import assert from 'node:assert/strict'
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
const beforeFetch = calls.length
await getSimilarProducts({ data: { id: PID } })
const mine = calls.slice(beforeFetch)
assert.equal(mine.length, 1, 'similar fetcher fires exactly one request')
assert.equal(
        mine[0]!.url.startsWith(
                `http://localhost:5173/api/menu/products/${PID}/similar`,
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

console.log('\n══ Similar products client: 7 checks passed ══')
