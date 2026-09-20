// src/domain/article/article.service.ts
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import {
    articles,
    articleCategories,
    articleSubCategories,
} from '#/infra/db/schema'
import { Err } from '#/domain/shared/errors'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

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
}

export interface ArticleCategoryView {
    id: string
    name: string
    slug: string
    hasSubCategories: boolean
    subCategories: { id: string; name: string; slug: string }[]
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
}

type ArticleRow = typeof articles.$inferSelect
type CategoryRow = typeof articleCategories.$inferSelect
type SubRow = typeof articleSubCategories.$inferSelect

/**
 * مقالات — عمومی (فقط ACTIVE) + ادمین (همه).
 * «مرگ 404» — فرانت از اول روی این قراردادها ساخته شده بود، روت‌ها نبودند.
 */
export class ArticleService {
    constructor(private readonly deps: { db: Db }) { }

    // ═══ عمومی ═══

    async categories(): Promise<ArticleCategoryView[]> {
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
            name: c.name,
            slug: c.slug,
            hasSubCategories: c.hasSubCategories,
            subCategories: (subsByCat.get(c.id) ?? []).map((s) => ({
                id: s.id,
                name: s.name,
                slug: s.slug,
            })),
        }))
    }

    async listPublic(categorySlug?: string, subSlug?: string): Promise<ArticleView[]> {
        const conds = [eq(articles.status, 'ACTIVE')]
        if (categorySlug && categorySlug !== 'all') {
            conds.push(eq(articleCategories.slug, categorySlug))
        }
        if (subSlug && subSlug !== 'all') {
            conds.push(eq(articleSubCategories.slug, subSlug))
        }
        const rows = await this.joined().where(and(...conds)).orderBy(desc(articles.createdAt))
        return rows.map(({ a, c, s }) => this.toView(a, c, s))
    }

    /** جزئیات عمومی — فقط ACTIVE + شمارش بازدید (سورت most-viewed فرانت) */
    async byId(id: string): Promise<ArticleView | null> {
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

        return this.toView(row.a, row.c, row.s)
    }

    // ═══ ادمین: مقالات ═══

    async listAdmin(): Promise<ArticleView[]> {
        const rows = await this.joined().orderBy(desc(articles.createdAt))
        return rows.map(({ a, c, s }) => this.toView(a, c, s))
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
        return row ? this.toView(row.a, row.c, row.s) : null
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
        return { success: true }
    }

    async remove(id: string): Promise<{ success: boolean }> {
        if (!UUID_RE.test(id)) throw Err.notFound('مقاله پیدا نشد.')
        const removed = await this.deps.db
            .delete(articles)
            .where(eq(articles.id, id))
            .returning({ id: articles.id })
        if (removed.length === 0) throw Err.notFound('مقاله پیدا نشد.')
        return { success: true }
    }

    async toggle(id: string): Promise<void> {
        const row = await this.deps.db.query.articles.findFirst({ where: eq(articles.id, id) })
        if (!row) return
        await this.deps.db
            .update(articles)
            .set({ status: row.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE', updatedAt: new Date() })
            .where(eq(articles.id, row.id))
    }

    // ═══ ادمین: دسته‌ها ═══

    async createCategory(input: {
        name: string
        hasSubCategories: boolean
        subCategories?: string[]
    }): Promise<{ success: boolean }> {
        const { db } = this.deps
        const name = input.name.trim()
        if (!name) throw Err.validation('نام دسته الزامی است.')

        const slug = await this.uniqueSlug(name, 'category')
        const [created] = await db
            .insert(articleCategories)
            .values({ name, slug, hasSubCategories: input.hasSubCategories })
            .returning()
        if (!created) throw Err.internal('ذخیره‌سازی دسته ناموفق بود.')

        if (input.hasSubCategories) {
            for (const raw of input.subCategories ?? []) {
                const subName = raw.trim()
                if (!subName) continue
                const subSlug = await this.uniqueSlug(subName, 'sub')
                await db
                    .insert(articleSubCategories)
                    .values({ categoryId: created.id, name: subName, slug: subSlug })
            }
        }
        return { success: true }
    }

    async updateCategory(
        id: string,
        input: { name: string; hasSubCategories: boolean; subCategories?: string[] },
    ): Promise<void> {
        const { db } = this.deps
        const cat = await db.query.articleCategories.findFirst({
            where: eq(articleCategories.id, id),
        })
        if (!cat) throw Err.notFound('دسته مقاله پیدا نشد.')

        await db
            .update(articleCategories)
            .set({ name: input.name.trim(), hasSubCategories: input.hasSubCategories })
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

        for (const subName of wanted) {
            if (!existing.some((s) => s.name === subName)) {
                const subSlug = await this.uniqueSlug(subName, 'sub')
                await db
                    .insert(articleSubCategories)
                    .values({ categoryId: id, name: subName, slug: subSlug })
            }
        }
        const stale = existing.filter((s) => !wantedSet.has(s.name)).map((s) => s.id)
        if (stale.length > 0) {
            // مقالاتِ ارجاع‌دهنده: FK → SET NULL — بی‌خطر
            await db.delete(articleSubCategories).where(inArray(articleSubCategories.id, stale))
        }
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
        return { success: true }
    }

    // ── داخلی ──

    /** select مشترک با join دسته/ساب‌دسته — برچسب‌ها برای تگ‌ها و فیلتر فرانت */
    private joined() {
        return this.deps.db
            .select({ a: articles, c: articleCategories, s: articleSubCategories })
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

    private toView(a: ArticleRow, c: CategoryRow | null, s: SubRow | null): ArticleView {
        return {
            id: a.id,
            title: a.title,
            excerpt: a.excerpt,
            content: a.content,
            author: a.author,
            profileImage: a.profileImage,
            galleryImages: a.galleryImages ?? [],
            categoryId: a.categoryId,
            subCategoryId: a.subCategoryId,
            processes: a.processes ?? [],
            views: a.views,
            status: a.status,
            publishedAt: a.createdAt.toISOString(),
            categorySlug: c?.slug ?? null,
            categoryName: c?.name ?? null,
            subCategorySlug: s?.slug ?? null,
            subCategoryName: s?.name ?? null,
        }
    }
}