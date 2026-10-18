// ═══════════════════════════════════════════════════════════════
// stage-69 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/domain/menu/menu.service.ts
// ویرایش نقطه‌ای (اسکن post-s67 — F4): رقم درصدِ پخش تخفیف محصول
// در متن اعلان فارسی شد — «٪۱۵» به‌جای «15» (هم‌راستا با یادآور
// کوپن/گرنت و قرارداد faNum). شرطِ material-change و بقیه‌ی منطق
// عیناً دست‌نخورده.
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// stage-56 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/domain/menu/menu.service.ts
// تغییر:
//   ۱) slug محصول — sanitize + یکتاییِ دوستانه + جست‌وجوی detail با UUID یا
//        slug (productById) + عبور slug در همه‌ی DTOها (withSizes)
//   ۲) تصویر مستقل هر variant — SizeInput.image + درج/آپدیت سایزها + DTO
//   ۳) updateProduct پیام‌دار شد برای clashِ slug (پاسخ دوستانه)
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// stage-55 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/domain/menu/menu.service.ts
// وضعیت: جایگزینی کامل فایل موجود
// تغییر: escape wildcard جستجو با likePattern
// ═══════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════
// stage-60 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/domain/menu/menu.service.ts
// تغییر (راند ۲):
//   ۱) اشتراک دسته بین چند والد — catsOfMain (FK ∪ category_mains)
//        + create/updateCategory با mainCategoryIds + allCategories
//        با mainCategoryIds در نمای عمومی
//   ۲) M2M محصول↔دسته — productsByMain/adminProducts با شرط OR روی
//        خودِ جدول products (بدون join → بدون تکرار) + categoryIds در
//        همه‌ی DTOها (withSizes) + create/updateProduct با categoryIds
//   ۳) isFeatured — ستون جدید، گذر کامل در DTO؛ منطق چینش سمت فرانت
// ═══════════════════════════════════════════════════════════

//src/domain/menu/menu.service.ts
import { and, asc, desc, eq, ilike, inArray, ne, or, sql, type SQL } from 'drizzle-orm'

import type { Db, DbOrTx } from '#/infra/db/client'
import type { RedisService } from '#/infra/redis/redis'
import type { SseHub } from '#/infra/realtime/sse-hub'
import type { NotificationService } from '#/domain/notification/notification.service'
import { VersionedCache } from '#/domain/shared/versioned-cache'
import {
  categories,
  categoryMains,
  mainCategories,
  packagingItems,
  productCategories,
  productPackagingItems,
  productSizes,
  products,
} from '#/infra/db/schema'
import {
  asCategoryId,
  asMainCategoryId,
  asProductId,
  type CategoryId,
  type MainCategoryId,
  type ProductId,
} from '#/domain/shared/brand'
import { nullIfEmpty, pickAr, pickArArr, type Lang } from '#/domain/shared/lang'
import { isUniqueViolation, likePattern } from '#/domain/shared/pg'
import { Err } from '#/domain/shared/errors'
import { UUID_RE } from '#/domain/shared/ids'
// stage-69 (F4) — رقم فارسی متن اعلان (قرارداد واحد domain/report/format)
import { faNum } from '#/domain/report/format'
// stage-86 — DTO وضعیت خرید دسته‌ها (پاسخ GET /admin/menu/purchase-state)
import type { Product, PurchaseStateDto } from '@sinshin/shared'

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
  /**
   * stage-56 — تصویر مستقل این variant (آپلودی؛ null/خالی = بدون تصویر →
   * گالری همان تصاویر مشترک محصول). در آپدیت: undefined = دست‌نخورده.
   */
  image?: string | null
}

/** stage-47 — گیره‌ی درصد ۰..۱۰۰ (مقدار خارج محدوده → قیچی، نه خطا) */
function clampPercent(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(100, Math.round(n))
}

/**
 * stage-56 — نرمال‌سازی slug محصول برای URL سئوپسند:
 *  • حروف کوچک + هر رانِ غیرمجاز → یک خط تیره + قیچی خط‌تیره‌های ابتدا/انها
 *  • محدود به ۸۰ کاراکتر (هم‌عرض ستون DB)
 *  • ورودی خالی/بی‌حرفِ لاتین → null (یعنی «بدون slug» → URL همان UUID)
 */
