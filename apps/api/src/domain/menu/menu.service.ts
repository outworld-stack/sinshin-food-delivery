// ═══════════════════════════════════════════════════════════════
// stage-48 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/domain/menu/menu.service.ts
// وضعیت: جایگزینی کامل فایل موجود
// stage-48 —
//   • حالت‌های سفارش: دسته (۳ سوئیچ پایه) + محصول (۳ پرچم؛ مؤثر = AND)
//   • is_available محصولات + toggleAvailability
//   • SSE کانال عمومی menu:live — تغییر موجودی/حالت/وضعیت → سبد/چک‌اوت زنده
//   • پخش خودکار نوتیفیکیشن «تخفیف محصول» برای همه کاربران (بدون کرون)
// ═══════════════════════════════════════════════════════════════

//src/domain/menu/menu.service.ts
import { and, asc, desc, eq, ilike, inArray, sql, type SQL } from 'drizzle-orm'

import type { Db, DbOrTx } from '#/infra/db/client'
import type { RedisService } from '#/infra/redis/redis'
import type { SseHub } from '#/infra/realtime/sse-hub'
import type { NotificationService } from '#/domain/notification/notification.service'
import { VersionedCache } from '#/domain/shared/versioned-cache'
import {
  categories,
  mainCategories,
  productSizes,
  products,
} from '#/infra/db/schema'
import {
  asCategoryId,
  asMainCategoryId,
  asProductId,
  type CategoryId,
  type ProductId,
} from '#/domain/shared/brand'
import { nullIfEmpty, pickAr, pickArArr, type Lang } from '#/domain/shared/lang'
import type { Product } from '@sinshin/shared'

const CACHE_TTL_SECONDS = 30
const VERSION_KEY = 'menu:ver'
/** رارد ۴۷ — DTO محصول = قرارداد مشترک (کپی محلی حذف شد؛ برندهای id از
 *  اسکیمای دیتابیس می‌آیند و nameAr سایز هم حالا در تایپ دیده می‌شود —
 *  قبلاً کپی محلی فیلد nameAr سایز را نداشت و پاسخ ادمین بی‌تایپ بود). */
export type ProductDto = Product

/**
 * stage-47 — منطق مشترک تخفیف زمان‌دار (محصول + سایز):
 *  پنجره = [startsAt, endsAt]؛ هر طرف NULL = آن طرف باز. خارج از پنجره →
 *  تخفیف غیرفعال (قیمت کامل). درِ آینده هم غیرفعال است (تخفیف هنوز شروع
 *  نشده) — شمارنده‌ی معکوس فقط وقتی فعال است نمایش داده می‌شود.
 */
export function isDiscountWindowActive(
  startsAt: Date | null | undefined,
  endsAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  const t = now.getTime()
  if (startsAt && t < startsAt.getTime()) return false
  if (endsAt && t > endsAt.getTime()) return false
  return true
}

/** stage-47 — تخفیف محصول همین لحظه فعال است؟ (درصد>0 + داخل پنجره) */
export function discountActiveNow(
  p: { discountPercentage: number; discountStartsAt?: Date | null; discountEndsAt?: Date | null },
  now: Date = new Date(),
): boolean {
  return p.discountPercentage > 0 && isDiscountWindowActive(p.discountStartsAt, p.discountEndsAt, now)
}

/**
 * قیمت نهایی محصول — stage-47: فقط با «درصدِ فعال» محاسبه می‌شود؛
 * خارج از پنجره‌ی زمانی، درصد نادیده و قیمت کامل برمی‌گردد.
 */
export function finalPriceOf(
  p: {
    originalPrice: number
    discountPercentage: number
    discountStartsAt?: Date | null
    discountEndsAt?: Date | null
  },
  now: Date = new Date(),
): number {
  const pct = discountActiveNow(p, now) ? p.discountPercentage : 0
  return Math.round(p.originalPrice * (1 - pct / 100))
}

/** stage-47 — تخفیف سایز همین لحظه فعال است؟ */
export function sizeDiscountActiveNow(
  s: { discountPercentage: number; discountStartsAt?: Date | null; discountEndsAt?: Date | null },
  now: Date = new Date(),
): boolean {
  return s.discountPercentage > 0 && isDiscountWindowActive(s.discountStartsAt, s.discountEndsAt, now)
}

/** stage-47 — قیمت مؤثر یک سایز با تخفیف زمان‌دار مستقل خودش */
export function sizeFinalPriceOf(
  s: {
    price: number
    discountPercentage: number
    discountStartsAt?: Date | null
    discountEndsAt?: Date | null
  },
  now: Date = new Date(),
): number {
  const pct = sizeDiscountActiveNow(s, now) ? s.discountPercentage : 0
  return Math.round(s.price * (1 - pct / 100))
}

/**
 * stage-47 — نرمال‌سازی ورودی زمانی فرم/روت (ISO string | Date | null)
 * → Date | null. مقدار خراب/نامعتبر → null (بدون کرش — قانون طلایی بک‌اند).
 */
export function asDiscountDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v
  if (typeof v !== 'string' || v.trim() === '') return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * stage-47 — ورودی سایز از فرم/روت: قیمت + تخفیف مستقل (درصد + پنجره).
 * تایپ مستقل تا create/update/insertSizes/upsert همه یک قرارداد داشته باشند.
 */
export interface SizeInput {
  name: string
  nameAr?: string | null
  price: number
  discountPercentage?: number
  discountStartsAt?: Date | string | null
  discountEndsAt?: Date | string | null
}

/** stage-47 — گیره‌ی درصد ۰..۱۰۰ (مقدار خارج محدوده → قیچی، نه خطا) */
function clampPercent(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(100, Math.round(n))
}

export type ProductRow = typeof products.$inferSelect
export type ProductSizeRow = typeof productSizes.$inferSelect
export type CategoryRow = typeof categories.$inferSelect
export type MainCategoryRow = typeof mainCategories.$inferSelect

/**
 * stage-48 — حالت‌های مؤثر سفارشِ یک محصول = پرچم دسته AND پرچم محصول.
 * قفل سلسله‌مراتبی: دسته خاموش ⇒ محصول هرچه باشد، مؤثراً خاموش است.
 * دستهِ ناموجود (legacy) = هر سه روشن (پیش‌فرض مهاجرت).
 */
export interface OrderModes {
  courier: boolean
  takeaway: boolean
  dineIn: boolean
}

export const ALL_MODES_ON: OrderModes = { courier: true, takeaway: true, dineIn: true }

