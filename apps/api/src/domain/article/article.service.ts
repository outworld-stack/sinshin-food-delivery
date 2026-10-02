// ═══════════════════════════════════════════════════════════════
// round-48 — sinshin-food-delivery — فایل 14 از 97
// مسیر مقصد: apps/api/src/domain/article/article.service.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage forty-three
// ═══════════════════════════════════════════════════════════════

// src/domain/article/article.service.ts
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import {
    articles,
    articleCategories,
    articleSubCategories,
} from '#/infra/db/schema'
import { Err } from '#/domain/shared/errors'
import { nullIfEmpty, pickAr, type Lang } from '#/domain/shared/lang'
import type { RedisService } from '#/infra/redis/redis'
import { VersionedCache } from '#/domain/shared/versioned-cache'
import { UUID_RE } from '#/domain/shared/ids'


/** قرارداد ArticleDto از @sinshin/shared */
export interface ArticleView {
    id: string
    title: string
    excerpt: string
    content: string
    author: string
    profileImage: string | null
    galleryImages: string[]
    categoryId: string
    subCategoryId: string | null
    processes: { title: string; items: string[] }[]
    views: number
    status: string
    publishedAt: string
    categorySlug: string | null
    categoryName: string | null
    subCategorySlug: string | null
    subCategoryName: string | null
    /** ═══ round-34 — محتوای عربی (فقط adminDetail پر می‌کند؛ فرم ویرایش) ═══ */
    titleAr?: string | null
    excerptAr?: string | null
    contentAr?: string | null
    processesAr?: { title: string; items: string[] }[] | null
    arAuto?: boolean
}

/**
 * round-17 — نمای «لیست»: بدون content/processes/galleryImages.
 * قبلاً هر لیست (سایت و ادمین) متن کامل همه‌ی مقالات را از DB می‌کشید.
 */
export type ArticleSummaryView = Omit<
    ArticleView,
    'content' | 'processes' | 'galleryImages'
>

export interface ArticleCategoryView {
    id: string
    name: string
    /** round-34 — نام عربی خام (فرم ادمین) */
    nameAr?: string | null
    slug: string
    hasSubCategories: boolean
    subCategories: { id: string; name: string; nameAr?: string | null; slug: string }[]
}

export interface ArticleInput {
    title: string
    excerpt: string
    content: string
    author?: string
    profileImage?: string | null
    galleryImages?: string[]
    categoryId: string
    subCategoryId?: string | null
    processes?: { title: string; items: string[] }[]
    /** round-34 — محتوای عربی (اختیاری؛ خالی = NULL = پشتیبان فارسی) */
    titleAr?: string | null
    excerptAr?: string | null
    contentAr?: string | null
    processesAr?: { title: string; items: string[] }[] | null
}

type ArticleRow = typeof articles.$inferSelect
/** ردیف سبک لیست — دقیقاً ستون‌هایی که joinedSummary انتخاب می‌کند */
type ArticleSummaryRow = Pick<
    ArticleRow,
    'id' | 'title' | 'excerpt' | 'author' | 'profileImage' | 'categoryId' | 'subCategoryId' | 'views' | 'status' | 'createdAt' | 'titleAr' | 'excerptAr'
>
type CategoryRow = typeof articleCategories.$inferSelect
type SubRow = typeof articleSubCategories.$inferSelect

/**
 * مقالات — عمومی (فقط ACTIVE) + ادمین (همه).
 * «مرگ 404» — فرانت از اول روی این قراردادها ساخته شده بود، روت‌ها نبودند.
 */
const CACHE_TTL_SECONDS = 30 // همان کهنگیِ منو
const VERSION_KEY = 'articles:ver'

export class ArticleService {
    constructor(private readonly deps: { db: Db; redis: RedisService }) {
        // رارد ۴۸ (اسکن C2) — لیست عمومی مقالات روی مسیر SSR هر بازدید
        // بدون سقف و بدون کش از DB کشیده می‌شد؛ حالا همان کش نسخه‌دارِ منو.
        this.cache = new VersionedCache({
            redis: deps.redis,
            versionKey: VERSION_KEY,
            prefix: 'arts',
            ttlSeconds: CACHE_TTL_SECONDS,
        })
    }

    private readonly cache: VersionedCache

    // ═══ عمومی ═══

