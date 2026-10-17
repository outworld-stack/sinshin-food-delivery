// ═══════════════════════════════════════════════════════════════
// round-48 — sinshin-food-delivery — فایل 14 از 97
// مسیر مقصد: apps/api/src/domain/article/article.service.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage forty-three
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// stage-60 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/domain/article/article.service.ts
// تغییر: isFeatured (پرچم سنجاق ویژه) — ورودی create/update +
//        گذر کامل در toView/toSummary/joinedSummary (۴ آیتم اول فرانت)
//

// src/domain/article/article.service.ts
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'

import type { Db, DbOrTx } from '#/infra/db/client'
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
import { normalizeBlocksDoc } from './blocks-normalize'
import { blocksToPlainText, type ArticleBlocksDoc } from '@sinshin/shared'


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
    /** stage-60 — پرچم ویژه/سنجاق (۴ آیتم اول لیست + Aurora در فرانت) */
    isFeatured?: boolean
    /**
     * stage-82 — سندِ بلوکی صفحه‌ساز. نمایِ عمومی فقط برای زبان فارسی
     * می‌فرستد (ادیتور فارسی‌زبان است)؛ عربی همان مسیر متنی را می‌گیرد.
     */
    blocks?: ArticleBlocksDoc | null
}

/**
 * round-17 — نمای «لیست»: بدون content/processes/galleryImages.
 * قبلاً هر لیست (سایت و ادمین) متن کامل همه‌ی مقالات را از DB می‌کشید.
 */
export type ArticleSummaryView = Omit<
    ArticleView,
    'content' | 'processes' | 'galleryImages' | 'blocks'
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
    /** stage-60 — پرچم ویژه/سنجاق (۴ آیتم اول لیست + Aurora) */
    isFeatured?: boolean
    /** stage-82 — سند بلوکی خام (پیش از نرمال‌سازی سرویس)؛ null = پاک‌کردن */
    blocks?: unknown
}

interface ArticleCategoryInput {
    name: string
    hasSubCategories: boolean
    subCategories?: string[]
    nameAr?: string | null
    subCategoriesAr?: string[] | null
}

