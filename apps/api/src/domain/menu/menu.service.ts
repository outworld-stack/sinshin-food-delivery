//src/domain/menu/menu.service.ts
import { and, asc, desc, eq, ilike, inArray, sql, type SQL } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import type { RedisService } from '#/infra/redis/redis'
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

const CACHE_TTL_SECONDS = 30
const VERSION_KEY = 'menu:ver'
/** DTO محصول — قرارداد فرانت (finalPrice محاسباتی، مثل موک) */
export interface ProductDto {
  id: string
  name: string
  description: string | null
  originalPrice: number
  finalPrice: number
  discountPercentage: number
  /** stage-10: هزینه بسته‌بندی هر واحد — فقط DELIVERY/PICKUP */
  packagingCost: number
  categoryId: string
  categoryName?: string
  profileImage: string | null
  galleryImages: string[]
  sizesEnabled: boolean
  sizes: { id: string; name: string; price: number }[]
  ingredients: string[]
  prepTime: number
  views: number
  sales: number
  status: string
}

export function finalPriceOf(p: { originalPrice: number; discountPercentage: number }): number {
  return Math.round(p.originalPrice * (1 - p.discountPercentage / 100))
}

/**
 * منو — عمومی با کش ردیس (نسخه‌دار) + مدیریت ادمین مستقیم DB.
 *
 * کش نسخه‌دار: کلید = menu:v{ver}:... ؛ invalidate = INCR menu:ver.
 * بدون SCAN/پترن — ساده‌ترین مکانیزم با کمترین حالت خراب.
 *
 * perf-fix (کار-۴): single-flight — در لحظه‌ی expire (لحظه‌ی پیک‌ترافیک)
 * ده‌ها request موازی همزمان miss می‌زدند و همه loader را اجرا می‌کردند
 * (thundering herd روی DB). الان اولین miss صاحب یک promise درون‌حافظه‌ای
 * است و بقیه به همان نتیجه می‌پیوندند.
 */
export class MenuService {
  constructor(private readonly deps: { db: Db; redis: RedisService }) { }

  /** کار-۴: پرومیس‌های در حال پرواز per cache-key (بعد از resolve حذف می‌شوند) */
  private inflight = new Map<string, Promise<unknown>>()

  private async version(): Promise<number> {
    const v = await this.deps.redis.get(VERSION_KEY)
    return v ? Number(v) || 0 : 0
  }

  private async cached<T extends object>(key: string, loader: () => Promise<T>): Promise<T> {
    const ver = await this.version()
    const k = `menu:v${ver}:${key}`
    const hit = await this.deps.redis.getJson<T>(k)
    if (hit !== null) return hit

    // کار-۴: single-flight — اگر هم‌زمانی دارد همین کلید را load می‌کند، join
    const existing = this.inflight.get(k) as Promise<T> | undefined
    if (existing) return existing

    const p = (async () => {
      try {
        const value = await loader()
        await this.deps.redis.setJson(k, value, { ex: CACHE_TTL_SECONDS })
        return value
      } finally {
        this.inflight.delete(k)
      }
    })()
    this.inflight.set(k, p)
    return p
  }

  /** هر write ادمین — یک بار */
  private async invalidate(): Promise<void> {
    await this.deps.redis.incr(VERSION_KEY)
  }

  // ── عمومی ──

  /** Main های فعال — پیش‌فرض اول، بعد sortOrder */
  async activeMainCategories() {
    return this.cached('mains:active', async () => {
      const rows = await this.deps.db
        .select()
        .from(mainCategories)
        .where(eq(mainCategories.isActive, true))
        .orderBy(asc(mainCategories.sortOrder))
      return rows.sort((a, b) => {
        if (a.isDefault && !b.isDefault) return -1
        if (!a.isDefault && b.isDefault) return 1
        return a.sortOrder - b.sortOrder
      })
    })
  }

  async categoriesByMain(slug: string) {
    return this.cached(`cats:${slug}`, async () => {
      const main = await this.deps.db.query.mainCategories.findFirst({
        where: and(eq(mainCategories.slug, slug), eq(mainCategories.isActive, true)),
      })
      if (!main) return []
      return this.deps.db
        .select()
        .from(categories)
        .where(eq(categories.mainCategoryId, main.id))
    })
  }

  async productsByMain(slug: string) {
    return this.cached(`prods:${slug}`, async () => {
      const main = await this.deps.db.query.mainCategories.findFirst({
        where: and(eq(mainCategories.slug, slug), eq(mainCategories.isActive, true)),
      })
      if (!main) return { products: [] as ProductDto[], categories: [] }
      const cats = await this.deps.db
        .select()
        .from(categories)
        .where(eq(categories.mainCategoryId, main.id))
      if (cats.length === 0) return { products: [] as ProductDto[], categories: cats }

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

      const catMap = new Map(cats.map((c) => [c.id, c.name]))
      return { products: await this.withSizes(rows, catMap), categories: cats }
    })
  }