    /** round-34 — lang: نام دسته/ساب‌دسته در نمای عمومی COALESCE(ar, fa) */
    async categories(lang: Lang = 'fa'): Promise<ArticleCategoryView[]> {
        const cats = await this.deps.db
            .select()
            .from(articleCategories)
            .orderBy(asc(articleCategories.createdAt))
        if (cats.length === 0) return []

        const subs = await this.deps.db
            .select()
            .from(articleSubCategories)
            .orderBy(asc(articleSubCategories.name))
        const subsByCat = new Map<string, SubRow[]>()
        for (const s of subs) {
            const list = subsByCat.get(s.categoryId) ?? []
            list.push(s)
            subsByCat.set(s.categoryId, list)
        }

        return cats.map((c) => ({
            id: c.id,
            name: pickAr(lang, c.nameAr, c.name),
            // round-34 — مقدار خام برای فرم ادمین (هیدراتِ فیلد عربی)
            nameAr: c.nameAr ?? null,
            slug: c.slug,
            hasSubCategories: c.hasSubCategories,
            subCategories: (subsByCat.get(c.id) ?? []).map((s) => ({
                id: s.id,
                name: pickAr(lang, s.nameAr, s.name),
                nameAr: s.nameAr ?? null,
                slug: s.slug,
            })),
        }))
    }

    async listPublic(categorySlug?: string, subSlug?: string, lang: Lang = 'fa'): Promise<ArticleSummaryView[]> {
        const cat = categorySlug && categorySlug !== 'all' ? categorySlug : 'all'
        const sub = subSlug && subSlug !== 'all' ? subSlug : 'all'
        return this.cache.cached(`list:${lang}:${cat}:${sub}`, async () => {
            const conds = [eq(articles.status, 'ACTIVE')]
            if (cat !== 'all') {
                conds.push(eq(articleCategories.slug, cat))
            }
            if (sub !== 'all') {
                conds.push(eq(articleSubCategories.slug, sub))
            }
            const rows = await this.joinedSummary().where(and(...conds)).orderBy(desc(articles.createdAt))
            return rows.map(({ a, c, s }) => this.toSummary(a, c, s, lang))
        })
    }

    /**
     * رارد ۴۸ — باطل‌کردن عمومی کش مقالات (الگوی bustCache منو).
     * صف ترجمه ستون‌های ar را مستقیم روی ردیف‌ها می‌نویسد (بیرون از
     * متدهای write ادمین)؛ این متد همان INCR نسخه را برایش انجام می‌دهد
     * تا کاربر عربی کشِ قدیمیِ فارسی را نبیند.
     */
    async bustCache(): Promise<void> {
        await this.cache.invalidate()
    }

    /** جزئیات عمومی — فقط ACTIVE + شمارش بازدید (سورتِ پربازدیدترین فرانت) */
    async byId(id: string, lang: Lang = 'fa'): Promise<ArticleView | null> {
        if (!UUID_RE.test(id)) return null
        const row = (
            await this.deps.db
                .select({ a: articles, c: articleCategories, s: articleSubCategories })
                .from(articles)
                .innerJoin(articleCategories, eq(articleCategories.id, articles.categoryId))
                .leftJoin(articleSubCategories, eq(articleSubCategories.id, articles.subCategoryId))
                .where(and(eq(articles.id, id), eq(articles.status, 'ACTIVE')))
                .limit(1)
        )[0]
        if (!row) return null

        await this.deps.db
            .update(articles)
            .set({ views: sql`${articles.views} + 1` })
            .where(eq(articles.id, id))

        return this.toView(row.a, row.c, row.s, lang)
    }

    // ═══ ادمین: مقالات ═══

    async listAdmin(): Promise<ArticleSummaryView[]> {
        const rows = await this.joinedSummary().orderBy(desc(articles.createdAt))
        return rows.map(({ a, c, s }) => this.toSummary(a, c, s))
    }

    async adminDetail(id: string): Promise<ArticleView | null> {
        if (!UUID_RE.test(id)) return null
        const row = (
            await this.deps.db
                .select({ a: articles, c: articleCategories, s: articleSubCategories })
                .from(articles)
                .innerJoin(articleCategories, eq(articleCategories.id, articles.categoryId))
                .leftJoin(articleSubCategories, eq(articleSubCategories.id, articles.subCategoryId))
                .where(eq(articles.id, id))
                .limit(1)
        )[0]
        // round-34 — فرم ویرایش ادمین: fa مبنا + فیلدهای ar خام (بج دستی/خودکار/ندارد)
        return row ? this.toView(row.a, row.c, row.s, 'fa', { includeAr: true }) : null
    }