type ArticleRow = typeof articles.$inferSelect
/** ردیف سبک لیست — دقیقاً ستون‌هایی که joinedSummary انتخاب می‌کند */
type ArticleSummaryRow = Pick<
    ArticleRow,
    'id' | 'title' | 'excerpt' | 'author' | 'profileImage' | 'categoryId' | 'subCategoryId' | 'views' | 'status' | 'createdAt' | 'titleAr' | 'excerptAr' | 'isFeatured'
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
        return this.cache.cached(`list:${JSON.stringify([lang, cat, sub])}`, async () => {
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

    // رارد L9 — بافر شمارش بازدید: هر بازدید یک UPDATE مستقل بود (write
    // amplification روی WAL/vacuum). حالا در حافظه جمع و هر ۶۰ ثانیه یکجا
    // اعمال می‌شود.
    private readonly viewsBuffer = new Map<string, number>()
    private viewsFlushTimer: ReturnType<typeof setInterval> | null = null
    private viewsFlush: Promise<void> | null = null

    private bufferView(id: string): void {
        this.viewsBuffer.set(id, (this.viewsBuffer.get(id) ?? 0) + 1)
        if (this.viewsFlushTimer === null) {
            this.viewsFlushTimer = setInterval(() => void this.flushViews(), 60_000)
            this.viewsFlushTimer.unref?.()
        }
    }

    private flushViews(): Promise<void> {
        if (this.viewsFlush) return this.viewsFlush
        this.viewsFlush = this.persistViews().finally(() => { this.viewsFlush = null })
        return this.viewsFlush
    }

    private async persistViews(): Promise<void> {
        const pending = [...this.viewsBuffer.entries()]
        this.viewsBuffer.clear()
        for (const [id, n] of pending) {
            try {
                await this.deps.db
                    .update(articles)
                    .set({ views: sql`${articles.views} + ${n}` })
                    .where(eq(articles.id, id))
            } catch (e) {
                this.viewsBuffer.set(id, (this.viewsBuffer.get(id) ?? 0) + n)
                console.error('[articles] views flush failed:', e)
            }
        }
    }

    async close(): Promise<void> {
        if (this.viewsFlushTimer !== null) clearInterval(this.viewsFlushTimer)
        this.viewsFlushTimer = null
        if (this.viewsFlush) await this.viewsFlush
        await this.flushViews()
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

        // رارد L9 — شمارش batch می‌شود (بافر + flush دوره‌ای)
        this.bufferView(row.a.id)

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

        // stage-82 — بلوک‌ها: نرمال‌سازی سخت‌گیر + مشتق‌سازیِ content از متنِ
        // بلوک‌ها (لیست/سئو/ترجمه روی content سوارند — درسِ تحقیق: ول نکن)
        const blocks = normalizeBlocksDoc(input.blocks)
        const content = blocks ? blocksToPlainText(blocks) || input.content : input.content
        this.assertArticleText(input, content)

        const [created] = await db
            .insert(articles)
            .values({
                title: input.title.trim(),
                excerpt: input.excerpt.trim(),
                content,
                // stage-82 — سندِ بلوکی نرمال‌شده (null = مقاله‌ی متنی ساده)
                blocks,
                // round-34 — محتوای عربی: '' → NULL (پشتیبان فارسی)؛ ذخیره‌ی دستی = «دستی»
                titleAr: nullIfEmpty(input.titleAr),
                excerptAr: nullIfEmpty(input.excerptAr),
                contentAr: nullIfEmpty(input.contentAr),
                processesAr: this.normalizeProcessesAr(input.processesAr),
                arAuto: false,
                author: input.author?.trim() || 'سین شین',
                categoryId: input.categoryId,
                subCategoryId: input.subCategoryId ?? null,
                profileImage: input.profileImage || null,
                galleryImages: input.galleryImages ?? [],
                processes: input.processes ?? [],
                status: 'ACTIVE',
                // stage-60 — پرچم ویژه/سنجاق
                isFeatured: input.isFeatured ?? false,
            })
            .returning()
        if (!created) throw Err.internal('ذخیره‌سازی مقاله ناموفق بود.')
        await this.cache.invalidate()
        return { success: true, id: created.id }
    }

    async update(id: string, input: ArticleInput): Promise<{ success: boolean }> {
        if (!UUID_RE.test(id)) throw Err.notFound('مقاله پیدا نشد.')
        await this.deps.db.transaction(async (tx) => {
            const [current] = await tx.select().from(articles).where(eq(articles.id, id)).for('update')
            if (!current) throw Err.notFound('مقاله پیدا نشد.')

            // Omitted optional fields retain their values; null explicitly clears them.
            // A category change cannot retain a sub-category from the old category.
            const subCategoryId = input.subCategoryId !== undefined
                ? input.subCategoryId
                : current.categoryId === input.categoryId ? current.subCategoryId : null
            await this.assertCategory(input.categoryId, subCategoryId, tx)
            const blocks = input.blocks === undefined ? current.blocks : normalizeBlocksDoc(input.blocks)
            const content = blocks ? blocksToPlainText(blocks) || input.content : input.content
            this.assertArticleText(input, content)

            await tx.update(articles).set({
                title: input.title.trim(),
                excerpt: input.excerpt.trim(),
                content,
                ...(input.blocks !== undefined ? { blocks } : {}),
                ...(input.titleAr !== undefined ? { titleAr: nullIfEmpty(input.titleAr) } : {}),
                ...(input.excerptAr !== undefined ? { excerptAr: nullIfEmpty(input.excerptAr) } : {}),
                ...(input.contentAr !== undefined ? { contentAr: nullIfEmpty(input.contentAr) } : {}),
                ...(input.processesAr !== undefined ? {
                    processesAr: this.normalizeProcessesAr(input.processesAr),
                } : {}),
                ...([input.titleAr, input.excerptAr, input.contentAr, input.processesAr].some((v) => v !== undefined)
                    ? { arAuto: false } : {}),
                categoryId: input.categoryId,
                subCategoryId,
                ...(input.profileImage !== undefined ? { profileImage: input.profileImage || null } : {}),
                ...(input.galleryImages !== undefined ? { galleryImages: input.galleryImages } : {}),
                ...(input.processes !== undefined ? { processes: input.processes } : {}),
                updatedAt: new Date(),
                ...(input.isFeatured !== undefined ? { isFeatured: input.isFeatured } : {}),
                ...(input.author !== undefined ? { author: input.author.trim() || 'سین شین' } : {}),
            }).where(eq(articles.id, id))
        })
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
        if (!UUID_RE.test(id)) throw Err.notFound('مقاله پیدا نشد.')
        const [updated] = await this.deps.db
            .update(articles)
            .set({ status: sql`case when ${articles.status} = 'ACTIVE' then 'INACTIVE' else 'ACTIVE' end`, updatedAt: new Date() })
            .where(eq(articles.id, id))
            .returning({ id: articles.id })
        if (!updated) throw Err.notFound('مقاله پیدا نشد.')
        await this.cache.invalidate()
    }

    // ═══ ادمین: دسته‌ها ═══

    async createCategory(input: ArticleCategoryInput): Promise<{ success: boolean }> {
        const name = input.name.trim()
        if (!name) throw Err.validation('نام دسته الزامی است.')

        await this.deps.db.transaction(async (tx) => {
            // Slugs are unique across categories (and across all sub-categories).
            // Serialize allocation and keep the entire category save atomic.
            await tx.execute(sql`select pg_advisory_xact_lock(hashtext('articles:taxonomy'))`)
            const slug = await this.uniqueSlug(name, 'category', tx)
            const [created] = await tx.insert(articleCategories)
                .values({ name, nameAr: nullIfEmpty(input.nameAr), slug, hasSubCategories: input.hasSubCategories })
                .returning()
            if (!created) throw Err.internal('ذخیره‌سازی دسته ناموفق بود.')

            if (input.hasSubCategories) {
                for (const [subName, subAr] of this.categorySubs(input)) {
                    const subSlug = await this.uniqueSlug(subName, 'sub', tx)
                    await tx.insert(articleSubCategories).values({
                        categoryId: created.id, name: subName, nameAr: subAr, slug: subSlug,
                    })
                }
            }
        })
        await this.cache.invalidate()
        return { success: true }
    }

    async updateCategory(id: string, input: ArticleCategoryInput): Promise<void> {
        if (!UUID_RE.test(id)) throw Err.notFound('دسته مقاله پیدا نشد.')
        const name = input.name.trim()
        if (!name) throw Err.validation('نام دسته الزامی است.')

        await this.deps.db.transaction(async (tx) => {
            await tx.execute(sql`select pg_advisory_xact_lock(hashtext('articles:taxonomy'))`)
            const [cat] = await tx.update(articleCategories).set({
                name,
                ...(input.nameAr !== undefined ? { nameAr: nullIfEmpty(input.nameAr) } : {}),
                hasSubCategories: input.hasSubCategories,
            }).where(eq(articleCategories.id, id)).returning({ id: articleCategories.id })
            if (!cat) throw Err.notFound('دسته مقاله پیدا نشد.')
            // Slugs and disabled sub-categories stay available when re-enabled.
            if (!input.hasSubCategories || input.subCategories === undefined) return

            const existing = await tx.select().from(articleSubCategories)
                .where(eq(articleSubCategories.categoryId, id))
            const wanted = this.categorySubs(input)
            for (const [subName, subAr] of wanted) {
                const match = existing.find((s) => s.name === subName)
                if (match) {
                    if (input.subCategoriesAr !== undefined) {
                        await tx.update(articleSubCategories).set({ nameAr: subAr })
                            .where(eq(articleSubCategories.id, match.id))
                    }
                } else {
                    const subSlug = await this.uniqueSlug(subName, 'sub', tx)
                    await tx.insert(articleSubCategories)
                        .values({ categoryId: id, name: subName, nameAr: subAr, slug: subSlug })
                }
            }
            const stale = existing.filter((s) => !wanted.has(s.name)).map((s) => s.id)
            if (stale.length > 0) {
                await tx.delete(articleSubCategories).where(inArray(articleSubCategories.id, stale))
            }
        })
        await this.cache.invalidate()
    }

    async deleteCategory(id: string): Promise<{ success: boolean; message?: string }> {
        if (!UUID_RE.test(id)) throw Err.notFound('دسته مقاله پیدا نشد.')
        // stage-63 — حذف آبشاری (خواسته‌ی صریح کارفرما): با حذف دسته‌ی
        // مقاله، «تمام مقالات زیرش» هم حذف می‌شوند. FK مقاله→دسته
        // restrict است، پس مقالات اول در همان تراکنش حذف می‌شوند؛
        // ساب‌دسته‌ها با cascade خود DB کنار می‌روند.
        const count = await this.deps.db.transaction(async (tx) => {
            await tx.execute(sql`select pg_advisory_xact_lock(hashtext('articles:taxonomy'))`)
            // Lock the parent before deleting children, preventing a concurrent article
            // insert from leaving a new reference between these two statements.
            const [cat] = await tx.select({ id: articleCategories.id }).from(articleCategories)
                .where(eq(articleCategories.id, id)).for('update')
            if (!cat) throw Err.notFound('دسته مقاله پیدا نشد.')
            const removed = await tx.delete(articles).where(eq(articles.categoryId, id)).returning({ id: articles.id })
            await tx.delete(articleCategories).where(eq(articleCategories.id, id))
            return removed.length
        })
        await this.cache.invalidate()
        return {
            success: true,
            message:
                count > 0
                    ? `دسته و ${count.toLocaleString('fa-IR')} مقاله‌ی زیرش حذف شدند`
                    : 'دسته حذف شد',
        }
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
                    // stage-60 — پرچم سنجاق ویژه در لیست سبک
                    isFeatured: articles.isFeatured,
                },
                c: articleCategories,
                s: articleSubCategories,
            })
            .from(articles)
            .innerJoin(articleCategories, eq(articleCategories.id, articles.categoryId))
            .leftJoin(articleSubCategories, eq(articleSubCategories.id, articles.subCategoryId))
            .$dynamic()
    }

    private assertArticleText(input: ArticleInput, content: string): void {
        if (!input.title.trim()) throw Err.validation('عنوان مقاله الزامی است.')
        if (!input.excerpt.trim()) throw Err.validation('خلاصه مقاله الزامی است.')
        if (!content.trim()) throw Err.validation('متن مقاله الزامی است.')
    }

    private normalizeProcessesAr(processes: ArticleInput['processesAr']): NonNullable<ArticleInput['processesAr']> | null {
        if (!processes?.some((p) => p.title.trim() || p.items.some((item) => item.trim()))) return null
        return processes.map((p) => ({ title: p.title.trim(), items: p.items.map((item) => item.trim()) }))
    }

    private categorySubs(input: ArticleCategoryInput): Map<string, string | null> {
        const subs = new Map<string, string | null>()
        for (const [index, raw] of (input.subCategories ?? []).entries()) {
            const name = raw.trim()
            if (name && !subs.has(name)) subs.set(name, nullIfEmpty(input.subCategoriesAr?.[index]))
        }
        return subs
    }

    private async assertCategory(categoryId: string, subCategoryId: string | null, db: DbOrTx = this.deps.db): Promise<void> {
        if (!UUID_RE.test(categoryId)) throw Err.notFound('دسته‌ی مقاله پیدا نشد.')
        const cat = await db.query.articleCategories.findFirst({
            where: eq(articleCategories.id, categoryId),
        })
        if (!cat) throw Err.notFound('دسته‌ی مقاله پیدا نشد.')
        if (subCategoryId) {
            if (!UUID_RE.test(subCategoryId)) throw Err.notFound('ساب‌دسته پیدا نشد.')
            const sub = await db.query.articleSubCategories.findFirst({
                where: eq(articleSubCategories.id, subCategoryId),
            })
            if (!sub) throw Err.notFound('ساب‌دسته پیدا نشد.')
            if (sub.categoryId !== cat.id) {
                throw Err.validation('این ساب‌دسته به این دسته تعلق ندارد.')
            }
        }
    }

    /** slug از نام (فارسی مجاز — مثل منو) + حلقه‌ی یکتایی */
    private async uniqueSlug(name: string, kind: 'category' | 'sub', db: DbOrTx): Promise<string> {
        const base = (name.replace(/\s+/g, '-').toLowerCase() || (kind === 'category' ? 'cat' : 'sub')).slice(0, 60)
        // "all" is reserved by the public filter API.
        let slug = base === 'all' ? 'all-2' : base
        let i = base === 'all' ? 2 : 1
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
            const suffix = `-${++i}`
            slug = `${base.slice(0, 60 - suffix.length)}${suffix}`
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
            processes: (a.processes ?? []).map((process, index) => {
                const ar = lang === 'ar' ? a.processesAr?.[index] : undefined
                return {
                    title: nullIfEmpty(ar?.title) ?? process.title,
                    items: process.items.map((item, itemIndex) => nullIfEmpty(ar?.items[itemIndex]) ?? item),
                }
            }),
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
            // stage-60 — پرچم ویژه/سنجاق (۴ آیتم اول + Aurora)
            isFeatured: a.isFeatured ?? false,
            // stage-82 — سندِ بلوکی فقط در زبانِ فارسی (ادیتور فارسی‌زبان است؛
            // عربی همان مسیرِ متنیِ content/contentAr را می‌گیرد)
            blocks: lang === 'ar' ? null : (a.blocks ?? null),
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
            // stage-60 — پرچم ویژه/سنجاق (۴ آیتم اول + Aurora)
            isFeatured: a.isFeatured ?? false,
        }
    }
}