export function categoryModesOf(c: CategoryRow | undefined | null): OrderModes {
  if (!c) return ALL_MODES_ON
  return {
    courier: c.courierEnabled && true,
    takeaway: c.takeawayEnabled && true,
    dineIn: c.dineInEnabled && true,
  }
}

/** دسته‌ای از دسته‌ها → نقشۀ حالت‌ها (یک کوئری، همه‌ی ردیف‌ها) */
export async function loadCategoryModes(
  db: DbOrTx,
  ids: readonly string[],
): Promise<Map<CategoryId, OrderModes>> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return new Map()
  const rows = await db
    .select({
      id: categories.id,
      courierEnabled: categories.courierEnabled,
      takeawayEnabled: categories.takeawayEnabled,
      dineInEnabled: categories.dineInEnabled,
    })
    .from(categories)
    .where(inArray(categories.id, unique as CategoryId[]))
  const out = new Map<CategoryId, OrderModes>()
  for (const r of rows) {
    out.set(r.id, {
      courier: r.courierEnabled,
      takeaway: r.takeawayEnabled,
      dineIn: r.dineInEnabled,
    })
  }
  return out
}

/**
 * round-34 — نمای عمومی دسته: COALESCE(ar, fa) روی نام و قالب سایزها.
 * nameAr/sizeNamesAr نگه داشته می‌شوند (فیلد اختیاری قرارداد shared؛ مصرف‌کننده‌ی
 * عمومی نادیده‌شان می‌گیرد، ادمین برای ویرایش می‌خواندش).
 */
function categoryView(c: CategoryRow, lang: Lang) {
  return {
    ...c,
    name: pickAr(lang, c.nameAr, c.name),
    sizeNames: pickArArr(lang, c.sizeNamesAr, c.sizeNames ?? []),
  }
}

/** round-34 — نمای عمومی main: مثل categoryView فقط برای تب‌های منو */
function mainCategoryView(m: MainCategoryRow, lang: Lang) {
  return { ...m, name: pickAr(lang, m.nameAr, m.name) }
}

/** پایه‌های قیمت‌گذاری دسته‌ای — خروجی loadPricingBases */
export interface PricingBases {
  productMap: Map<ProductId, ProductRow>
  sizesByProduct: Map<ProductId, ProductSizeRow[]>
}

/**
 * perf-fix (کار-۲) + round-28 — پایه‌های قیمت‌گذاری دسته‌ای:
 * ۱ کوئری محصولات (یکتا) + ۱ کوئری همه‌ی سایزها — به‌جای ۲-۳ کوئری به‌ازای
 * هر آیتم. چک‌اوت/preview (داخل tx خودش را می‌دهد) و سبد خرید (بدون tx)
 * هر دو از همین یک پیاده‌سازی می‌خوانند — DRY. ترتیب sortOrder صعودی مثل
 * قبل حفظ می‌شود. «سیاستِ انتخاب» سایز نزد مصرف‌کننده می‌ماند چون دوگانه
 * است: سبد آسان‌گیر (پشتیبان اولین سایز) و چک‌اوت سخت‌گیر (خطا روی سایز
 * حذف‌شده) — ادغامشان با پرچم، کد را کثیف می‌کرد.
 */
export async function loadPricingBases(
  db: DbOrTx,
  items: readonly { productId: string }[],
): Promise<PricingBases> {
  const ids = [...new Set(items.map((i) => asProductId(i.productId)))]
  const rows = ids.length
    ? await db.select().from(products).where(inArray(products.id, ids))
    : []
  const productMap = new Map(rows.map((p) => [p.id, p]))

  const sizedIds = rows.filter((p) => p.sizesEnabled).map((p) => p.id)
  const sizeRows = sizedIds.length
    ? await db
        .select()
        .from(productSizes)
        .where(inArray(productSizes.productId, sizedIds))
        .orderBy(productSizes.sortOrder)
    : []
  const sizesByProduct = new Map<ProductId, ProductSizeRow[]>()
  for (const s of sizeRows) {
    const list = sizesByProduct.get(s.productId) ?? []
    list.push(s)
    sizesByProduct.set(s.productId, list)
  }
  return { productMap, sizesByProduct }
}

/**
 * منو — عمومی با کش ردیس (نسخه‌دار) + مدیریت ادمین مستقیم DB.
 *
 * کش نسخه‌دار: کلید = menu:v{ver}:... ؛ نامعتبرسازی = INCR menu:ver.
 * بدون SCAN/پترن — ساده‌ترین مکانیزم با کمترین حالت خراب.
 *
 * perf-fix (کار-۴): single-flight — در لحظه‌ی expire (لحظه‌ی پیک‌ترافیک)
 * ده‌ها request موازی همزمان miss می‌زدند و همه loader را اجرا می‌کردند
 * (thundering herd روی DB). الان اولین miss صاحب یک promise درون‌حافظه‌ای
 * است و بقیه به همان نتیجه می‌پیوندند.
 */
export class MenuService {
  constructor(private readonly deps: {
    db: Db
    redis: RedisService
    /** stage-48 — پخش نوتیفیکیشن تخفیف (اختیاری؛ fail-soft) */
    notifications?: NotificationService
    /** stage-48 — SSE عمومی menu:live (اختیاری؛ fail-soft) */
    hub?: SseHub
  }) {
    // رارد ۴۸ — ماشین‌آلات کش به VersionedCache مشترک رفت؛ کلید‌ها و
    // رفتار بایت‌به‌بایت همان قبل است (menu:v{ver}:...)
    this.cache = new VersionedCache({
      redis: deps.redis,
      versionKey: VERSION_KEY,
      prefix: 'menu',
      ttlSeconds: CACHE_TTL_SECONDS,
    })
  }

  private readonly cache: VersionedCache

  /**
   * round-35 — باطل‌کردن عمومی کش منو بعد از ترجمه‌ی خودکار.
   * صف ترجمه ستون‌های ar را مستقیم روی ردیف‌ها می‌نویسد (بیرون از
   * متدهای write ادمین)؛ این متد همان INCR نسخه را برایش انجام می‌دهد
   * تا کاربر عربی کشِ قدیمیِ فارسی را نبیند.
   */
  async bustCache(): Promise<void> {
    await this.cache.invalidate()
  }

  // ── عمومی ──