    async create(input: ArticleInput): Promise<{ success: boolean; id?: string }> {
        const { db } = this.deps
        await this.assertCategory(input.categoryId, input.subCategoryId ?? null)

        const [created] = await db
            .insert(articles)
            .values({
                title: input.title.trim(),
                excerpt: input.excerpt.trim(),
                content: input.content,
                // round-34 — محتوای عربی: '' → NULL (پشتیبان فارسی)؛ ذخیره‌ی دستی = «دستی»
                titleAr: nullIfEmpty(input.titleAr),
                excerptAr: nullIfEmpty(input.excerptAr),
                contentAr: nullIfEmpty(input.contentAr),
                processesAr: input.processesAr && input.processesAr.length > 0 ? input.processesAr : null,
                arAuto: false,
                author: input.author?.trim() || 'سین شین',
                categoryId: input.categoryId,
                subCategoryId: input.subCategoryId ?? null,
                profileImage: input.profileImage || null,
                galleryImages: input.galleryImages ?? [],
                processes: input.processes ?? [],
                status: 'ACTIVE',
            })
            .returning()
        if (!created) throw Err.internal('ذخیره‌سازی مقاله ناموفق بود.')
        await this.cache.invalidate()
        return { success: true, id: created.id }
    }

    async update(id: string, input: ArticleInput): Promise<{ success: boolean }> {
        if (!UUID_RE.test(id)) throw Err.notFound('مقاله پیدا نشد.')
        await this.assertCategory(input.categoryId, input.subCategoryId ?? null)

        const [updated] = await this.deps.db
            .update(articles)
            .set({
                title: input.title.trim(),
                excerpt: input.excerpt.trim(),
                content: input.content,
                // round-34 — محتوای عربی: '' → NULL؛ ذخیره‌ی دستی پرچم «خودکار» را برمی‌گرداند
                titleAr: nullIfEmpty(input.titleAr),
                excerptAr: nullIfEmpty(input.excerptAr),
                contentAr: nullIfEmpty(input.contentAr),
                processesAr: input.processesAr && input.processesAr.length > 0 ? input.processesAr : null,
                arAuto: false,
                categoryId: input.categoryId,
                subCategoryId: input.subCategoryId ?? null,
                profileImage: input.profileImage || null,
                galleryImages: input.galleryImages ?? [],
                processes: input.processes ?? [],
                updatedAt: new Date(),
                // author فقط وقتی فرستاده شده — ویرایشِ بدون author، نویسنده را ریست نمی‌کند
                ...(input.author !== undefined ? { author: input.author.trim() || 'سین شین' } : {}),
            })
            .where(eq(articles.id, id))
            .returning()
        if (!updated) throw Err.notFound('مقاله پیدا نشد.')
        await this.cache.invalidate()
        return { success: true }
    }

    async remove(id: string): Promise<{ success: boolean }> {
        if (!UUID_RE.test(id)) throw Err.notFound('مقاله پیدا نشد.')
        const removed = await this.deps.db
            .delete(articles)
            .where(eq(articles.id, id))
            .returning({ id: articles.id })
        if (removed.length === 0) throw Err.notFound('مقاله پیدا نشد.')
        await this.cache.invalidate()
        return { success: true }
    }