function sanitizeProductSlug(raw: string | null | undefined): string | null {
  const clean = (raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return clean.length > 0 ? clean.slice(0, 80) : null
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
 * stage-86 — وضعیت خریدِ هر دسته از زنجیره‌ی اولیه: purchaseEnabled خودِ
 * دسته AND والدِ اولیه‌اش (categories.mainCategoryId). نام‌ها هم برای
 * پیام‌های خطای سبد/چک‌اوت برمی‌گردند. الگوی loadCategoryModes (یک
 * کوئری با join؛ idهای تکراری یک‌بار). غایب = همه روشن (fail-open
 * نمایشی — گارد واقعی پولی در سبد/چک‌اوت سخت‌گیر است).
 */
export interface CategoryPurchaseState {
  categoryPurchase: boolean
  mainPurchase: boolean
  categoryName: string
  mainName: string
}

export async function loadCategoryPurchaseStates(
  db: DbOrTx,
  ids: readonly string[],
): Promise<Map<CategoryId, CategoryPurchaseState>> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return new Map()
  const rows = await db
    .select({
      id: categories.id,
      categoryPurchase: categories.purchaseEnabled,
      categoryName: categories.name,
      mainPurchase: mainCategories.purchaseEnabled,
      mainName: mainCategories.name,
    })
    .from(categories)
    // والدِ اولیه — زنجیره‌ی مؤثرِ خرید (مسیر پول همیشه primary است)
    .innerJoin(mainCategories, eq(mainCategories.id, categories.mainCategoryId))
    .where(inArray(categories.id, unique as CategoryId[]))
  const out = new Map<CategoryId, CategoryPurchaseState>()
  for (const r of rows) {
    out.set(r.id, {
      categoryPurchase: r.categoryPurchase,
      mainPurchase: r.mainPurchase,
      categoryName: r.categoryName,
      mainName: r.mainName,
    })
  }
  return out
}

/**
 * round-34 — نمای عمومی دسته: COALESCE(ar, fa) روی نام و قالب سایزها.
 * nameAr/sizeNamesAr نگه داشته می‌شوند (فیلد اختیاری قرارداد shared؛ مصرف‌کننده‌ی
 * عمومی نادیده‌شان می‌گیرد، ادمین برای ویرایش می‌خواندش).
 */
function categoryView(c: CategoryRow, lang: Lang, mainIds?: MainCategoryId[]) {
  return {
    ...c,
    // stage-60 — همه‌ی والدهای دسته (والدِ اولیه اول؛ برای فرم چند-والدی ادمین)
    mainCategoryIds: mainIds ?? [c.mainCategoryId],
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
  /**
   *  stage-84 — هزینه بسته‌بندیِ مؤثر هر محصول = جمعِ اقلامِ فعالِ انتخابی‌اش.
   *  فقط برای محصولاتی که حداقل یک لینکِ junction دارند مقدار دارد؛ بقیه →
   *  undefined یعنی «پشتیبانِ ستون legacy packaging_cost» (رفتار قبلی).
   */
  packagingByProduct: Map<ProductId, number | undefined>
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
  options: { includePackaging?: boolean } = {},
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

  // stage-84 — اقلام بسته‌بندی انتخابی + قیمت سراسری‌شان (join روی junction).
  // «undefined» عمدی است: محصولِ بدون لینک → پشتیبانِ ستونِ legacy (بالای فایل).
  const packagingByProduct = new Map<ProductId, number | undefined>()
  if (ids.length > 0 && options.includePackaging !== false) {
    const itemRows = await db
      .select({
        productId: productPackagingItems.productId,
        price: packagingItems.price,
        isActive: packagingItems.isActive,
      })
      .from(productPackagingItems)
      .innerJoin(packagingItems, eq(packagingItems.id, productPackagingItems.packagingItemId))
      .where(inArray(productPackagingItems.productId, ids))
    for (const r of itemRows) {
      const cur = packagingByProduct.get(r.productId)
      if (cur === undefined) {
        // اولین لینک این محصول → حتی اگر قلم غیرفعال باشد «سهم» را ۰ شروع کن
        packagingByProduct.set(r.productId, r.isActive ? r.price : 0)
      } else if (r.isActive) {
        packagingByProduct.set(r.productId, (cur ?? 0) + r.price)
      }
    }
  }
  return { productMap, sizesByProduct, packagingByProduct }
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

  /** Global packaging changes affect every open checkout that uses these items. */
  async notifyPackagingChanged(): Promise<void> {
    await this.cache.invalidate()
    await this.publishMenuLive({ productId: null, reason: 'packaging' })
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
      // stage-60 — دسته‌های این والد = FK اصلی ∪ لینک‌های اشتراک
      const rows = await this.catsOfMain(main.id)
      return rows.map((c) => categoryView(c, lang))
    })
  }

  /**
   * stage-60 — دسته‌های یک والد: فرزندانِ FK اصلی + دسته‌های مشترک از
   * category_mains (بدون تکرار؛ والدِ اولیه اول). جدول اشتراک فقط
   * «لینک‌های اضافه» را دارد، پس روی خودِ categories دوتایی رخ نمی‌دهد.
   */
  private async catsOfMain(mainId: MainCategoryId): Promise<CategoryRow[]> {
    const primary = await this.deps.db
      .select()
      .from(categories)
      .where(eq(categories.mainCategoryId, mainId))
    const linked = await this.deps.db
      .select({ cat: categories })
      .from(categoryMains)
      .innerJoin(categories, eq(categories.id, categoryMains.categoryId))
      .where(eq(categoryMains.mainId, mainId))
    const seen = new Set(primary.map((c) => c.id))
    const out = [...primary]
    for (const { cat } of linked) {
      if (!seen.has(cat.id)) {
        seen.add(cat.id)
        out.push(cat)
      }
    }
    return out
  }

  async productsByMain(slug: string, lang: Lang = 'fa') {
    return this.cache.cached(`prods:${lang}:${slug}`, async () => {
      const main = await this.deps.db.query.mainCategories.findFirst({
        where: and(eq(mainCategories.slug, slug), eq(mainCategories.isActive, true)),
      })
      if (!main) return { products: [] as ProductDto[], categories: [] }
      const cats = await this.catsOfMain(main.id)
      if (cats.length === 0) {
        return { products: [] as ProductDto[], categories: cats.map((c) => categoryView(c, lang)) }
      }

      // stage-60 — محصولات این والد = دسته‌ی اولیه در دسته‌های این والد ∪
      // لینک‌های اضافه‌ی product_categories به این دسته‌ها. شرط OR روی
      // خودِ جدول products (بدون join) → هر محصول حداکثر یک‌بار برمی‌گردد.
      const catIds = cats.map((c) => c.id)
      const linkedIds = [
        ...new Set(
          (
            await this.deps.db
              .select({ productId: productCategories.productId })
              .from(productCategories)
              .where(inArray(productCategories.categoryId, catIds))
          ).map((r) => r.productId),
        ),
      ]
      const catCond = linkedIds.length
        ? or(inArray(products.categoryId, catIds), inArray(products.id, linkedIds))
        : inArray(products.categoryId, catIds)

      const rows = await this.deps.db
        .select()
        .from(products)
        .where(and(catCond, eq(products.status, 'ACTIVE')))
        .orderBy(desc(products.createdAt))

      // stage-60 — دسته‌های اضافه‌ی هر محصول (categoryIds در DTO) +
      // نام/حالتِ دسته‌ی اولیه‌ی محصولاتی که از والد دیگری آمده‌اند.
      // حالت‌های سفارش همیشه از دسته‌ی اولیه — سازگار با سبد/چک‌اوت.
      const links = rows.length
        ? await this.deps.db
          .select()
          .from(productCategories)
          .where(inArray(productCategories.productId, rows.map((r) => r.id)))
        : []
      const extraByProduct = new Map<ProductId, CategoryId[]>()
      for (const l of links) {
        const list = extraByProduct.get(l.productId) ?? []
        list.push(l.categoryId)
        extraByProduct.set(l.productId, list)
      }
      const categoryIdsMap = new Map<ProductId, CategoryId[]>(
        rows.map((r) => [r.id, [r.categoryId, ...(extraByProduct.get(r.id) ?? [])]]),
      )
      const missingPrimary = [
        ...new Set(rows.filter((r) => !cats.some((c) => c.id === r.categoryId)).map((r) => r.categoryId)),
      ]
      let catRows: CategoryRow[] = cats
      if (missingPrimary.length > 0) {
        const more = await this.deps.db
          .select()
          .from(categories)
          .where(inArray(categories.id, missingPrimary))
        catRows = [...cats, ...more]
      }

      // round-34 — نام دسته هم COALESCE: categoryName در حالت عربی عربی می‌شود
      const catMap = new Map(
        catRows.map((c) => [c.id, pickAr(lang, c.nameAr, c.name)] as const),
      )
      // stage-48 — نقشه‌ی حالت‌های دسته برای محاسبه‌ی حالت مؤثر هر محصول
      const catModes = new Map(
        catRows.map((c) => [c.id, categoryModesOf(c)] as const),
      )
      // stage-86 — وضعیت خرید زنجیره‌ی اولیه برای purchasable هر محصول
      const catPurchase = await loadCategoryPurchaseStates(
        this.deps.db,
        catRows.map((c) => c.id),
      )
      return {
        products: await this.withSizes(rows, catMap, lang, { catModes, categoryIdsMap, catPurchase }),
        categories: cats.map((c) => categoryView(c, lang)),
      }
    })
  }

  async productById(id: string, lang: Lang = 'fa'): Promise<ProductDto | null> {
    // stage-56 — پذیرش UUID یا slug: الگوی دقیق UUID → جست‌وجو با id؛
    // در غیر این صورت رشته = slug (کاراکترهای a-z0-9-). مسیر روت با الگوی
    // SLUG_OR_ID_VALIDATE هر دو را می‌پذیرد؛ slugهایی که «عین UUID» باشند
    // مسیر id می‌گیرند (شکاف عملی ندارند — چنین slugای قابل تولید نیست).
    const pid = UUID_RE.test(id) ? asProductId(id) : null

    const load = async (): Promise<ProductDto | null> => {
      const row = await this.deps.db.query.products.findFirst({
        where: pid ? eq(products.id, pid) : eq(products.slug, id),
      })
      if (!row) return null
      const cat = await this.deps.db.query.categories.findFirst({
        where: eq(categories.id, row.categoryId),
      })
      // stage-60 — دسته‌های اضافه‌ی محصول (categoryIds در جزئیات)
      const extraCats = await this.deps.db
        .select({ categoryId: productCategories.categoryId })
        .from(productCategories)
        .where(eq(productCategories.productId, row.id))
      const categoryIdsMap = new Map<ProductId, CategoryId[]>([
        [row.id, [row.categoryId, ...extraCats.map((l) => l.categoryId)]],
      ])
      const list = await this.withSizes(
        [row],
        new Map([[row.categoryId, pickAr(lang, cat?.nameAr, cat?.name ?? '')]]),
        lang,
        // stage-48 — حالت مؤثر = دسته AND محصول
        {
          catModes: new Map([[row.categoryId, categoryModesOf(cat)]]),
          categoryIdsMap,
          // stage-86 — امکان خرید زنجیره‌ی اولیه (دکمه‌ی سبد صفحه‌ی محصول)
          catPurchase: await loadCategoryPurchaseStates(this.deps.db, [row.categoryId]),
        },
      )
      return list[0] ?? null
    }

    // کار-۴: همان single-flight — جزئیات محصول در صفحه‌ی محصول می‌تواند
    // هم‌زمان توسط SSR + چند کامپوننت درخواست شود.
    // null کش نمی‌شود (مثل قبل) — محصولِ حذف‌شده بعد از نامعتبرسازی دوباره پرسیده می‌شود
    return this.cache.cachedNullable(`prod:${lang}:${id}`, load)
  }

  async allCategories(lang: Lang = 'fa') {
    return this.cache.cached(`cats:${lang}:all`, async () => {
      const rows = await this.deps.db.select().from(categories).orderBy(asc(categories.name))
      // stage-60 — والدهای اضافه‌ی هر دسته (فرم چند-والدی ادمین) — یک کوئری
      const links = await this.deps.db.select().from(categoryMains)
      const extraByCat = new Map<CategoryId, MainCategoryId[]>()
      for (const l of links) {
        const list = extraByCat.get(l.categoryId) ?? []
        list.push(l.mainId)
        extraByCat.set(l.categoryId, list)
      }
      return rows.map((c) =>
        categoryView(c, lang, [c.mainCategoryId, ...(extraByCat.get(c.id) ?? [])]),
      )
    })
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

  // ═══ stage-86 — ادمین: غیرفعال‌سازی خریدِ دسته‌ها (والد + زیردسته) ═══
  // جدا از isActive (نمایش تب): خریدِ زنجیره‌ی اولیه قفل می‌شود؛ محصولات
  // می‌مانند و فقط «افزودن به سبد خرید» غیرقابل کلیک می‌شود. گارد روت:
  // productsWrite (ادمین اصلی همیشه؛ ادمین۲ با «ویرایش محصولات»).

  /** وضعیت خریدِ همه‌ی والدها + زیردسته‌ها برای پنل محصولات (بدون کش) */
  async adminPurchaseState(): Promise<PurchaseStateDto> {
    const mains = await this.deps.db
      .select({
        id: mainCategories.id,
        name: mainCategories.name,
        slug: mainCategories.slug,
        isActive: mainCategories.isActive,
        purchaseEnabled: mainCategories.purchaseEnabled,
      })
      .from(mainCategories)
      .orderBy(asc(mainCategories.sortOrder))
    const cats = await this.deps.db
      .select({
        id: categories.id,
        name: categories.name,
        mainCategoryId: categories.mainCategoryId,
        mainName: mainCategories.name,
        purchaseEnabled: categories.purchaseEnabled,
      })
      .from(categories)
      .innerJoin(mainCategories, eq(mainCategories.id, categories.mainCategoryId))
      .orderBy(asc(mainCategories.sortOrder), asc(categories.name))
    return { mains, categories: cats }
  }

  /** خریدِ همه‌ی محصولاتِ این والد را خاموش/روشن می‌کند */
  async setMainPurchase(
    id: string,
    enabled: boolean,
  ): Promise<{ success: boolean; message?: string }> {
    const mcId = asMainCategoryId(id)
    const row = await this.deps.db.query.mainCategories.findFirst({
      where: eq(mainCategories.id, mcId),
    })
    if (!row) return { success: false, message: 'دسته اصلی پیدا نشد' }
    if (row.purchaseEnabled === enabled) {
      return { success: true, message: enabled ? 'خرید از قبل فعال است' : 'خرید از قبل غیرفعال است' }
    }
    await this.deps.db
      .update(mainCategories)
      .set({ purchaseEnabled: enabled })
      .where(eq(mainCategories.id, mcId))
    await this.cache.invalidate()
    // سبد/چک‌اوتِ باز همان لحظه رفرش شوند (مصرف‌کننده‌های menu:live)
    await this.publishMenuLive({ productId: null, reason: 'category' })
    return { success: true }
  }

  /** خریدِ محصولاتِ این زیردسته را خاموش/روشن می‌کند */
  async setCategoryPurchase(
    id: string,
    enabled: boolean,
  ): Promise<{ success: boolean; message?: string }> {
    const catId = asCategoryId(id)
    const row = await this.deps.db.query.categories.findFirst({
      where: eq(categories.id, catId),
    })
    if (!row) return { success: false, message: 'دسته‌بندی پیدا نشد' }
    if (row.purchaseEnabled === enabled) {
      return { success: true, message: enabled ? 'خرید از قبل فعال است' : 'خرید از قبل غیرفعال است' }
    }
    await this.deps.db
      .update(categories)
      .set({ purchaseEnabled: enabled })
      .where(eq(categories.id, catId))
    await this.cache.invalidate()
    await this.publishMenuLive({ productId: null, reason: 'category' })
    return { success: true }
  }

  // ── ادمین: دسته‌ها ──

  async createCategory(input: {
    name: string
    /** stage-60 — چند-والدی: همه‌ی والدها (اول = والدِ اولیه). سازگار با تک‌مقداری قدیمی */
    mainCategoryIds?: string[]
    mainCategoryId?: string
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
    // stage-60 — حل والدها: آرایه مبناست؛ کلاینت قدیمی = تک‌مقداری
    const mainList = input.mainCategoryIds?.length
      ? input.mainCategoryIds
      : input.mainCategoryId
        ? [input.mainCategoryId]
        : []
    if (mainList.length === 0) {
      return { success: false, message: 'انتخاب دسته‌ی اصلی (والد) الزامی است' }
    }
    const primaryMain = asMainCategoryId(mainList[0]!)
    // لینک‌های اضافه = بقیه‌ی لیست (یکتا، بدون والدِ اولیه)
    const extraMains = [...new Set(mainList.slice(1).map((m) => asMainCategoryId(m)))].filter(
      (m) => m !== primaryMain,
    )
    const slug = await this.uniqueCategorySlug(input.name.trim())
    const [created] = await this.deps.db
      .insert(categories)
      .values({
        name: input.name.trim(),
        nameAr: nullIfEmpty(input.nameAr),
        slug,
        mainCategoryId: primaryMain,
        hasSizes: input.hasSizes,
        sizeNames: input.hasSizes ? input.sizeNames : [],
        sizeNamesAr: input.hasSizes && input.sizeNamesAr && input.sizeNamesAr.length > 0 ? input.sizeNamesAr : null,
        // stage-48 — حالت‌های سفارش (undefined = پیش‌فرض روشن)
        courierEnabled: input.courierEnabled ?? true,
        takeawayEnabled: input.takeawayEnabled ?? true,
        dineInEnabled: input.dineInEnabled ?? true,
      } as typeof categories.$inferInsert)
      .returning({ id: categories.id })
    // stage-60 — لینک والدهای اضافه (دسته‌ی مشترک بین چند تب منو)
    if (created && extraMains.length > 0) {
      await this.deps.db
        .insert(categoryMains)
        .values(extraMains.map((mainId) => ({ categoryId: created.id, mainId })))
    }
    await this.cache.invalidate()
    return { success: true }
  }

  async updateCategory(input: {
    id: string
    name: string
    /** stage-60 — چند-والدی: همه‌ی والدها (اول = والدِ اولیه). نیامد = دست‌نخورده */
    mainCategoryIds?: string[]
    mainCategoryId?: string
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
    // stage-60 — والدها: آرایه مبناست (اول = والدِ اولیه)؛ نیامد = دست‌نخورده
    const mainList =
      input.mainCategoryIds !== undefined
        ? input.mainCategoryIds
        : input.mainCategoryId !== undefined
          ? [input.mainCategoryId]
          : undefined
    const primaryMain = mainList?.length ? asMainCategoryId(mainList[0]!) : undefined
    await this.deps.db
      .update(categories)
      .set({
        name: input.name.trim(),
        nameAr: nullIfEmpty(input.nameAr),
        ...(primaryMain !== undefined ? { mainCategoryId: primaryMain } : {}),
        hasSizes: input.hasSizes,
        sizeNames: input.hasSizes ? input.sizeNames : [],
        sizeNamesAr: input.hasSizes && input.sizeNamesAr && input.sizeNamesAr.length > 0 ? input.sizeNamesAr : null,
        ...(input.courierEnabled !== undefined ? { courierEnabled: input.courierEnabled } : {}),
        ...(input.takeawayEnabled !== undefined ? { takeawayEnabled: input.takeawayEnabled } : {}),
        ...(input.dineInEnabled !== undefined ? { dineInEnabled: input.dineInEnabled } : {}),
      })
      .where(eq(categories.id, catId))

    // stage-60 — همگام‌سازی والدهای اضافه (حذفِ خارج از لیست + درجِ جدید).
    // جدول فقط لینک‌های اضافه را دارد؛ والدِ اولیه هرگز اینجا نمی‌نشیند.
    if (mainList && mainList.length > 0 && primaryMain !== undefined) {
      const extraMains = [...new Set(mainList.slice(1).map((m) => asMainCategoryId(m)))].filter(
        (m) => m !== primaryMain,
      )
      const existing = await this.deps.db
        .select()
        .from(categoryMains)
        .where(eq(categoryMains.categoryId, catId))
      const keep = new Set(extraMains)
      const staleMains = existing.filter((l) => !keep.has(l.mainId)).map((l) => l.mainId)
      if (staleMains.length > 0) {
        await this.deps.db
          .delete(categoryMains)
          .where(and(eq(categoryMains.categoryId, catId), inArray(categoryMains.mainId, staleMains)))
      }
      const have = new Set(existing.map((l) => l.mainId))
      const missing = extraMains.filter((m) => !have.has(m))
      if (missing.length > 0) {
        await this.deps.db
          .insert(categoryMains)
          .values(missing.map((mainId) => ({ categoryId: catId, mainId })))
      }
    }
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
    // stage-63 — حذف آبشاری (خواسته‌ی صریح کارفرما): با حذف دسته،
    // «تمام محصولات زیرش» هم حذف می‌شوند. زنجیره‌ی حذف را خودِ DB
    // هم‌اتمیک اجرا می‌کند (ON DELETE CASCADE روی FKها):
    //   categories → products (دسته‌ی اولیه) → product_sizes /
    //   product_categories / reviews
    // محصولاتِ M2M که «دسته‌ی اولیه‌ی»‌شان جای دیگری است فقط لینکِ
    // اضافه‌شان به این دسته جدا می‌شود (cascade روی product_categories)
    // و در دسته‌ی اولیه‌شان زنده می‌مانند — اشتراک دسته‌ها (stage-60)
    // نابود نمی‌شود. سفارش‌ها snapshot دارند (productId بدون FK) و
    // سبدِ باز، آیتمِ حذف‌شده را بی‌صدا skip می‌کند (cart.service).
    const productCount = await this.deps.db
      .select({ count: sql<number>`count(*)::int` })
      .from(products)
      .where(eq(products.categoryId, catId))
      .then((r) => r[0]?.count ?? 0)
    await this.deps.db.delete(categories).where(eq(categories.id, catId))
    await this.cache.invalidate()
    // سبد/چک‌اوت‌های باز (حتی مهمان) باید فوراً داده‌ی سروری‌شان را
    // رفرش کنند — محصولاتِ این دسته دیگر وجود ندارند (عین updateCategory).
    this.publishMenuLive({ productId: null, reason: 'category' })
    return {
      success: true,
      message:
        productCount > 0
          ? `دسته و ${productCount.toLocaleString('fa-IR')} محصولِ زیرش حذف شدند`
          : 'دسته‌بندی حذف شد',
    }
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
    // stage-55 — escape wildcard جستجو (٪ و _ و \) — الگوی امنِ «شامل»
    if (filters.search) conditions.push(ilike(products.name, likePattern(filters.search)))
    if (filters.status && filters.status !== 'all') {
      conditions.push(eq(products.status, filters.status))
    }
    if (filters.categoryId && filters.categoryId !== 'all') {
      // stage-60 — فیلتر دسته = دسته‌ی اولیه ∪ لینک اضافه (M2M)
      const catId = asCategoryId(filters.categoryId)
      const linkedIds = [
        ...new Set(
          (
            await this.deps.db
              .select({ productId: productCategories.productId })
              .from(productCategories)
              .where(eq(productCategories.categoryId, catId))
          ).map((r) => r.productId),
        ),
      ]
      conditions.push(
        linkedIds.length
          ? or(eq(products.categoryId, catId), inArray(products.id, linkedIds))!
          : eq(products.categoryId, catId),
      )
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

    // stage-60 — دسته‌های اضافه‌ی هر محصول (categoryIds در پاسخ ادمین)
    const links = rows.length
      ? await this.deps.db
        .select()
        .from(productCategories)
        .where(inArray(productCategories.productId, rows.map((r) => r.id)))
      : []
    const extraByProduct = new Map<ProductId, CategoryId[]>()
    for (const l of links) {
      const list = extraByProduct.get(l.productId) ?? []
      list.push(l.categoryId)
      extraByProduct.set(l.productId, list)
    }
    const categoryIdsMap = new Map<ProductId, CategoryId[]>(
      rows.map((r) => [r.id, [r.categoryId, ...(extraByProduct.get(r.id) ?? [])]]),
    )

    return {
      products: await this.withSizes(rows, catMap, undefined, {
        catModes,
        categoryIdsMap,
        // stage-86 — خریدِ زنجیره‌ی دسته برای بج قفل روی کارت لیست ادمین
        catPurchase: await loadCategoryPurchaseStates(this.deps.db, catIds),
      }),
      total,
    }
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
    // stage-60 — دسته‌های اضافه برای فرم ویرایش چند-دسته‌ای
    const extraCats = await this.deps.db
      .select({ categoryId: productCategories.categoryId })
      .from(productCategories)
      .where(eq(productCategories.productId, pid))
    const categoryIdsMap = new Map<ProductId, CategoryId[]>([
      [row.id, [row.categoryId, ...extraCats.map((l) => l.categoryId)]],
    ])
    // stage-84 — اقلام بسته‌بندیِ انتخابی برای فرم ویرایش (chips hydrate)
    const packagingRows = await this.deps.db
      .select({ packagingItemId: productPackagingItems.packagingItemId })
      .from(productPackagingItems)
      .where(eq(productPackagingItems.productId, pid))
    const list = await this.withSizes([row], new Map([[row.categoryId, cat?.name ?? '']]), 'fa', {
      includeAr: true,
      // stage-48 — حالت مؤثر = دسته AND محصول (فرم ادمین برای قفل سوئیچ‌ها)
      catModes: new Map([[row.categoryId, categoryModesOf(cat)]]),
      categoryIdsMap,
      // stage-86 — خریدِ زنجیره‌ی دسته (بج قفل فرم/کارت ادمین)
      catPurchase: await loadCategoryPurchaseStates(this.deps.db, [row.categoryId]),
    })
    const dto = list[0] ?? null
    if (dto) {
      dto.packagingItemIds = packagingRows.map((r) => r.packagingItemId)
    }
    return dto
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
    /** stage-60 — چند-دسته‌ای: همه‌ی دسته‌ها (اول = دسته‌ی اولیه). سازگار با تک‌مقداری قدیمی */
    categoryIds?: string[]
    categoryId?: string
    packagingCost?: number
    /** stage-84 — اقلام بسته‌بندیِ انتخابی (id های packaging_items) */
    packagingItemIds?: string[]
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
    /**
     * stage-56 — slug انگلیسی سئوپسند (اختیاری؛ خالی = بدون slug → URL با UUID).
     * نرمال‌سازی سروری + پیام دوستانه در تکرار.
     */
    slug?: string | null
    /** stage-60 — پرچم ویژه/سنجاق (۴ آیتم اول + Aurora در فرانت) */
    isFeatured?: boolean
  }): Promise<{ success: boolean; id?: string; message?: string }> {
    const nameAr = nullIfEmpty(input.nameAr)
    const descriptionAr = nullIfEmpty(input.descriptionAr)
    // stage-47 — درصد صفر ⇒ پنجره بی‌معناست؛ تمیز ذخیره می‌کنیم (null)
    const pct = clampPercent(input.discountPercentage)
    const hasWindow = pct > 0
    // stage-56 — slug نرمال‌شده (خالی → null) + پیش‌چکِ دوستانه‌ی تکرار
    const slug = sanitizeProductSlug(input.slug)
    if (slug) {
      const clash = await this.deps.db.query.products.findFirst({
        where: eq(products.slug, slug),
      })
      if (clash) return { success: false, message: 'این slug قبلاً برای محصول دیگری ثبت شده' }
    }
    // stage-60 — حل دسته‌ها: آرایه مبناست؛ کلاینت قدیمی = تک‌مقداری
    const catList = input.categoryIds?.length
      ? input.categoryIds
      : input.categoryId
        ? [input.categoryId]
        : []
    if (catList.length === 0) {
      return { success: false, message: 'انتخاب دسته‌ی محصول الزامی است' }
    }
    const primaryCat = asCategoryId(catList[0]!)
    // لینک‌های اضافه = بقیه‌ی لیست (یکتا، بدون دسته‌ی اولیه)
    const extraCats = [...new Set(catList.slice(1).map((c) => asCategoryId(c)))].filter(
      (c) => c !== primaryCat,
    )
    let created: typeof products.$inferSelect | undefined
    try {
      await this.deps.db.transaction(async (tx) => {
        await this.validatePackagingItems(tx, input.packagingItemIds)
        ;[created] = await tx
          .insert(products)
          .values({
            name: input.name,
            description: input.description,
            // round-34 — ذخیره‌ی دستی ادمین: arAuto=false (بج «دستی»)
            nameAr,
            descriptionAr,
            // stage-56 — slug سئوپسند (null = URL با UUID)
            slug,
            ingredientsAr: input.ingredientsAr && input.ingredientsAr.length > 0 ? input.ingredientsAr : null,
            arAuto: false,
            originalPrice: input.originalPrice,
            discountPercentage: pct,
            discountStartsAt: hasWindow ? asDiscountDate(input.discountStartsAt) : null,
            discountEndsAt: hasWindow ? asDiscountDate(input.discountEndsAt) : null,
            prepTime: input.prepTime,
            packagingCost: input.packagingCost ?? 0,
            categoryId: primaryCat,
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
            // stage-60 — پرچم ویژه/سنجاق
            isFeatured: input.isFeatured ?? false,
          } as typeof products.$inferInsert)
          .returning()

        if (!created) return
        if (input.sizesEnabled && input.sizes?.length) {
          await this.insertSizes(created.id, input.sizes, tx)
        }
        if (extraCats.length > 0) {
          await tx
            .insert(productCategories)
            .values(extraCats.map((categoryId) => ({ productId: created!.id, categoryId })))
        }
        if (input.packagingItemIds?.length) {
          await tx
            .insert(productPackagingItems)
            .values(
              [...new Set(input.packagingItemIds)].map((packagingItemId) => ({
                productId: created!.id,
                packagingItemId,
              })),
            )
            .onConflictDoNothing()
        }
      })
    } catch (e) {
      // stage-56 — رقابت همزمان روی slug (۲۳۵۰۵) → پیام دوستانه، نه 500
      if (isUniqueViolation(e)) {
        return { success: false, message: 'این slug یا نام سایز قبلاً ثبت شده' }
      }
      throw e
    }
    if (!created) return { success: false, message: 'ذخیره‌سازی ناموفق بود' }

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
    /**
     *  stage-84 — اقلام بسته‌بندیِ انتخابی (undefined = دست‌نخورده — کلاینت
     *  قدیمی/اسکریپت انتخاب‌ها را نمی‌پاکد؛ آرایه = همگام‌سازی کامل).
     */
    packagingItemIds?: string[]
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
    /**
     * stage-56 — slug سئوپسند: undefined = دست‌نخورده (کلاینت قدیمی)؛
     * رشته/null = تنظیم/پاک‌سازی (نرمال‌سازی سروری؛ خالی → null = UUID URL).
     */
    slug?: string | null
    /**
     * stage-60 — دسته‌های چندگانه (M2M): undefined = دست‌نخورده؛ آرایه =
     * همگام‌سازی کامل (عنصر اول = دسته‌ی اولیه جدید؛ بقیه = لینک‌های اضافه).
     */
    categoryIds?: string[]
    /** stage-60 — پرچم ویژه/سنجاق (undefined = دست‌نخورده) */
    isFeatured?: boolean
  }): Promise<{ success: boolean; message?: string }> {
    const pid = asProductId(input.id)
    // stage-48 — ردیف قبلی: تشخیص تغییر موجودی/حالت (SSE) + تغییر تخفیف (پخش)
    const before = await this.deps.db.query.products.findFirst({
      where: eq(products.id, pid),
    })
    if (!before) return { success: false, message: 'محصول پیدا نشد' }
    // stage-64 — عکسِ فوریِ «بهترین تخفیف فعالِ قبل» — قبل از هر تغییر در DB:
    // تراکنش سایزها پایین‌تر اجرا می‌شود و بعداً bestActiveDiscountPct(before)
    // دیگر سایزهای «قدیم» را نمی‌خواند (باگ ممیزی: ویرایش تخفیفِ سایز هرگز
    // پخش نمی‌شد چون pctBefore از سایزهای جدید حساب می‌شد و با pctAfter
    // برابر درمی‌آمد). این عکسِ فوری مرجع مقایسه است — ماتریس تست کارفرما:
    //   • سایز تکی/یکی از چند سایز تخفیف گرفت ⇒ یک اطلاعیه‌ی صحیح (نه تکراری)
    //   • ویرایش بی‌ربط (نام/توضیح) با تخفیف ثابت ⇒ بدون اطلاعیه‌ی جدید
    const beforeBestPct = before ? await this.bestActiveDiscountPct(before) : undefined
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
    // stage-56 — slug نرمال‌شده + پیش‌چکِ تکرار (خود محصول مستثناست).
    // undefined = دست‌نخورده؛ رشته/خالی = تنظیم/پاک‌سازی.
    const slug = input.slug === undefined ? undefined : sanitizeProductSlug(input.slug)
    if (slug) {
      const clash = await this.deps.db.query.products.findFirst({
        where: and(eq(products.slug, slug), ne(products.id, pid)),
      })
      if (clash) return { success: false, message: 'این slug قبلاً برای محصول دیگری ثبت شده' }
    }
    // stage-60 — دسته‌های چندگانه: undefined = دست‌نخورده؛ آرایه = همگام‌سازی
    const catList = input.categoryIds
    if (catList && catList.length === 0) {
      return { success: false, message: 'لیست دسته‌های محصول نمی‌تواند خالی باشد' }
    }
    const primaryCat = catList ? asCategoryId(catList[0]!) : undefined
    const extraCats = catList
      ? [...new Set(catList.slice(1).map((c) => asCategoryId(c)))].filter(
          (c) => c !== primaryCat,
        )
      : undefined
    let saved = false
    try {
      saved = await this.deps.db.transaction(async (tx) => {
        await this.validatePackagingItems(tx, input.packagingItemIds)
        const [updated] = await tx
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
            // stage-56 — slug: undefined = حفظ؛ رشته/خالی = تنظیم/پاک‌سازی
            ...(slug !== undefined ? { slug } : {}),
            // stage-60 — دسته‌ی اولیه (undefined = حفظ) + پرچم ویژه/سنجاق
            ...(primaryCat !== undefined ? { categoryId: primaryCat } : {}),
            ...(input.isFeatured !== undefined ? { isFeatured: input.isFeatured } : {}),
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
          .returning({ id: products.id })
        if (!updated) return false

        // ── stage-60: همگام‌سازی دسته‌های اضافه (M2M) ──
        // حذفِ خارج از لیست + درجِ جدید؛ جدول فقط دسته‌های اضافه را دارد.
        if (extraCats) {
          const existing = await tx
            .select()
            .from(productCategories)
            .where(eq(productCategories.productId, pid))
          const keep = new Set(extraCats)
          const staleCats = existing.filter((l) => !keep.has(l.categoryId)).map((l) => l.categoryId)
          if (staleCats.length > 0) {
            await tx
              .delete(productCategories)
              .where(
                and(eq(productCategories.productId, pid), inArray(productCategories.categoryId, staleCats)),
              )
          }
          const have = new Set(existing.map((l) => l.categoryId))
          const missing = extraCats.filter((c) => !have.has(c))
          if (missing.length > 0) {
            await tx
              .insert(productCategories)
              .values(missing.map((categoryId) => ({ productId: pid, categoryId })))
          }
        }

        // ── stage-84: همگام‌سازی اقلام بسته‌بندی (junction) ──
        // undefined = دست‌نخورده (کلاینت قدیمی)؛ آرایه (حتی خالی) = همگام‌سازی کامل.
        if (input.packagingItemIds) {
          const keepItems = [...new Set(input.packagingItemIds)].slice(0, 12)
          const existingItems = await tx
            .select()
            .from(productPackagingItems)
            .where(eq(productPackagingItems.productId, pid))
          const keepSet = new Set(keepItems)
          const staleItems = existingItems
            .filter((l) => !keepSet.has(l.packagingItemId))
            .map((l) => l.packagingItemId)
          if (staleItems.length > 0) {
            await tx
              .delete(productPackagingItems)
              .where(
                and(
                  eq(productPackagingItems.productId, pid),
                  inArray(productPackagingItems.packagingItemId, staleItems),
                ),
              )
          }
          const haveSet = new Set(existingItems.map((l) => l.packagingItemId))
          const missingItems = keepItems.filter((c) => !haveSet.has(c))
          if (missingItems.length > 0) {
            await tx
              .insert(productPackagingItems)
              .values(missingItems.map((packagingItemId) => ({ productId: pid, packagingItemId })))
              .onConflictDoNothing()
          }
        }

        // ── phase-2: آیدی پایدار سایزها ──
        // قبلاً: حذف همه + اینسرت با UUID جدید → سبدِ مشتری که sizeId قدیمی
        // داشت یا خطا می‌خورد یا بی‌سروصدا اولین سایز قیمت می‌شد. الان:
        //   • نام موجود → همان ردیف، فقط price/sortOrder/nameAr آپدیت (id ثابت)
        //   • نام جدید → insert | نام حذف‌شده → delete
        //   • sizesEnabled=false → دست نمی‌زنیم (برای فعال‌سازی مجدد حفظ می‌شوند)
        if (input.sizesEnabled && input.sizes) {
          const sizes = input.sizes // ← رفع خطای TS: narrowing برای داخل callback
          this.validateSizeNames(sizes)
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
                .set({
                  price: s.price,
                  sortOrder: order,
                  nameAr: nullIfEmpty(s.nameAr),
                  ...sizeWindow,
                  // stage-56 — تصویر variant: undefined = دست‌نخورده؛
                  // رشته/خالی = تنظیم/پاک‌سازی
                  ...(s.image !== undefined ? { image: nullIfEmpty(s.image) } : {}),
                })
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
                  // stage-56 — تصویر مستقل این variant
                  image: nullIfEmpty(s.image),
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
        }

        return true
      })
    } catch (e) {
      if (isUniqueViolation(e)) {
        return { success: false, message: 'این slug یا نام سایز قبلاً ثبت شده' }
      }
      throw e
    }
    if (!saved) return { success: false, message: 'محصول پیدا نشد' }

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
      if (input.packagingItemIds !== undefined || input.packagingCost !== undefined) {
        await this.publishMenuLive({ productId: pid, reason: 'packaging' })
      }
      // ۲) تخفیف مادی/جدید فعال شد ⇒ پخش فوری نوتیفیکیشن به همه
      // stage-64 — عکسِ فوریِ قبل پاس می‌شود (توضیح بالا)
      await this.broadcastDiscountIfActive(after, before, beforeBestPct)
    }
    // stage-56 — نتیجه‌ی پیام‌دار (clashِ slug بالاتر return می‌شود)
    return { success: true }
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

  /**
   * stage-63 — حذف کامل محصول (درخواست صریح کارفرما: «امکان حذف
   * محصولات باید فراهم بشه»). زنجیره‌ی حذف با ON DELETE CASCADE خودِ DB
   * هم‌اتمیک اجرا می‌شود: product_sizes / product_categories (لینک‌های
   * M2M) / reviews. آیتم‌های سفارش snapshot اند (productId بدون FK) و
   * می‌مانند؛ سبدِ باز آیتمِ حذف‌شده را skip می‌کند (cart.service) و
   * چک‌اوتِ بازِ همان آیتم، خطای واضح می‌گیرد — رویداد menu:live هم
   * آن‌ها را همان لحظه به رفرش وا می‌دارد.
   */
  async deleteProduct(id: string): Promise<{ success: boolean; message?: string }> {
    const pid = asProductId(id)
    const row = await this.deps.db.query.products.findFirst({
      where: eq(products.id, pid),
    })
    if (!row) return { success: false, message: 'محصول پیدا نشد' }
    await this.deps.db.delete(products).where(eq(products.id, pid))
    await this.cache.invalidate()
    // سبد/چک‌اوتِ باز باید فوراً بداند — دیگر وجود ندارد (هر سه حالت
    // سفارش + موجودی خاموش تا مصرف‌کننده‌ی SSE قفل/رفرش را نشان دهد).
    await this.publishMenuLive({
      productId: pid,
      reason: 'product',
      isAvailable: false,
      courierAllowed: false,
      takeawayAllowed: false,
      dineInAllowed: false,
    })
    return { success: true, message: `«${row.name}» حذف شد` }
  }

  // ── داخلی ──

  private validateSizeNames(sizes: SizeInput[]): void {
    if (new Set(sizes.map((size) => size.name)).size !== sizes.length) {
      throw Err.validation('نام سایزهای محصول نباید تکراری باشد.')
    }
  }

  private async validatePackagingItems(db: DbOrTx, ids?: string[]): Promise<void> {
    if (!ids?.length) return
    const clean = [...new Set(ids)]
    if (clean.length > 12 || clean.some((id) => !UUID_RE.test(id))) {
      throw Err.validation('انتخاب اقلام بسته‌بندی نامعتبر است.')
    }
    // Keep selected items alive until the complete product save commits.
    const rows = await db.select({ id: packagingItems.id }).from(packagingItems)
      .where(inArray(packagingItems.id, clean)).for('key share')
    if (rows.length !== clean.length) {
      throw Err.validation('یکی از اقلام بسته‌بندی حذف شده است — فهرست اقلام را به‌روز کنید.')
    }
  }

  private async insertSizes(
    productId: ProductId,
    sizes: SizeInput[],
    db: DbOrTx = this.deps.db,
  ) {
    this.validateSizeNames(sizes)
    await db.insert(productSizes).values(
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
          // stage-56 — تصویر مستقل این variant (null = تصویر مشترک محصول)
          image: nullIfEmpty(s.image),
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
      /** stage-60 — دسته‌های هر محصول (دسته‌ی اولیه اول)؛ نیامد = فقط اولیه */
      categoryIdsMap?: Map<ProductId, CategoryId[]>
      /** stage-86 — وضعیت خرید زنجیره‌ی اولیه (دسته AND والد)؛ نیامد = همه روشن */
      catPurchase?: Map<CategoryId, CategoryPurchaseState>
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
      // stage-56 — slug سئو (null = URL همان UUID) — در همه‌ی لیست‌ها حاضر
      slug: r.slug ?? null,
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
      // stage-60 — همه‌ی دسته‌های محصول (دسته‌ی اولیه اول؛ فیلتر چند-دسته‌ای فرانت)
      categoryIds: opts?.categoryIdsMap?.get(r.id) ?? [r.categoryId],
      // stage-60 — پرچم ویژه/سنجاق (چینش ۴-آیتم اول + Aurora در فرانت)
      isFeatured: r.isFeatured ?? false,
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
        // stage-56 — تصویر مستقل این variant (null = تصویر مشترک محصول)
        image: s.image ?? null,
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
      // ── stage-86 — امکان خرید از زنجیره‌ی دسته‌ی اولیه (دسته AND والد) ──
      // جداست از isAvailable (موجودی خودِ محصول): false = دکمه‌ی سبد قفل
      purchasable:
        (opts?.catPurchase?.get(r.categoryId)?.categoryPurchase ?? true) &&
        (opts?.catPurchase?.get(r.categoryId)?.mainPurchase ?? true),
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
   * stage-64 — پارامتر beforeBestPct: عکسِ فوریِ «بهترین تخفیف فعال» از
   * «قبل از تغییر» (برای سایزها — سایزها در تراکنش پایین‌تر جایگزین شده‌اند
   * و بازخوانیِ دوباره عددِ جدید را می‌دهد، نه قدیم را). بدون آن، ویرایشِ
   * تخفیفِ سایز هرگز پخش نمی‌شد. خروجی system در notification_log ثبت
   * می‌شود. هرگز throw نمی‌شود.
   */
  private async broadcastDiscountIfActive(
    after: Pick<
      typeof products.$inferSelect,
      | 'id' | 'name' | 'categoryId' | 'sizesEnabled' | 'status'
      | 'discountPercentage' | 'discountStartsAt' | 'discountEndsAt'
      | 'isAvailable' | 'courierAllowed' | 'takeawayAllowed' | 'dineInAllowed'
    >,
    before?: typeof products.$inferSelect | null,
    beforeBestPct?: number,
  ): Promise<void> {
    try {
      const svc = this.deps.notifications
      if (!svc) return
      if (after.status !== 'ACTIVE') return

      const pctAfter = await this.bestActiveDiscountPct(after)
      if (pctAfter <= 0) return

      let materialChange = true
      if (before) {
        // stage-64 — اولویت با عکسِ فوری (قبل از تغییرِ سایزها)؛ نبودش =
        // مسیر create یا فراخوان قدیمی — همان محاسبه‌ی زنده (رفتار قبلی)
        const pctBefore =
          beforeBestPct !== undefined ? beforeBestPct : await this.bestActiveDiscountPct(before)
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
        body: `«${after.name}» الان با ${faNum(pctAfter)}٪ تخفیف در دسترس است — همین حالا سفارش بده.`,
        url: `/products/${after.id}`,
        data: { productId: after.id, discount: pctAfter },
      })
      console.log(`[menu] discount broadcast: ${after.name} (${pctAfter}%)`)
    } catch (err) {
      console.error('[menu] discount broadcast ناموفق:', err)
    }
  }
}