  /** Main های فعال — پیش‌فرض اول، بعد sortOrder */
  async activeMainCategories(lang: Lang = 'fa') {
    return this.cache.cached(`mains:${lang}:active`, async () => {
      const rows = await this.deps.db
        .select()
        .from(mainCategories)
        .where(eq(mainCategories.isActive, true))
        .orderBy(asc(mainCategories.sortOrder))
      return rows
        .map((m) => mainCategoryView(m, lang))
        .sort((a, b) => {
          if (a.isDefault && !b.isDefault) return -1
          if (!a.isDefault && b.isDefault) return 1
          return a.sortOrder - b.sortOrder
        })
    })
  }

  async categoriesByMain(slug: string, lang: Lang = 'fa') {
    return this.cache.cached(`cats:${lang}:${slug}`, async () => {
      const main = await this.deps.db.query.mainCategories.findFirst({
        where: and(eq(mainCategories.slug, slug), eq(mainCategories.isActive, true)),
      })
      if (!main) return []
      const rows = await this.deps.db
        .select()
        .from(categories)
        .where(eq(categories.mainCategoryId, main.id))
      return rows.map((c) => categoryView(c, lang))
    })
  }

  async productsByMain(slug: string, lang: Lang = 'fa') {
    return this.cache.cached(`prods:${lang}:${slug}`, async () => {
      const main = await this.deps.db.query.mainCategories.findFirst({
        where: and(eq(mainCategories.slug, slug), eq(mainCategories.isActive, true)),
      })
      if (!main) return { products: [] as ProductDto[], categories: [] }
      const cats = await this.deps.db
        .select()
        .from(categories)
        .where(eq(categories.mainCategoryId, main.id))
      if (cats.length === 0) {
        return { products: [] as ProductDto[], categories: cats.map((c) => categoryView(c, lang)) }
      }

      const rows = await this.deps.db
        .select()
        .from(products)
        .where(
          and(
            inArray(
              products.categoryId,
              cats.map((c) => c.id),
            ),
            eq(products.status, 'ACTIVE'),
          ),
        )
        .orderBy(desc(products.createdAt))

      // round-34 — نام دسته هم COALESCE: categoryName در حالت عربی عربی می‌شود
      const catMap = new Map(
        cats.map((c) => [c.id, pickAr(lang, c.nameAr, c.name)] as const),
      )
      // stage-48 — نقشه‌ی حالت‌های دسته برای محاسبه‌ی حالت مؤثر هر محصول
      const catModes = new Map(
        cats.map((c) => [c.id, categoryModesOf(c)] as const),
      )
      return {
        products: await this.withSizes(rows, catMap, lang, { catModes }),
        categories: cats.map((c) => categoryView(c, lang)),
      }
    })
  }

  async productById(id: string, lang: Lang = 'fa'): Promise<ProductDto | null> {
    const pid = asProductId(id)

    const load = async (): Promise<ProductDto | null> => {
      const row = await this.deps.db.query.products.findFirst({
        where: eq(products.id, pid),
      })
      if (!row) return null
      const cat = await this.deps.db.query.categories.findFirst({
        where: eq(categories.id, row.categoryId),
      })
      const list = await this.withSizes(
        [row],
        new Map([[row.categoryId, pickAr(lang, cat?.nameAr, cat?.name ?? '')]]),
        lang,
        // stage-48 — حالت مؤثر = دسته AND محصول
        { catModes: new Map([[row.categoryId, categoryModesOf(cat)]]) },
      )
      return list[0] ?? null
    }

    // کار-۴: همان single-flight — جزئیات محصول در صفحه‌ی محصول می‌تواند
    // هم‌زمان توسط SSR + چند کامپوننت درخواست شود.
    // null کش نمی‌شود (مثل قبل) — محصولِ حذف‌شده بعد از نامعتبرسازی دوباره پرسیده می‌شود
    return this.cache.cachedNullable(`prod:${lang}:${id}`, load)
  }

  async allCategories(lang: Lang = 'fa') {
    return this.cache.cached(`cats:${lang}:all`, async () =>
      (
        await this.deps.db.select().from(categories).orderBy(asc(categories.name))
      ).map((c) => categoryView(c, lang)),
    )
  }

  // ── قیمت‌گذاری ──
  // round-28 — effectivePrice تک‌محصولی حذف شد؛ تنها مصرف‌کننده‌اش (سبد)
  // حالا از loadPricingBases مشترک با چک‌اوت می‌خواند (بالای فایل).

  // ── ادمین: Main ها ──

  async adminMainCategories() {
    return this.deps.db.select().from(mainCategories).orderBy(asc(mainCategories.sortOrder))
  }

  async createMainCategory(
    name: string,
    slug: string,
    nameAr?: string | null,
  ): Promise<{ success: boolean; message?: string }> {
    const clean = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
    if (!clean) return { success: false, message: 'slug معتبر نیست (مثلا: cafe)' }
    const clash = await this.deps.db.query.mainCategories.findFirst({
      where: eq(mainCategories.slug, clean),
    })
    if (clash) return { success: false, message: 'این slug قبلاً ثبت شده' }

    const all = await this.adminMainCategories()
    await this.deps.db.insert(mainCategories).values({
      name: name.trim(),
      nameAr: nullIfEmpty(nameAr),
      slug: clean,
      isActive: false,
      isDefault: false,
      sortOrder: all.length + 1,
    } as typeof mainCategories.$inferInsert)
    await this.cache.invalidate()
    return { success: true }
  }

  async toggleMainCategory(id: string): Promise<void> {
    const mcId = asMainCategoryId(id)
    const row = await this.deps.db.query.mainCategories.findFirst({
      where: eq(mainCategories.id, mcId),
    })
    if (!row) return
    await this.deps.db
      .update(mainCategories)
      .set({ isActive: !row.isActive })
      .where(eq(mainCategories.id, mcId))
    await this.cache.invalidate()
  }

  async setDefaultMainCategory(id: string): Promise<{ success: boolean; message?: string }> {
    const mcId = asMainCategoryId(id)
    const target = await this.deps.db.query.mainCategories.findFirst({
      where: eq(mainCategories.id, mcId),
    })
    if (!target) return { success: false, message: 'دسته اصلی پیدا نشد' }
    if (!target.isActive) return { success: false, message: 'پیش‌فرض باید فعال باشد' }

    await this.deps.db.transaction(async (tx) => {
      await tx.update(mainCategories).set({ isDefault: false })
      await tx
        .update(mainCategories)
        .set({ isDefault: true })
        .where(eq(mainCategories.id, mcId))
    })
    await this.cache.invalidate()
    return { success: true }
  }