    async toggle(id: string): Promise<void> {
        const row = await this.deps.db.query.articles.findFirst({ where: eq(articles.id, id) })
        if (!row) return
        await this.deps.db
            .update(articles)
            .set({ status: row.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE', updatedAt: new Date() })
            .where(eq(articles.id, row.id))
        await this.cache.invalidate()
    }

    // ═══ ادمین: دسته‌ها ═══

    async createCategory(input: {
        name: string
        hasSubCategories: boolean
        subCategories?: string[]
        /** round-34 — نام عربی دسته + ساب‌دسته‌ها (موازی با subCategories، جفت با ایندکس) */
        nameAr?: string | null
        subCategoriesAr?: string[] | null
    }): Promise<{ success: boolean }> {
        const { db } = this.deps
        const name = input.name.trim()
        if (!name) throw Err.validation('نام دسته الزامی است.')

        const slug = await this.uniqueSlug(name, 'category')
        const [created] = await db
            .insert(articleCategories)
            .values({ name, nameAr: nullIfEmpty(input.nameAr), slug, hasSubCategories: input.hasSubCategories })
            .returning()
        if (!created) throw Err.internal('ذخیره‌سازی دسته ناموفق بود.')

        if (input.hasSubCategories) {
            for (const [i, raw] of (input.subCategories ?? []).entries()) {
                const subName = raw.trim()
                if (!subName) continue
                const subSlug = await this.uniqueSlug(subName, 'sub')
                await db
                    .insert(articleSubCategories)
                    .values({
                        categoryId: created.id,
                        name: subName,
                        nameAr: nullIfEmpty(input.subCategoriesAr?.[i]),
                        slug: subSlug,
                    })
            }
        }
        await this.cache.invalidate()
        return { success: true }
    }

    async updateCategory(
        id: string,
        input: {
            name: string
            hasSubCategories: boolean
            subCategories?: string[]
            /** round-34 — نام عربی دسته + ساب‌دسته‌ها (موازی با subCategories، جفت با ایندکس) */
            nameAr?: string | null
            subCategoriesAr?: string[] | null
        },
    ): Promise<void> {
        const { db } = this.deps
        const cat = await db.query.articleCategories.findFirst({
            where: eq(articleCategories.id, id),
        })
        if (!cat) throw Err.notFound('دسته مقاله پیدا نشد.')

        await db
            .update(articleCategories)
            .set({
                name: input.name.trim(),
                nameAr: nullIfEmpty(input.nameAr),
                hasSubCategories: input.hasSubCategories,
            })
            .where(eq(articleCategories.id, id))
        // slug عمداً ثابت می‌ماند — URLهای ایندکس‌شده نمی‌شکنند

        if (!input.hasSubCategories) return // الگوی سایزها: خاموش = دست نمی‌زنیم

        // همگام‌سازی با «نام» — آیدی پایدار
        const existing = await db
            .select()
            .from(articleSubCategories)
            .where(eq(articleSubCategories.categoryId, id))
        const wanted = (input.subCategories ?? []).map((s) => s.trim()).filter(Boolean)
        const wantedSet = new Set(wanted)

        // round-34 — جفتِ عربیِ هر نام (هم‌ایندکس با subCategories فرستاده‌شده)
        const arOf = (faName: string): string | null => {
            const idx = (input.subCategories ?? []).findIndex((s) => s.trim() === faName)
            return idx === -1 ? null : nullIfEmpty(input.subCategoriesAr?.[idx])
        }

        for (const subName of wanted) {
            const match = existing.find((s) => s.name === subName)
            const subAr = arOf(subName)
            if (match) {
                // نام موجود → آپدیت نام عربی فقط وقتی مقدار جدید آمده
                if (input.subCategoriesAr) {
                    await db
                        .update(articleSubCategories)
                        .set({ nameAr: subAr })
                        .where(eq(articleSubCategories.id, match.id))
                }
            } else {
                const subSlug = await this.uniqueSlug(subName, 'sub')
                await db
                    .insert(articleSubCategories)
                    .values({ categoryId: id, name: subName, nameAr: subAr, slug: subSlug })
            }
        }
        const stale = existing.filter((s) => !wantedSet.has(s.name)).map((s) => s.id)
        if (stale.length > 0) {
            // مقالاتِ ارجاع‌دهنده: FK → SET NULL — بی‌خطر
            await db.delete(articleSubCategories).where(inArray(articleSubCategories.id, stale))
        }
        await this.cache.invalidate()
    }

    async deleteCategory(id: string): Promise<{ success: boolean; message?: string }> {
        const count = await this.deps.db
            .select({ count: sql<number>`count(*)::int` })
            .from(articles)
            .where(eq(articles.categoryId, id))
            .then((r) => r[0]?.count ?? 0)
        if (count > 0) {
            return { success: false, message: 'ابتدا مقالات این دسته را منتقل یا حذف کنید' }
        }
        await this.deps.db.delete(articleCategories).where(eq(articleCategories.id, id))
        await this.cache.invalidate()
        return { success: true }
    }

    // ── داخلی ──

    /**
     * round-17 — همان جوین برای «لیست»‌ها، اما فقط با ستون‌های سبک:
     * متن کامل (content)، مراحل (processes) و گالری هرگز از DB خوانده
     * نمی‌شوند — این‌ها فقط در جزئیات خواسته می‌شوند.
     */
    private joinedSummary() {
        return this.deps.db
            .select({
                a: {
                    id: articles.id,
                    title: articles.title,
                    excerpt: articles.excerpt,
                    author: articles.author,
                    profileImage: articles.profileImage,
                    categoryId: articles.categoryId,
                    subCategoryId: articles.subCategoryId,
                    views: articles.views,
                    status: articles.status,
                    createdAt: articles.createdAt,
                    // round-34 — برای COALESCE در toSummary (بدون content سنگین)
                    titleAr: articles.titleAr,
                    excerptAr: articles.excerptAr,
                },
                c: articleCategories,
                s: articleSubCategories,
            })
            .from(articles)
            .innerJoin(articleCategories, eq(articleCategories.id, articles.categoryId))
            .leftJoin(articleSubCategories, eq(articleSubCategories.id, articles.subCategoryId))
            .$dynamic()
    }

    private async assertCategory(categoryId: string, subCategoryId: string | null): Promise<void> {
        const cat = await this.deps.db.query.articleCategories.findFirst({
            where: eq(articleCategories.id, categoryId),
        })
        if (!cat) throw Err.notFound('دسته‌ی مقاله پیدا نشد.')
        if (subCategoryId) {
            const sub = await this.deps.db.query.articleSubCategories.findFirst({
                where: eq(articleSubCategories.id, subCategoryId),
            })
            if (!sub) throw Err.notFound('ساب‌دسته پیدا نشد.')
            if (sub.categoryId !== categoryId) {
                throw Err.validation('این ساب‌دسته به این دسته تعلق ندارد.')
            }
        }
    }

    /** slug از نام (فارسی مجاز — مثل منو) + حلقه‌ی یکتایی */
    private async uniqueSlug(name: string, kind: 'category' | 'sub'): Promise<string> {
        const { db } = this.deps
        const base = name.replace(/\s+/g, '-').toLowerCase() || (kind === 'category' ? 'cat' : 'sub')
        let slug = base
        let i = 1
        for (; ;) {
            const clash =
                kind === 'category'
                    ? await db.query.articleCategories.findFirst({
                        where: eq(articleCategories.slug, slug),
                    })
                    : await db.query.articleSubCategories.findFirst({
                        where: eq(articleSubCategories.slug, slug),
                    })
            if (!clash) return slug
            slug = `${base}-${++i}`
        }
    }

    private toView(
        a: ArticleRow,
        c: CategoryRow | null,
        s: SubRow | null,
        lang: Lang = 'fa',
        opts?: { includeAr?: boolean },
    ): ArticleView {
        return {
            id: a.id,
            title: pickAr(lang, a.titleAr, a.title),
            excerpt: pickAr(lang, a.excerptAr, a.excerpt),
            content: pickAr(lang, a.contentAr, a.content),
            author: a.author,
            profileImage: a.profileImage,
            galleryImages: a.galleryImages ?? [],
            categoryId: a.categoryId,
            subCategoryId: a.subCategoryId,
            // round-34 — روندها: آرایه‌ی شیء‌دار → همان COALESCE اما بدون ژنریک
            processes:
                lang === 'ar' && a.processesAr && a.processesAr.length > 0
                    ? a.processesAr
                    : (a.processes ?? []),
            views: a.views,
            status: a.status,
            publishedAt: a.createdAt.toISOString(),
            categorySlug: c?.slug ?? null,
            categoryName: c ? pickAr(lang, c.nameAr, c.name) : null,
            subCategorySlug: s?.slug ?? null,
            subCategoryName: s ? pickAr(lang, s.nameAr, s.name) : null,
            // round-34 — فقط adminDetail: فیلدهای ar خام برای فرم ویرایش دوزبانه
            ...(opts?.includeAr
                ? {
                    titleAr: a.titleAr ?? null,
                    excerptAr: a.excerptAr ?? null,
                    contentAr: a.contentAr ?? null,
                    processesAr: a.processesAr ?? null,
                    arAuto: a.arAuto,
                }
                : {}),
        }
    }

    /** round-17 — نگاشت لیست: همان toView برای فیلدهای سبک */
    private toSummary(
        a: ArticleSummaryRow,
        c: CategoryRow | null,
        s: SubRow | null,
        lang: Lang = 'fa',
    ): ArticleSummaryView {
        return {
            id: a.id,
            title: pickAr(lang, a.titleAr, a.title),
            excerpt: pickAr(lang, a.excerptAr, a.excerpt),
            author: a.author,
            profileImage: a.profileImage,
            categoryId: a.categoryId,
            subCategoryId: a.subCategoryId,
            views: a.views,
            status: a.status,
            publishedAt: a.createdAt.toISOString(),
            categorySlug: c?.slug ?? null,
            categoryName: c ? pickAr(lang, c.nameAr, c.name) : null,
            subCategorySlug: s?.slug ?? null,
            subCategoryName: s ? pickAr(lang, s.nameAr, s.name) : null,
        }
    }
}