  async productById(id: string): Promise<ProductDto | null> {
    const pid = asProductId(id)

    const load = async (): Promise<ProductDto | null> => {
      const row = await this.deps.db.query.products.findFirst({
        where: eq(products.id, pid),
      })
      if (!row) return null
      const cat = await this.deps.db.query.categories.findFirst({
        where: eq(categories.id, row.categoryId),
      })
      const list = await this.withSizes([row], new Map([[row.categoryId, cat?.name ?? '']]))
      return list[0] ?? null
    }

    const ver = await this.version()
    const k = `menu:v${ver}:prod:${id}`
    const hit = await this.deps.redis.getJson<ProductDto>(k)
    if (hit !== null) return hit

    // کار-۴: همان single-flight — جزئیات محصول در صفحه‌ی محصول می‌تواند
    // هم‌زمان توسط SSR + چند کامپوننت درخواست شود
    const existing = this.inflight.get(k) as Promise<ProductDto | null> | undefined
    if (existing) return existing

    const p = (async (): Promise<ProductDto | null> => {
      try {
        const value = await load()
        // null کش نمی‌شود (مثل قبل) — محصولِ حذف‌شده بعد از invalidate دوباره پرسیده می‌شود
        if (value !== null) {
          await this.deps.redis.setJson(k, value, { ex: CACHE_TTL_SECONDS })
        }
        return value
      } finally {
        this.inflight.delete(k)
      }
    })()
    this.inflight.set(k, p)
    return p
  }

  async allCategories() {
    return this.cached('cats:all', async () =>
      this.deps.db.select().from(categories).orderBy(asc(categories.name)),
    )
  }

  // ── قیمت‌گذاری — عین getEffectivePrice فرانت ──

  /** سایز مؤثر: sizesEnabled → سایزِ انتخابی یا اولین؛ وگرنه null */
  async effectivePrice(
    productId: string,
    sizeId?: string | null,
  ): Promise<{ price: number; sizeName: string | null } | null> {
    const p = await this.deps.db.query.products.findFirst({
      where: eq(products.id, asProductId(productId)),
    })
    if (!p) return null

    if (p.sizesEnabled) {
      const sizes = await this.deps.db
        .select()
        .from(productSizes)
        .where(eq(productSizes.productId, p.id))
        .orderBy(asc(productSizes.sortOrder))
      if (sizes.length > 0) {
        const chosen = sizeId ? sizes.find((s) => s.id === sizeId) : undefined
        const size = chosen ?? sizes[0]!
        return { price: size.price, sizeName: size.name }
      }
    }
    return { price: finalPriceOf(p), sizeName: null }
  }

  // ── ادمین: Main ها ──

  async adminMainCategories() {
    return this.deps.db.select().from(mainCategories).orderBy(asc(mainCategories.sortOrder))
  }

  async createMainCategory(name: string, slug: string): Promise<{ success: boolean; message?: string }> {
    const clean = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
    if (!clean) return { success: false, message: 'slug معتبر نیست (مثلا: cafe)' }
    const clash = await this.deps.db.query.mainCategories.findFirst({
      where: eq(mainCategories.slug, clean),
    })
    if (clash) return { success: false, message: 'این slug قبلاً ثبت شده' }

    const all = await this.adminMainCategories()
    await this.deps.db.insert(mainCategories).values({
      name: name.trim(),
      slug: clean,
      isActive: false,
      isDefault: false,
      sortOrder: all.length + 1,
    } as typeof mainCategories.$inferInsert)
    await this.invalidate()
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
    await this.invalidate()
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
    await this.invalidate()
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
    await this.invalidate()
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
    await this.invalidate()
    return { success: true }
  }

  // ── ادمین: دسته‌ها ──

  async createCategory(input: {
    name: string
    mainCategoryId: string
    hasSizes: boolean
    sizeNames: string[]
  }): Promise<{ success: boolean; message?: string }> {
    const slug = await this.uniqueCategorySlug(input.name.trim())
    await this.deps.db.insert(categories).values({
      name: input.name.trim(),
      slug,
      mainCategoryId: asMainCategoryId(input.mainCategoryId),
      hasSizes: input.hasSizes,
      sizeNames: input.hasSizes ? input.sizeNames : [],
    } as typeof categories.$inferInsert)
    await this.invalidate()
    return { success: true }
  }