  async reorderMainCategory(id: string, direction: 'up' | 'down'): Promise<void> {
    const sorted = await this.adminMainCategories()
    const idx = sorted.findIndex((m) => m.id === id)
    if (idx === -1) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= sorted.length) return

    const a = sorted[idx]!
    const b = sorted[swapIdx]!
    await this.deps.db.transaction(async (tx) => {
      await tx.update(mainCategories).set({ sortOrder: b.sortOrder }).where(eq(mainCategories.id, a.id))
      await tx.update(mainCategories).set({ sortOrder: a.sortOrder }).where(eq(mainCategories.id, b.id))
    })
    await this.cache.invalidate()
  }

  async deleteMainCategory(id: string): Promise<{ success: boolean; message?: string }> {
    const mcId = asMainCategoryId(id)
    const childCount = await this.deps.db
      .select({ count: sql<number>`count(*)::int` })
      .from(categories)
      .where(eq(categories.mainCategoryId, mcId))
      .then((r) => r[0]?.count ?? 0)
    if (childCount > 0) {
      return { success: false, message: 'ابتدا دسته‌های زیرمجموعه را منتقل یا حذف کنید' }
    }
    await this.deps.db.delete(mainCategories).where(eq(mainCategories.id, mcId))
    await this.cache.invalidate()
    return { success: true }
  }

  // ── ادمین: دسته‌ها ──

  async createCategory(input: {
    name: string
    mainCategoryId: string
    hasSizes: boolean
    sizeNames: string[]
    /** round-34 — نام عربی + قالب سایزهای عربی (موازی با sizeNames) */
    nameAr?: string | null
    sizeNamesAr?: string[] | null
    /** stage-48 — حالت‌های سفارش پایه (پیش‌فرض هر سه روشن) */
    courierEnabled?: boolean
    takeawayEnabled?: boolean
    dineInEnabled?: boolean
  }): Promise<{ success: boolean; message?: string }> {
    const slug = await this.uniqueCategorySlug(input.name.trim())
    await this.deps.db.insert(categories).values({
      name: input.name.trim(),
      nameAr: nullIfEmpty(input.nameAr),
      slug,
      mainCategoryId: asMainCategoryId(input.mainCategoryId),
      hasSizes: input.hasSizes,
      sizeNames: input.hasSizes ? input.sizeNames : [],
      sizeNamesAr: input.hasSizes && input.sizeNamesAr && input.sizeNamesAr.length > 0 ? input.sizeNamesAr : null,
      // stage-48 — حالت‌های سفارش (undefined = پیش‌فرض روشن)
      courierEnabled: input.courierEnabled ?? true,
      takeawayEnabled: input.takeawayEnabled ?? true,
      dineInEnabled: input.dineInEnabled ?? true,
    } as typeof categories.$inferInsert)
    await this.cache.invalidate()
    return { success: true }
  }

  async updateCategory(input: {
    id: string
    name: string
    mainCategoryId: string
    hasSizes: boolean
    sizeNames: string[]
    /** round-34 — نام عربی + قالب سایزهای عربی (موازی با sizeNames) */
    nameAr?: string | null
    sizeNamesAr?: string[] | null
    /** stage-48 — حالت‌های سفارش پایه (undefined = دست‌نخورده) */
    courierEnabled?: boolean
    takeawayEnabled?: boolean
    dineInEnabled?: boolean
  }): Promise<void> {
    const catId = asCategoryId(input.id)
    // stage-48 — ردیف قبلی برای تشخیص تغییر حالت‌ها (SSE + قید ارث‌بری)
    const before = await this.deps.db.query.categories.findFirst({
      where: eq(categories.id, catId),
    })
    await this.deps.db
      .update(categories)
      .set({
        name: input.name.trim(),
        nameAr: nullIfEmpty(input.nameAr),
        mainCategoryId: asMainCategoryId(input.mainCategoryId),
        hasSizes: input.hasSizes,
        sizeNames: input.hasSizes ? input.sizeNames : [],
        sizeNamesAr: input.hasSizes && input.sizeNamesAr && input.sizeNamesAr.length > 0 ? input.sizeNamesAr : null,
        ...(input.courierEnabled !== undefined ? { courierEnabled: input.courierEnabled } : {}),
        ...(input.takeawayEnabled !== undefined ? { takeawayEnabled: input.takeawayEnabled } : {}),
        ...(input.dineInEnabled !== undefined ? { dineInEnabled: input.dineInEnabled } : {}),
      })
      .where(eq(categories.id, catId))
    await this.cache.invalidate()

    // stage-48 — تغییر حالت‌های دسته ⇒ همه‌ی محصولات ذیلش مؤثراً عوض می‌شوند →
    // سبد/چک‌اوتِ باز باید فوراً رفرش شوند (رویداد عمومی بدون productId).
    if (
      before &&
      (before.courierEnabled !== (input.courierEnabled ?? before.courierEnabled) ||
        before.takeawayEnabled !== (input.takeawayEnabled ?? before.takeawayEnabled) ||
        before.dineInEnabled !== (input.dineInEnabled ?? before.dineInEnabled))
    ) {
      this.publishMenuLive({ productId: null, reason: 'category' })
    }
  }

  async deleteCategory(id: string): Promise<{ success: boolean; message?: string }> {
    const catId = asCategoryId(id)
    const productCount = await this.deps.db
      .select({ count: sql<number>`count(*)::int` })
      .from(products)
      .where(eq(products.categoryId, catId))
      .then((r) => r[0]?.count ?? 0)
    if (productCount > 0) {
      return { success: false, message: 'ابتدا محصولات این دسته را منتقل یا حذف کنید' }
    }
    await this.deps.db.delete(categories).where(eq(categories.id, catId))
    await this.cache.invalidate()
    return { success: true }
  }

  // ── ادمین: محصولات ──

  async adminProducts(filters: {
    page: number
    limit: number
    search?: string
    status?: string
    categoryId?: string
  }): Promise<{ products: ProductDto[]; total: number }> {
    const conditions: SQL[] = []
    if (filters.search) conditions.push(ilike(products.name, `%${filters.search}%`))
    if (filters.status && filters.status !== 'all') {
      conditions.push(eq(products.status, filters.status))
    }
    if (filters.categoryId && filters.categoryId !== 'all') {
      conditions.push(eq(products.categoryId, asCategoryId(filters.categoryId)))
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined

    const total = await this.deps.db
      .select({ count: sql<number>`count(*)::int` })
      .from(products)
      .where(where)
      .then((r) => r[0]?.count ?? 0)

    const rows = await this.deps.db
      .select()
      .from(products)
      .where(where)
      .orderBy(desc(products.createdAt))
      .limit(filters.limit)
      .offset((filters.page - 1) * filters.limit)

    const catIds = [...new Set(rows.map((r) => r.categoryId))]
    const cats = catIds.length
      ? await this.deps.db
        .select({
          id: categories.id,
          name: categories.name,
          courierEnabled: categories.courierEnabled,
          takeawayEnabled: categories.takeawayEnabled,
          dineInEnabled: categories.dineInEnabled,
        })
        .from(categories)
        .where(inArray(categories.id, catIds))
      : []
    const catMap = new Map(cats.map((c) => [c.id, c.name]))
    // stage-48 — حالت مؤثر = دسته AND محصول
    const catModes = new Map(
      cats.map((c) => [
        c.id,
        { courier: c.courierEnabled, takeaway: c.takeawayEnabled, dineIn: c.dineInEnabled } satisfies OrderModes,
      ]),
    )

    return { products: await this.withSizes(rows, catMap, undefined, { catModes }), total }
  }

  async adminProductDetails(id: string): Promise<ProductDto | null> {
    // round-34 — فرم ویرایش ادمین هر دو زبان را می‌خواهد: ردیف خام + ar،
    // بدون کش عمومی و بدون نگاشت زبان (ادمین فارسی‌زبان است، fa مبنا)
    const pid = asProductId(id)
    const row = await this.deps.db.query.products.findFirst({
      where: eq(products.id, pid),
    })
    if (!row) return null
    const cat = await this.deps.db.query.categories.findFirst({
      where: eq(categories.id, row.categoryId),
    })
    const list = await this.withSizes([row], new Map([[row.categoryId, cat?.name ?? '']]), 'fa', {
      includeAr: true,
      // stage-48 — حالت مؤثر = دسته AND محصول (فرم ادمین برای قفل سوئیچ‌ها)
      catModes: new Map([[row.categoryId, categoryModesOf(cat)]]),
    })
    return list[0] ?? null
  }

  async createProduct(input: {
    name: string
    description: string
    originalPrice: number
    discountPercentage: number
    /** stage-47 — پنجره‌ی زمانی تخفیف محصول (null = بدون محدودیت) */
    discountStartsAt?: Date | string | null
    discountEndsAt?: Date | string | null
    prepTime: number
    categoryId: string
    packagingCost?: number
    profileImage?: string | null
    galleryImages?: string[]
    sizesEnabled?: boolean
    /** stage-47 — تخفیف مستقل هر سایز (درصد + پنجره) */
    sizes?: SizeInput[]
    ingredients?: string[]
    /** round-34 — محتوای عربی (اختیاری؛ خالی = NULL = پشتیبان فارسی) */
    nameAr?: string | null
    descriptionAr?: string | null
    ingredientsAr?: string[] | null
    /** stage-48 — موجودی فروش (پیش‌فرض true) */
    isAvailable?: boolean
    /** stage-48 — پرچم‌های حالت سفارش (پیش‌فرض true = ارث کامل از دسته) */
    courierAllowed?: boolean
    takeawayAllowed?: boolean
    dineInAllowed?: boolean
  }): Promise<{ success: boolean; id?: string; message?: string }> {
    const nameAr = nullIfEmpty(input.nameAr)
    const descriptionAr = nullIfEmpty(input.descriptionAr)
    // stage-47 — درصد صفر ⇒ پنجره بی‌معناست؛ تمیز ذخیره می‌کنیم (null)
    const pct = clampPercent(input.discountPercentage)
    const hasWindow = pct > 0
    const [created] = await this.deps.db
      .insert(products)
      .values({
        name: input.name,
        description: input.description,
        // round-34 — ذخیره‌ی دستی ادمین: arAuto=false (بج «دستی»)
        nameAr,
        descriptionAr,
        ingredientsAr: input.ingredientsAr && input.ingredientsAr.length > 0 ? input.ingredientsAr : null,
        arAuto: false,
        originalPrice: input.originalPrice,
        discountPercentage: pct,
        discountStartsAt: hasWindow ? asDiscountDate(input.discountStartsAt) : null,
        discountEndsAt: hasWindow ? asDiscountDate(input.discountEndsAt) : null,
        prepTime: input.prepTime,
        packagingCost: input.packagingCost ?? 0,
        categoryId: asCategoryId(input.categoryId),
        profileImage: input.profileImage ?? null,
        galleryImages: input.galleryImages ?? [],
        sizesEnabled: input.sizesEnabled ?? false,
        ingredients: input.ingredients ?? [],
        status: 'ACTIVE',
        // stage-48 — موجودی + حالت‌های سفارش (پیش‌فرض روشن = ارث از دسته)
        isAvailable: input.isAvailable ?? true,
        courierAllowed: input.courierAllowed ?? true,
        takeawayAllowed: input.takeawayAllowed ?? true,
        dineInAllowed: input.dineInAllowed ?? true,
      } as typeof products.$inferInsert)
      .returning()
    if (!created) return { success: false, message: 'ذخیره‌سازی ناموفق بود' }

    if (input.sizesEnabled && input.sizes?.length) {
      await this.insertSizes(created.id, input.sizes)
    }
    await this.cache.invalidate()

    // stage-48 — تخفیف فعال هنگام ساخت ⇒ پخش فوری به همه (بدون کرون)
    await this.broadcastDiscountIfActive(created)
    return { success: true, id: created.id }
  }

  async updateProduct(input: {
    id: string
    name: string
    description: string
    originalPrice: number
    discountPercentage: number
    /** stage-47 — پنجره‌ی زمانی تخفیف محصول (null = بدون محدودیت) */
    discountStartsAt?: Date | string | null
    discountEndsAt?: Date | string | null
    prepTime: number
    packagingCost?: number
    profileImage?: string | null
    galleryImages?: string[]
    sizesEnabled?: boolean
    /** stage-47 — تخفیف مستقل هر سایز (درصد + پنجره) */
    sizes?: SizeInput[]
    ingredients?: string[]
    /** round-34 — محتوای عربی (اختیاری؛ خالی = NULL = پشتیبان فارسی) */
    nameAr?: string | null
    descriptionAr?: string | null
    ingredientsAr?: string[] | null
    /** stage-48 — موجودی فروش (undefined = دست‌نخورده) */
    isAvailable?: boolean
    /** stage-48 — پرچم‌های حالت سفارش (undefined = دست‌نخورده) */
    courierAllowed?: boolean
    takeawayAllowed?: boolean
    dineInAllowed?: boolean
  }): Promise<void> {
    const pid = asProductId(input.id)
    // stage-48 — ردیف قبلی: تشخیص تغییر موجودی/حالت (SSE) + تغییر تخفیف (پخش)
    const before = await this.deps.db.query.products.findFirst({
      where: eq(products.id, pid),
    })
    // round-34 — نرمال‌سازی: '' → NULL؛ مواد اولیه‌ی خالی → NULL
    const nameAr = nullIfEmpty(input.nameAr)
    const descriptionAr = nullIfEmpty(input.descriptionAr)
    const ingredientsAr =
      input.ingredientsAr && input.ingredientsAr.length > 0 ? input.ingredientsAr : null
    // stage-47 — درصد نرمال + پنجره (درصد ۰ ⇒ پنجره null).
    // «نیامدن هر دو فیلد زمانی» = کلاینت قدیمی → مقدار موجود حفظ می‌شود
    // (همان قاعده‌ی packagingCost؛ drizzle مقدار undefined را از SET حذف می‌کند).
    const pct = clampPercent(input.discountPercentage)
    const hasWindow = pct > 0
    const windowFields =
      input.discountStartsAt === undefined && input.discountEndsAt === undefined
        ? {}
        : {
            discountStartsAt: hasWindow ? asDiscountDate(input.discountStartsAt) : null,
            discountEndsAt: hasWindow ? asDiscountDate(input.discountEndsAt) : null,
          }
    await this.deps.db
      .update(products)
      .set({
        name: input.name,
        description: input.description,
        // round-34 — ذخیره‌ی دستی ادمین همیشه پرچم «خودکار» را برمی‌گرداند:
        // مقدار عربی دارد → «دستی»؛ همه خالی → بدون ترجمه (NULL ها بالا مشخص شدند)
        nameAr,
        descriptionAr,
        ingredientsAr,
        arAuto: false,
        originalPrice: input.originalPrice,
        discountPercentage: pct,
        ...windowFields,
        prepTime: input.prepTime,
        // round-11 (اسکن M-3): undefined یعنی «فیلد نیامده» (کلاینت قدیمی/اسکریپت)
        // → مقدار موجود حفظ می‌شود، نه صفرِ بی‌صدا (درآمد بسته‌بندی از دست نمی‌رود).
        // drizzle مقدار undefined را از SET حذف می‌کند.
        ...(input.packagingCost !== undefined ? { packagingCost: input.packagingCost } : {}),
        profileImage: input.profileImage ?? null,
        galleryImages: input.galleryImages ?? [],
        sizesEnabled: input.sizesEnabled ?? false,
        ingredients: input.ingredients ?? [],
        // stage-48 — موجودی/حالت‌ها: undefined = حفظ مقدار قبلی (دراپ Removes undefined از SET)
        ...(input.isAvailable !== undefined ? { isAvailable: input.isAvailable } : {}),
        ...(input.courierAllowed !== undefined ? { courierAllowed: input.courierAllowed } : {}),
        ...(input.takeawayAllowed !== undefined ? { takeawayAllowed: input.takeawayAllowed } : {}),
        ...(input.dineInAllowed !== undefined ? { dineInAllowed: input.dineInAllowed } : {}),
        updatedAt: new Date(),
      })
      .where(eq(products.id, pid))

    // ── phase-2: آیدی پایدار سایزها ──
    // قبلاً: حذف همه + اینسرت با UUID جدید → سبدِ مشتری که sizeId قدیمی
    // داشت یا خطا می‌خورد یا بی‌سروصدا اولین سایز قیمت می‌شد. الان:
    //   • نام موجود → همان ردیف، فقط price/sortOrder/nameAr آپدیت (id ثابت)
    //   • نام جدید → insert | نام حذف‌شده → delete
    //   • sizesEnabled=false → دست نمی‌زنیم (برای فعال‌سازی مجدد حفظ می‌شوند)
    if (input.sizesEnabled && input.sizes) {
      const sizes = input.sizes // ← رفع خطای TS: narrowing برای داخل callback
      await this.deps.db.transaction(async (tx) => {
        const existing = await tx
          .select()
          .from(productSizes)
          .where(eq(productSizes.productId, pid))
        const byName = new Map(existing.map((s) => [s.name, s]))

        const keepIds = new Set<string>()
        let order = 0
        for (const s of sizes) {
          // stage-47 — تخفیف مستقل هر سایز (نرمال + قیچی)
          const sizePct = clampPercent(s.discountPercentage ?? 0)
          const sizeWindow =
            sizePct > 0
              ? {
                  discountPercentage: sizePct,
                  discountStartsAt: asDiscountDate(s.discountStartsAt),
                  discountEndsAt: asDiscountDate(s.discountEndsAt),
                }
              : { discountPercentage: 0, discountStartsAt: null, discountEndsAt: null }
          const match = byName.get(s.name)
          if (match) {
            await tx
              .update(productSizes)
              .set({ price: s.price, sortOrder: order, nameAr: nullIfEmpty(s.nameAr), ...sizeWindow })
              .where(eq(productSizes.id, match.id))
            keepIds.add(match.id)
          } else {
            const [ins] = await tx
              .insert(productSizes)
              .values({
                productId: pid,
                name: s.name,
                nameAr: nullIfEmpty(s.nameAr),
                price: s.price,
                sortOrder: order,
                ...sizeWindow,
              })
              .returning({ id: productSizes.id })
            if (ins) keepIds.add(ins.id)
          }
          order++
        }

        const stale = existing.filter((s) => !keepIds.has(s.id)).map((s) => s.id)
        if (stale.length > 0) {
          await tx.delete(productSizes).where(inArray(productSizes.id, stale))
        }
      })
    }

    await this.cache.invalidate()

    // ── stage-48: عوارض زنده ──
    const after = await this.deps.db.query.products.findFirst({
      where: eq(products.id, pid),
    })
    if (after) {
      // ۱) تغییر موجودی/حالت/وضعیت ⇒ SSE فوری برای سبد/چک‌اوت‌های باز
      const modesOrStatusChanged =
        (input.isAvailable !== undefined && before?.isAvailable !== input.isAvailable) ||
        (input.courierAllowed !== undefined && before?.courierAllowed !== input.courierAllowed) ||
        (input.takeawayAllowed !== undefined && before?.takeawayAllowed !== input.takeawayAllowed) ||
        (input.dineInAllowed !== undefined && before?.dineInAllowed !== input.dineInAllowed) ||
        before?.status !== after.status
      if (modesOrStatusChanged) {
        await this.publishProductLive(after)
      }
      // ۲) تخفیف مادی/جدید فعال شد ⇒ پخش فوری نوتیفیکیشن به همه
      await this.broadcastDiscountIfActive(after, before)
    }
  }

  async toggleProductStatus(id: string): Promise<void> {
    const row = await this.deps.db.query.products.findFirst({
      where: eq(products.id, asProductId(id)),
    })
    if (!row) return
    await this.deps.db
      .update(products)
      .set({ status: row.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE', updatedAt: new Date() })
      .where(eq(products.id, row.id))
    await this.cache.invalidate()
    // stage-48 — سبد/چک‌اوتِ باز باید فوراً بداند (محصول از منو رفت/برگشت)
    await this.publishProductLive({ ...row, status: row.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' })
  }

  /**
   * stage-48 — موجود/ناموجود کردن سریع محصول (بدون فرم کامل).
   * جدا از toggleProductStatus (وضعیت منو) است: ناموجود = از فروش موقتاً خارج
   * ولی در منو می‌ماند (کارت تار + هشدار نارنجی).
   */
  async setProductAvailability(id: string, available: boolean): Promise<{ success: boolean; message?: string }> {
    const pid = asProductId(id)
    const row = await this.deps.db.query.products.findFirst({
      where: eq(products.id, pid),
    })
    if (!row) return { success: false, message: 'محصول پیدا نشد' }
    if (row.isAvailable === available) {
      return { success: true, message: available ? 'از قبل موجود است' : 'از قبل ناموجود است' }
    }
    await this.deps.db
      .update(products)
      .set({ isAvailable: available, updatedAt: new Date() })
      .where(eq(products.id, pid))
    await this.cache.invalidate()
    await this.publishProductLive({ ...row, isAvailable: available })
    return { success: true }
  }

  // ── داخلی ──

  private async insertSizes(
    productId: ProductId,
    sizes: SizeInput[],
  ) {
    await this.deps.db.insert(productSizes).values(
      sizes.map((s, i) => {
        // stage-47 — تخفیف مستقل هر سایز (نرمال + قیچی)
        const sizePct = clampPercent(s.discountPercentage ?? 0)
        return {
          productId,
          name: s.name,
          nameAr: nullIfEmpty(s.nameAr),
          price: s.price,
          discountPercentage: sizePct,
          discountStartsAt: sizePct > 0 ? asDiscountDate(s.discountStartsAt) : null,
          discountEndsAt: sizePct > 0 ? asDiscountDate(s.discountEndsAt) : null,
          sortOrder: i,
        }
      }),
    )
  }

  private async withSizes(
    rows: Array<typeof products.$inferSelect>,
    catMap: Map<CategoryId, string>,
    lang: Lang = 'fa',
    opts?: {
      /** round-34 — پاسخ ادمین: فیلدهای ar خام هم برگردند (فرم ویرایش) */
      includeAr?: boolean
      /** stage-48 — حالت‌های دسته برای محاسبه‌ی حالت مؤثر (نیامد = همه روشن) */
      catModes?: Map<CategoryId, OrderModes>
    },
  ): Promise<ProductDto[]> {
    const sizedIds = rows.filter((r) => r.sizesEnabled).map((r) => r.id)
    const sizeRows = sizedIds.length
      ? await this.deps.db
        .select()
        .from(productSizes)
        .where(inArray(productSizes.productId, sizedIds))
        .orderBy(asc(productSizes.sortOrder))
      : []
    const sizeMap = new Map<ProductId, typeof sizeRows>()
    for (const s of sizeRows) {
      const list = sizeMap.get(s.productId) ?? []
      list.push(s)
      sizeMap.set(s.productId, list)
    }

    const now = new Date()

    return rows.map((r) => ({
      id: r.id,
      name: pickAr(lang, r.nameAr, r.name),
      description: pickAr(lang, r.descriptionAr, r.description ?? ''),
      originalPrice: r.originalPrice,
      finalPrice: finalPriceOf(r, now),
      discountPercentage: r.discountPercentage,
      // stage-47 — تخفیف زمان‌دار: فعال‌بودنِ همین لحظه + پنجره (ISO | null)
      discountActive: discountActiveNow(r, now),
      discountStartsAt: r.discountStartsAt?.toISOString() ?? null,
      discountEndsAt: r.discountEndsAt?.toISOString() ?? null,
      packagingCost: r.packagingCost,
      categoryId: r.categoryId,
      categoryName: catMap.get(r.categoryId),
      profileImage: r.profileImage,
      galleryImages: r.galleryImages ?? [],
      sizesEnabled: r.sizesEnabled,
      sizes: (sizeMap.get(r.id) ?? []).map((s) => ({
        id: s.id,
        name: pickAr(lang, s.nameAr, s.name),
        price: s.price,
        // stage-47 — تخفیف مستقِ این سایز + قیمت مؤثر + فعال‌بودن پنجره
        discountPercentage: s.discountPercentage,
        discountActive: sizeDiscountActiveNow(s, now),
        finalPrice: sizeFinalPriceOf(s, now),
        discountStartsAt: s.discountStartsAt?.toISOString() ?? null,
        discountEndsAt: s.discountEndsAt?.toISOString() ?? null,
        // round-34 — فقط پاسخ ادمین: نام عربی خام سایز برای فرم ویرایش
        ...(opts?.includeAr ? { nameAr: s.nameAr ?? null } : {}),
      })),
      ingredients: pickArArr(lang, r.ingredientsAr, r.ingredients ?? []),
      prepTime: r.prepTime,
      views: r.views,
      sales: r.sales,
      status: r.status,
      // ── stage-48 — موجودی + حالت‌های مؤثر سفارش (دسته AND محصول) ──
      isAvailable: r.isAvailable,
      courierAllowed: (opts?.catModes?.get(r.categoryId)?.courier ?? true) && r.courierAllowed,
      takeawayAllowed: (opts?.catModes?.get(r.categoryId)?.takeaway ?? true) && r.takeawayAllowed,
      dineInAllowed: (opts?.catModes?.get(r.categoryId)?.dineIn ?? true) && r.dineInAllowed,
      // round-34 — فقط پاسخ ادمین (فرم ویرایش دوزبانه؛ بج دستی/خودکار/ندارد)
      ...(opts?.includeAr
        ? {
            nameAr: r.nameAr ?? null,
            descriptionAr: r.descriptionAr ?? null,
            ingredientsAr: r.ingredientsAr ?? null,
            arAuto: r.arAuto,
            /** stage-48 — قفل سوئیچ‌های فرم: دسته خاموش ⇒ محصول نمی‌تواند روشن کند */
            categoryCourierEnabled: opts.catModes?.get(r.categoryId)?.courier ?? true,
            categoryTakeawayEnabled: opts.catModes?.get(r.categoryId)?.takeaway ?? true,
            categoryDineInEnabled: opts.catModes?.get(r.categoryId)?.dineIn ?? true,
          }
        : {}),
    }))
  }

  private async uniqueCategorySlug(name: string): Promise<string> {
    const base = name.replace(/\s+/g, '-').toLowerCase() || 'cat'
    let slug = base
    let i = 1
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const clash = await this.deps.db.query.categories.findFirst({
        where: eq(categories.slug, slug),
      })
      if (!clash) return slug
      slug = `${base}-${++i}`
    }
  }

  // ═══ stage-48 — ابزارهای زنده (SSE + پخش تخفیف) ═══

  /**
   * publish روی کانال عمومی menu:live — مشترکین (سبد/چک‌اوتِ باز، حتی مهمان)
   * رویداد را می‌گیرند و جزئیات سبد/پیش‌نمایش را رفرش می‌کنند.
   * هرگز throw نمی‌شود (fail-soft).
   */
  private async publishMenuLive(data: {
    productId: string | null
    reason?: string
    isAvailable?: boolean
    courierAllowed?: boolean
    takeawayAllowed?: boolean
    dineInAllowed?: boolean
  }): Promise<void> {
    try {
      this.deps.hub?.publish('menu:live', {
        event: 'menu',
        data: {
          productId: data.productId,
          reason: data.reason ?? 'product',
          isAvailable: data.isAvailable,
          courierAllowed: data.courierAllowed,
          takeawayAllowed: data.takeawayAllowed,
          dineInAllowed: data.dineInAllowed,
          at: new Date().toISOString(),
        },
      })
    } catch (err) {
      console.error('[menu] publish menu:live ناموفق:', err)
    }
  }

  /** ردیف محصول (یا آبجکت ترکیبی) → رویداد زنده با حالت‌های مؤثر */
  private async publishProductLive(
    row: Pick<
      typeof products.$inferSelect,
      | 'id' | 'categoryId' | 'status'
      | 'isAvailable' | 'courierAllowed' | 'takeawayAllowed' | 'dineInAllowed'
    >,
  ): Promise<void> {
    const modes = await loadCategoryModes(this.deps.db, [row.categoryId]).then(
      (m) => m.get(row.categoryId) ?? ALL_MODES_ON,
    )
    await this.publishMenuLive({
      productId: row.id,
      reason: 'product',
      isAvailable: row.isAvailable,
      courierAllowed: modes.courier && row.courierAllowed,
      takeawayAllowed: modes.takeaway && row.takeawayAllowed,
      dineInAllowed: modes.dineIn && row.dineInAllowed,
    })
  }

  /**
   * stage-48 — بهترین درصد تخفیفِ «فعال» یک ردیف محصول:
   * بدون سایز → تخفیف خود محصول؛ با سایز → بیشترین تخفیف فعالِ سایزها.
   */
  private async bestActiveDiscountPct(
    row: Pick<
      typeof products.$inferSelect,
      'id' | 'sizesEnabled' | 'discountPercentage' | 'discountStartsAt' | 'discountEndsAt'
    >,
  ): Promise<number> {
    if (!row.sizesEnabled) {
      return discountActiveNow(row) ? row.discountPercentage : 0
    }
    const sizes = await this.deps.db
      .select()
      .from(productSizes)
      .where(eq(productSizes.productId, asProductId(row.id)))
    let best = 0
    for (const s of sizes) {
      if (sizeDiscountActiveNow(s) && s.discountPercentage > best) best = s.discountPercentage
    }
    return best
  }

  /**
   * stage-48 — پخش فوری نوتیفیکیشن «تخفیف محصول» به همه‌ی کاربران.
   *   • create: تخفیف فعال ⇒ پخش.
   *   • update: فقط وقتی تخفیف «مادی» تغییر کرده (درصد/پنجره/سایز‌ها) و نتیجه
   *     فعال است — ویرایش‌های بی‌ربط به تخفیف (مثلاً توضیحات) پخش نمی‌شوند.
   * خروجی system در notification_log ثبت می‌شود. هرگز throw نمی‌شود.
   */
  private async broadcastDiscountIfActive(
    after: Pick<
      typeof products.$inferSelect,
      | 'id' | 'name' | 'categoryId' | 'sizesEnabled' | 'status'
      | 'discountPercentage' | 'discountStartsAt' | 'discountEndsAt'
      | 'isAvailable' | 'courierAllowed' | 'takeawayAllowed' | 'dineInAllowed'
    >,
    before?: typeof products.$inferSelect | null,
  ): Promise<void> {
    try {
      const svc = this.deps.notifications
      if (!svc) return
      if (after.status !== 'ACTIVE') return

      const pctAfter = await this.bestActiveDiscountPct(after)
      if (pctAfter <= 0) return

      let materialChange = true
      if (before) {
        const pctBefore = await this.bestActiveDiscountPct(before)
        const windowChanged =
          before.discountStartsAt?.getTime() !== after.discountStartsAt?.getTime() ||
          before.discountEndsAt?.getTime() !== after.discountEndsAt?.getTime() ||
          before.sizesEnabled !== after.sizesEnabled
        materialChange = pctBefore !== pctAfter || windowChanged || pctBefore === 0
        if (!materialChange) return
      }

      await svc.broadcast({
        type: 'product_discount',
        title: '🎉 تخفیف ویژه در سین‌شین!',
        body: `«${after.name}» الان با ${pctAfter}٪ تخفیف در دسترس است — همین حالا سفارش بده.`,
        url: `/products/${after.id}`,
        data: { productId: after.id, discount: pctAfter },
      })
      console.log(`[menu] discount broadcast: ${after.name} (${pctAfter}%)`)
    } catch (err) {
      console.error('[menu] discount broadcast ناموفق:', err)
    }
  }
}