  async updateCategory(input: {
    id: string
    name: string
    mainCategoryId: string
    hasSizes: boolean
    sizeNames: string[]
  }): Promise<void> {
    const catId = asCategoryId(input.id)
    await this.deps.db
      .update(categories)
      .set({
        name: input.name.trim(),
        mainCategoryId: asMainCategoryId(input.mainCategoryId),
        hasSizes: input.hasSizes,
        sizeNames: input.hasSizes ? input.sizeNames : [],
      })
      .where(eq(categories.id, catId))
    await this.invalidate()
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
    await this.invalidate()
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
        .select({ id: categories.id, name: categories.name })
        .from(categories)
        .where(inArray(categories.id, catIds))
      : []
    const catMap = new Map(cats.map((c) => [c.id, c.name]))

    return { products: await this.withSizes(rows, catMap), total }
  }

  async adminProductDetails(id: string): Promise<ProductDto | null> {
    return this.productById(id)
  }

  async createProduct(input: {
    name: string
    description: string
    originalPrice: number
    discountPercentage: number
    prepTime: number
    categoryId: string
    packagingCost?: number
    profileImage?: string | null
    galleryImages?: string[]
    sizesEnabled?: boolean
    sizes?: { name: string; price: number }[]
    ingredients?: string[]
  }): Promise<{ success: boolean; id?: string; message?: string }> {
    const [created] = await this.deps.db
      .insert(products)
      .values({
        name: input.name,
        description: input.description,
        originalPrice: input.originalPrice,
        discountPercentage: input.discountPercentage,
        prepTime: input.prepTime,
        packagingCost: input.packagingCost ?? 0,
        categoryId: asCategoryId(input.categoryId),
        profileImage: input.profileImage ?? null,
        galleryImages: input.galleryImages ?? [],
        sizesEnabled: input.sizesEnabled ?? false,
        ingredients: input.ingredients ?? [],
        status: 'ACTIVE',
      } as typeof products.$inferInsert)
      .returning()
    if (!created) return { success: false, message: 'ذخیره‌سازی ناموفق بود' }

    if (input.sizesEnabled && input.sizes?.length) {
      await this.insertSizes(created.id, input.sizes)
    }
    await this.invalidate()
    return { success: true, id: created.id }
  }

  async updateProduct(input: {
    id: string
    name: string
    description: string
    originalPrice: number
    discountPercentage: number
    prepTime: number
    packagingCost?: number
    profileImage?: string | null
    galleryImages?: string[]
    sizesEnabled?: boolean
    sizes?: { name: string; price: number }[]
    ingredients?: string[]
  }): Promise<void> {
    const pid = asProductId(input.id)
    await this.deps.db
      .update(products)
      .set({
        name: input.name,
        description: input.description,
        originalPrice: input.originalPrice,
        discountPercentage: input.discountPercentage,
        prepTime: input.prepTime,
        packagingCost: input.packagingCost ?? 0,
        profileImage: input.profileImage ?? null,
        galleryImages: input.galleryImages ?? [],
        sizesEnabled: input.sizesEnabled ?? false,
        ingredients: input.ingredients ?? [],
        updatedAt: new Date(),
      })
      .where(eq(products.id, pid))

    // ── phase-2: آیدی پایدار سایزها ──
    // قبلاً: حذف همه + اینسرت با UUID جدید → سبدِ مشتری که sizeId قدیمی
    // داشت یا خطا می‌خورد یا بی‌سروصدا اولین سایز قیمت می‌شد. الان:
    //   • نام موجود → همان ردیف، فقط price/sortOrder آپدیت (id ثابت)
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
          const match = byName.get(s.name)
          if (match) {
            await tx
              .update(productSizes)
              .set({ price: s.price, sortOrder: order })
              .where(eq(productSizes.id, match.id))
            keepIds.add(match.id)
          } else {
            const [ins] = await tx
              .insert(productSizes)
              .values({ productId: pid, name: s.name, price: s.price, sortOrder: order })
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

    await this.invalidate()
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
    await this.invalidate()
  }

  // ── داخلی ──

  private async insertSizes(productId: ProductId, sizes: { name: string; price: number }[]) {
    await this.deps.db.insert(productSizes).values(
      sizes.map((s, i) => ({ productId, name: s.name, price: s.price, sortOrder: i })),
    )
  }

  private async withSizes(
    rows: Array<typeof products.$inferSelect>,
    catMap: Map<CategoryId, string>,
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

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      originalPrice: r.originalPrice,
      finalPrice: finalPriceOf(r),
      discountPercentage: r.discountPercentage,
      packagingCost: r.packagingCost,
      categoryId: r.categoryId,
      categoryName: catMap.get(r.categoryId),
      profileImage: r.profileImage,
      galleryImages: r.galleryImages ?? [],
      sizesEnabled: r.sizesEnabled,
      sizes: (sizeMap.get(r.id) ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        price: s.price,
      })),
      ingredients: r.ingredients ?? [],
      prepTime: r.prepTime,
      views: r.views,
      sales: r.sales,
      status: r.status,
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
}