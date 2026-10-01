// ═══════════════════════════════════════════════════════════════
// round-35 — sinshin-food-delivery — فایل 12 از 31
// مسیر مقصد: apps/api/src/domain/translation/translation.service.ts
// وضعیت: فایل جدید (قبلاً وجود نداشت)
// کامیت پیشنهادی: stage thirty one
// ═══════════════════════════════════════════════════════════════

// src/domain/translation/translation.service.ts
/**
 * round-35 — ارکستراتور ترجمه‌ی خودکار محتوا (فارسی → عربی).
 *
 * دو مسیر مستقل:
 *  ۱) preview (روت ادمین): متن می‌گیرد، ترجمه‌ی پیشنهادی برمی‌گرداند —
 *     «هیچ» چیزی در DB نمی‌نویسد؛ فرم پر می‌شود و ادمین بازبینی/ذخیره
 *     می‌کند (ذخیره‌ی دستی = arAuto=false طبق قرارداد رارد ۳۴).
 *  ۲) صف (worker): jobها از جدول translation_jobs claim اتمیک می‌شوند
 *     (FOR UPDATE SKIP LOCKED — امن بین رپلیکاها) و نتیجه مستقیم در
 *     ستون‌های ar با arAuto=true نوشته می‌شود (بج «خودکار» در پنل).
 *
 * قرارداد «دستی برنده»: فیلدی که عربیِ پرِ «دستی» دارد (arAuto=false)
 * هرگز بازنویسی نمی‌شود؛ فقط فیلد خالی یا ماشینیِ قبلی (arAuto=true)
 * جایگزین می‌شود. arAuto=true فقط وقتی می‌نشیند که هیچ فیلد دستی‌ای
 * از قلم نیفتاده باشد.
 *
 * پایداری: خطای مترجم = retry با backoff (۳۰s × تلاش²) تا maxAttempts؛
 * «مترجم پایین» تلاش را نمی‌سوزاند (۵ دقیقه بعد، attempts بازگردانده).
 * خطای نهایی = ستون ar همان NULL می‌ماند → کاربر عربی fallback فارسی
 * می‌بیند (COALESCE رارد ۳۴) — سایت هرگز از این بابت نمی‌ایستد.
 */
import { and, count, desc, eq, isNotNull, isNull, max, or, sql } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import type { AppConfig } from '#/infra/config/env'
import type { MenuService } from '#/domain/menu/menu.service'
import {
  asCategoryId,
  asGalleryImageId,
  asMainCategoryId,
  asProductId,
  asSizeId,
} from '#/domain/shared/brand'
import { AppError, Err } from '#/domain/shared/errors'
import { TranslateClient } from '#/domain/translation/translate-client'
import { planText, type TextPlan } from '#/domain/translation/markdown'
import {
  articleCategories,
  articleSubCategories,
  articles,
  categories,
  contentAbout,
  galleryImages,
  mainCategories,
  products,
  productSizes,
  terms,
  translationJobs,
} from '#/infra/db/schema'
import type {
  TranslationEntityType,
  TranslationJobDto,
  TranslationJobStatus,
  TranslationStatusDto,
} from '@sinshin/shared'

export const TRANSLATION_ENTITY_TYPES: readonly TranslationEntityType[] = [
  'product',
  'mainCategory',
  'category',
  'article',
  'articleCategory',
  'articleSubCategory',
  'gallery',
  'terms',
  'about',
] as const

/** TTL کش سلامت مترجم برای بج پنل */
const HEALTH_CACHE_MS = 30_000
/** سقف enqueued هر نوع در هر فراخوانی bulk */
const BULK_CAP_PER_TYPE = 1000
/** preview: سقف ورودی (هم‌قف کانتینر مترجم) */
const PREVIEW_MAX_CHARS = 30_000

interface ClaimedJob {
  id: string
  entityType: TranslationEntityType
  entityId: string
  attempts: number
  maxAttempts: number
}

/** آیا مقدار ar پر است؟ (رشته‌ی غیرخالی یا آرایه‌ی غیرخالی) */
const isFilled = (v: unknown): boolean => {
  if (typeof v === 'string') return v.trim() !== ''
  if (Array.isArray(v)) return v.length > 0
  return false
}

/** برش امن به سقف varchar ستون */
const clamp = (v: string, maxLen: number): string =>
  v.length <= maxLen ? v : v.slice(0, maxLen).trimEnd()

/** خطای یکتایی Postgres (dedupe concurrent) */
const isUniqueViolation = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505'

export class TranslationService {
  private readonly client: TranslateClient

  // کش سلامت مترجم — بج پنل نباید به ازای هر poll یک fetch بزند
  private healthAt = 0
  private healthUp = false
  private healthModel = ''

  constructor(
    private readonly deps: { db: Db; config: AppConfig; menu: MenuService },
  ) {
    this.client = new TranslateClient({ config: deps.config })
  }

  // ═══════════════════════ مسیر ۱: preview (بدون نوشتن DB) ═══════════════════════

  /** پیشنهاد ترجمه — Markdown-aware؛ برای دکمه‌ی «ترجمه‌ی خودکار» فرم‌ها */
  async preview(texts: string[]): Promise<string[]> {
    const cleaned = texts.map((t) => t.trim())
    if (cleaned.length === 0 || cleaned.some((t) => t === '')) {
      throw Err.validation('متن خالی قابل ترجمه نیست.')
    }
    if (cleaned.some((t) => t.length > PREVIEW_MAX_CHARS)) {
      throw Err.validation('متن خیلی طولانی است (سقف: ۳۰٬۰۰۰ کاراکتر).')
    }
    return this.translateTexts(cleaned)
  }

  /** چند متن → چند متن؛ هرکدام plan خودش را دارد و همه در batch واحد می‌روند */
  private async translateTexts(texts: string[]): Promise<string[]> {
    const plans = texts.map((t) => planText(t))
    const flat = plans.flatMap((p) => p.segments)
    const translated = await this.client.translate(flat)
    let idx = 0
    return plans.map((p) => {
      const slice = translated.slice(idx, idx + p.segments.length)
      idx += p.segments.length
      return p.assemble(slice)
    })
  }

  /**
   * ترجمه‌ی لیست (مواد اولیه، مراحل، بندها) — ورودی/خروجی هم‌طول و هم‌ایندکس.
   * هر آیتم یک متنِ تک‌خطی است → نگاشت ۱:۱ تضمینی سمت کانتینر.
   */
  private async translateList(items: readonly string[]): Promise<string[]> {
    const idxs: number[] = []
    const payload: string[] = []
    items.forEach((s, i) => {
      const t = s.trim()
      if (t !== '') {
        idxs.push(i)
        payload.push(t)
      }
    })
    const out = new Array<string>(items.length).fill('')
    if (payload.length > 0) {
      const tr = await this.client.translate(payload)
      idxs.forEach((origIdx, k) => {
        out[origIdx] = (tr[k] ?? '').trim()
      })
    }
    return out
  }

  // ═══════════════════════ مسیر ۲: صف ترجمه (worker) ═══════════════════════

  /** claim اتمیک یک job — FOR UPDATE SKIP LOCKED بین رپلیکاها */
  private async claim(): Promise<ClaimedJob | null> {
    const rows = await this.deps.db
      .update(translationJobs)
      .set({
        status: 'running',
        attempts: sql`${translationJobs.attempts} + 1`,
        startedAt: new Date(),
      })
      .where(
        sql`${translationJobs.id} = (
          SELECT id FROM ${translationJobs}
          WHERE status = 'pending' AND next_attempt_at <= now()
          ORDER BY created_at
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )`,
      )
      .returning()
    const r = rows[0]
    if (!r) return null
    return {
      id: r.id,
      entityType: r.entityType as TranslationEntityType,
      entityId: r.entityId,
      attempts: r.attempts,
      maxAttempts: r.maxAttempts,
    }
  }

  /** نجات jobهای گیر‌کرده (کرش وسط اجرا) — runningِ کهنه → pending */
  async reapStuck(stuckMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - stuckMs)
    const rows = await this.deps.db
      .update(translationJobs)
      .set({
        status: 'pending',
        nextAttemptAt: new Date(),
        lastError: 'بازگردانده به صف — اجرای قبلی نیمه‌کاره مانده بود',
      })
      .where(and(eq(translationJobs.status, 'running'), sql`${translationJobs.startedAt} < ${cutoff}`))
      .returning({ id: translationJobs.id })
    return rows.length
  }

  /**
   * پردازش یک job. خروجی برای حلقه‌ی worker:
   * 'empty' صف خالی | 'done' موفق | 'failed' شکست (retry یا نهایی) |
   * 'translator-down' مترجم در دسترس نبود — حلقه را می‌بندد
   */
  async processNext(): Promise<'empty' | 'done' | 'failed' | 'translator-down'> {
    const job = await this.claim()
    if (!job) return 'empty'
    try {
      const note = await this.runJob(job)
      await this.deps.db
        .update(translationJobs)
        .set({ status: 'done', finishedAt: new Date(), lastError: note })
        .where(eq(translationJobs.id, job.id))
      return 'done'
    } catch (err) {
      // مترجم پایین — تلاش را برمی‌گردانیم؛ صف بعداً خودش دوباره می‌آید
      if (err instanceof AppError && err.code === 'SERVICE_UNAVAILABLE') {
        await this.deps.db
          .update(translationJobs)
          .set({
            status: 'pending',
            attempts: sql`GREATEST(${translationJobs.attempts} - 1, 0)`,
            nextAttemptAt: new Date(Date.now() + 5 * 60_000),
            lastError: 'مترجم در دسترس نبود — ۵ دقیقه بعد دوباره',
          })
          .where(eq(translationJobs.id, job.id))
        return 'translator-down'
      }
      const msg = (err instanceof Error ? err.message : String(err)).slice(0, 500)
      if (job.attempts >= job.maxAttempts) {
        await this.deps.db
          .update(translationJobs)
          .set({ status: 'failed', lastError: msg, finishedAt: new Date() })
          .where(eq(translationJobs.id, job.id))
        console.error(`[translate] job ${job.entityType}/${job.entityId} نهایتاً شکست خورد:`, msg)
        return 'failed'
      }
      // backoff تصاعدی: ~۳۰s بعد تلاش اول، ~۱۲۰s بعد دومی
      const backoffMs = 30_000 * job.attempts * job.attempts
      await this.deps.db
        .update(translationJobs)
        .set({ status: 'pending', lastError: msg, nextAttemptAt: new Date(Date.now() + backoffMs) })
        .where(eq(translationJobs.id, job.id))
      return 'failed'
    }
  }

  /** dispatch بر اساس نوع موجودیت — خروجی: یادداشت اختیاری برای lastError */
  private async runJob(job: ClaimedJob): Promise<string | null> {
    switch (job.entityType) {
      case 'product':
        return this.runProduct(job.entityId)
      case 'mainCategory':
        return this.runMainCategory(job.entityId)
      case 'category':
        return this.runCategory(job.entityId)
      case 'article':
        return this.runArticle(job.entityId)
      case 'articleCategory':
        return this.runArticleCategory(job.entityId)
      case 'articleSubCategory':
        return this.runArticleSubCategory(job.entityId)
      case 'gallery':
        return this.runGallery(job.entityId)
      case 'terms':
        return this.runTerms(job.entityId)
      case 'about':
        return this.runAbout()
    }
  }

  // ── product: name/description/ingredients + نام سایزها ──
  private async runProduct(entityId: string): Promise<string | null> {
    const { db } = this.deps
    const pid = asProductId(entityId)
    const [p] = await db.select().from(products).where(eq(products.id, pid))
    if (!p) return 'محصول پیدا نشد (شاید حذف شده باشد)'

    let skippedManual = false
    const queue: Array<{ plan: TextPlan; apply: (assembled: string) => void }> = []
    const out: { nameAr?: string; descriptionAr?: string; ingredientsAr?: string[] } = {}
    const sizeWrites: Array<{ id: string; nameAr: string }> = []

    const submit = (fa: string | null | undefined, ar: unknown, apply: (t: string) => void): void => {
      if (isFilled(ar) && p.arAuto === false) {
        skippedManual = true
        return
      }
      const src = (fa ?? '').trim()
      if (src === '') return
      const plan = planText(src)
      if (plan.segments.length > 0) queue.push({ plan, apply })
    }

    submit(p.name, p.nameAr, (t) => {
      out.nameAr = clamp(t, 120)
    })
    submit(p.description, p.descriptionAr, (t) => {
      const v = t.trim()
      if (v !== '') out.descriptionAr = v
    })

    // مواد اولیه — لیستِ موازی
    const ingredients = (p.ingredients ?? []).filter((s) => s.trim() !== '')
    const listQueue: Array<{ items: string[]; apply: (list: string[]) => void }> = []
    if (ingredients.length > 0) {
      if (isFilled(p.ingredientsAr) && p.arAuto === false) skippedManual = true
      else listQueue.push({ items: ingredients, apply: (l) => { out.ingredientsAr = l } })
    }

    // سایزها — ردیف‌های مستقل با پرچم رکوردِ محصول
    const sizeRows = await db.select().from(productSizes).where(eq(productSizes.productId, pid))
    for (const s of sizeRows) {
      submit(s.name, s.nameAr, (t) => {
        sizeWrites.push({ id: s.id, nameAr: clamp(t, 60) })
      })
    }

    await this.flushQueues(queue, listQueue)

    const patch: Record<string, unknown> = {}
    if (out.nameAr !== undefined) patch.nameAr = out.nameAr
    if (out.descriptionAr !== undefined) patch.descriptionAr = out.descriptionAr
    if (out.ingredientsAr !== undefined) patch.ingredientsAr = out.ingredientsAr
    for (const s of sizeWrites) {
      await db.update(productSizes).set({ nameAr: s.nameAr }).where(eq(productSizes.id, asSizeId(s.id)))
    }
    const wroteAny =
      Object.keys(patch).length > 0 || sizeWrites.length > 0
    if (wroteAny) {
      // پرچم «خودکار» فقط وقتی هیچ فیلد دستی‌ای دور نگه داشته نشده باشد
      if (!skippedManual) patch.arAuto = true
      await db.update(products).set(patch).where(eq(products.id, pid))
      await this.deps.menu.bustCache()
      return null
    }
    return skippedManual ? 'همه‌ی فیلدها دستی بودند — چیزی بازنویسی نشد' : 'فیلد قابل‌ترجمه‌ای نبود'
  }

  // ── دسته‌ی اصلی منو: name (جدول ar_auto ندارد — سیاست: فقط خانه‌ی خالی) ──
  private async runMainCategory(entityId: string): Promise<string | null> {
    const { db } = this.deps
    const [row] = await db
      .select()
      .from(mainCategories)
      .where(eq(mainCategories.id, asMainCategoryId(entityId)))
    if (!row) return 'دسته‌ی اصلی پیدا نشد (شاید حذف شده باشد)'
    if (isFilled(row.nameAr)) return 'ترجمه‌ی موجود بود — بازنویسی نشد'
    const [t] = await this.translateTexts([row.name])
    const nameAr = clamp(t ?? '', 60)
    if (nameAr.trim() === '') return 'ترجمه خالی برگشت'
    await db
      .update(mainCategories)
      .set({ nameAr })
      .where(eq(mainCategories.id, asMainCategoryId(entityId)))
    await this.deps.menu.bustCache()
    return null
  }

  // ── دسته‌ی محصولات: name + قالب سایزها ──
  private async runCategory(entityId: string): Promise<string | null> {
    const { db } = this.deps
    const cid = asCategoryId(entityId)
    const [c] = await db.select().from(categories).where(eq(categories.id, cid))
    if (!c) return 'دسته پیدا نشد (شاید حذف شده باشد)'

    // جدول ar_auto ندارد — سیاست: فقط خانه‌های خالی پر می‌شوند
    const patch: Record<string, unknown> = {}
    if (!isFilled(c.nameAr)) {
      const [nameTr] = await this.translateTexts([c.name])
      const nameAr = clamp(nameTr ?? '', 60)
      if (nameAr.trim() === '') return 'ترجمه خالی برگشت'
      patch.nameAr = nameAr
    }
    const sizeNames = (c.sizeNames ?? []).filter((s) => s.trim() !== '')
    if (sizeNames.length > 0 && !isFilled(c.sizeNamesAr)) {
      patch.sizeNamesAr = await this.translateList(sizeNames)
    }
    if (Object.keys(patch).length === 0) return 'ترجمه‌ی موجود بود — بازنویسی نشد'
    await db.update(categories).set(patch).where(eq(categories.id, cid))
    await this.deps.menu.bustCache()
    return null
  }

  // ── article: title/excerpt/content (Markdown) + processes ──
  private async runArticle(entityId: string): Promise<string | null> {
    const { db } = this.deps
    const [a] = await db.select().from(articles).where(eq(articles.id, entityId))
    if (!a) return 'مقاله پیدا نشد (شاید حذف شده باشد)'

    let skippedManual = false
    const queue: Array<{ plan: TextPlan; apply: (assembled: string) => void }> = []
    const out: { titleAr?: string; excerptAr?: string; contentAr?: string } = {}

    const submit = (fa: string | null | undefined, ar: unknown, apply: (t: string) => void): void => {
      if (isFilled(ar) && a.arAuto === false) {
        skippedManual = true
        return
      }
      const src = (fa ?? '').trim()
      if (src === '') return
      const plan = planText(src)
      if (plan.segments.length > 0) queue.push({ plan, apply })
    }

    submit(a.title, a.titleAr, (t) => {
      out.titleAr = clamp(t, 160)
    })
    submit(a.excerpt, a.excerptAr, (t) => {
      const v = t.trim()
      if (v !== '') out.excerptAr = v
    })
    // بدنه — Markdown؛ تکه‌تکه در planText
    submit(a.content, a.contentAr, (t) => {
      const v = t.trim()
      if (v !== '') out.contentAr = v
    })

    // روند تهیه — ساختار [{title, items[]}] با هم‌ایندکس
    let processesAr: { title: string; items: string[] }[] | undefined
    const processes = (a.processes ?? []).filter(
      (pr) => pr.title.trim() !== '' || pr.items.length > 0,
    )
    if (processes.length > 0) {
      if (isFilled(a.processesAr) && a.arAuto === false) {
        skippedManual = true
      } else {
        const flat: string[] = []
        for (const pr of processes) {
          flat.push(pr.title)
          flat.push(...pr.items)
        }
        const tr = await this.translateList(flat)
        let i = 0
        processesAr = processes.map((pr) => ({
          title: tr[i++] ?? pr.title,
          items: pr.items.map(() => tr[i++] ?? ''),
        }))
      }
    }

    await this.flushQueues(queue, [])

    const patch: Record<string, unknown> = {}
    if (out.titleAr !== undefined) patch.titleAr = out.titleAr
    if (out.excerptAr !== undefined) patch.excerptAr = out.excerptAr
    if (out.contentAr !== undefined) patch.contentAr = out.contentAr
    if (processesAr !== undefined) patch.processesAr = processesAr
    if (Object.keys(patch).length > 0) {
      if (!skippedManual) patch.arAuto = true
      await db.update(articles).set(patch).where(eq(articles.id, entityId))
      return null
    }
    return skippedManual ? 'همه‌ی فیلدها دستی بودند — چیزی بازنویسی نشد' : 'فیلد قابل‌ترجمه‌ای نبود'
  }

  // ── دسته‌ی مقاله / ساب‌دسته: name (این دو جدول ar_auto ندارند — رارد ۳۴؛ سیاست: فقط خانه‌ی خالی) ──
  private async runArticleCategory(entityId: string): Promise<string | null> {
    const { db } = this.deps
    const [row] = await db.select().from(articleCategories).where(eq(articleCategories.id, entityId))
    if (!row) return 'دسته‌ی مقاله پیدا نشد (شاید حذف شده باشد)'
    if (isFilled(row.nameAr)) return 'ترجمه‌ی موجود بود — بازنویسی نشد'
    const [t] = await this.translateTexts([row.name])
    const nameAr = clamp(t ?? '', 60)
    if (nameAr.trim() === '') return 'ترجمه خالی برگشت'
    await db.update(articleCategories).set({ nameAr }).where(eq(articleCategories.id, entityId))
    return null
  }

  private async runArticleSubCategory(entityId: string): Promise<string | null> {
    const { db } = this.deps
    const [row] = await db
      .select()
      .from(articleSubCategories)
      .where(eq(articleSubCategories.id, entityId))
    if (!row) return 'ساب‌دسته‌ی مقاله پیدا نشد (شاید حذف شده باشد)'
    if (isFilled(row.nameAr)) return 'ترجمه‌ی موجود بود — بازنویسی نشد'
    const [t] = await this.translateTexts([row.name])
    const nameAr = clamp(t ?? '', 60)
    if (nameAr.trim() === '') return 'ترجمه خالی برگشت'
    await db.update(articleSubCategories).set({ nameAr }).where(eq(articleSubCategories.id, entityId))
    return null
  }

  // ── gallery: alt ──
  private async runGallery(entityId: string): Promise<string | null> {
    const { db } = this.deps
    const gid = asGalleryImageId(entityId)
    const [g] = await db.select().from(galleryImages).where(eq(galleryImages.id, gid))
    if (!g) return 'تصویر گالری پیدا نشد (شاید حذف شده باشد)'
    if (isFilled(g.altAr) && g.arAuto === false) return 'فیلد دستی بود — بازنویسی نشد'
    const src = g.alt.trim()
    if (src === '') return 'متن فارسی خالی است'
    const [t] = await this.translateTexts([src])
    const altAr = (t ?? '').trim()
    if (altAr === '') return 'ترجمه خالی برگشت'
    await db.update(galleryImages).set({ altAr, arAuto: true }).where(eq(galleryImages.id, gid))
    return null
  }

  // ── terms: آخرین نسخه — sections[{title, items[]}] (آپدیت درجا، بدون نسخه‌ی جدید) ──
  private async runTerms(entityId: string): Promise<string | null> {
    const { db } = this.deps
    const [row] = await db.select().from(terms).orderBy(desc(terms.version)).limit(1)
    if (!row) return 'هنوز نسخه‌ای از قوانین ذخیره نشده است'
    if (row.id !== entityId) return 'نسخه‌ی جدیدتری از قوانین ذخیره شده — این job منسوخ شد'
    if (isFilled(row.sectionsAr) && row.arAuto === false) return 'بندهای دستی بودند — بازنویسی نشد'
    const sections = (row.sections ?? []).filter((s) => s.title.trim() !== '' || s.items.length > 0)
    if (sections.length === 0) return 'بندی برای ترجمه نبود'

    const flat: string[] = []
    for (const s of sections) {
      flat.push(s.title)
      flat.push(...s.items)
    }
    const tr = await this.translateList(flat)
    let i = 0
    const sectionsAr = sections.map((s) => ({
      title: tr[i++] ?? s.title,
      items: s.items.map(() => tr[i++] ?? ''),
    }))
    await db.update(terms).set({ sectionsAr, arAuto: true }).where(eq(terms.id, row.id))
    return null
  }

  // ── about: چهار فیلد متنی singleton ──
  private async runAbout(): Promise<string | null> {
    const { db } = this.deps
    const [row] = await db.select().from(contentAbout).where(eq(contentAbout.id, 1))
    if (!row) return 'محتوای «درباره ما» ذخیره نشده است'

    let skippedManual = false
    const queue: Array<{ plan: TextPlan; apply: (t: string) => void }> = []
    const out: { heroTitleAr?: string; heroTextAr?: string; teamTitleAr?: string; teamAltAr?: string } = {}
    const fields: Array<[string, string | null]> = [
      [row.heroTitle, row.heroTitleAr],
      [row.heroText, row.heroTextAr],
      [row.teamTitle, row.teamTitleAr],
      [row.teamAlt, row.teamAltAr],
    ]
    const keys = ['heroTitleAr', 'heroTextAr', 'teamTitleAr', 'teamAltAr'] as const
    fields.forEach(([fa, ar], idx) => {
      if (isFilled(ar) && row.arAuto === false) {
        skippedManual = true
        return
      }
      const src = fa.trim()
      if (src === '') return
      const plan = planText(src)
      if (plan.segments.length === 0) return
      queue.push({
        plan,
        apply: (t) => {
          const v = t.trim()
          const k = keys[idx]
          if (v !== '' && k !== undefined) out[k] = v
        },
      })
    })

    await this.flushQueues(queue, [])

    const patch: Record<string, unknown> = {}
    for (const k of keys) {
      if (out[k] !== undefined) patch[k] = out[k]
    }
    if (Object.keys(patch).length > 0) {
      if (!skippedManual) patch.arAuto = true
      await db.update(contentAbout).set(patch).where(eq(contentAbout.id, 1))
      return null
    }
    return skippedManual ? 'همه‌ی فیلدها دستی بودند — چیزی بازنویسی نشد' : 'فیلد قابل‌ترجمه‌ای نبود'
  }

  /** اجرای batchهای جمع‌شده — همه‌ی متن‌ها در یک فراخوانی مترجم */
  private async flushQueues(
    queue: Array<{ plan: TextPlan; apply: (assembled: string) => void }>,
    listQueue: Array<{ items: string[]; apply: (list: string[]) => void }>,
  ): Promise<void> {
    if (queue.length > 0) {
      const flat = queue.flatMap((q) => q.plan.segments)
      const translated = await this.client.translate(flat)
      let idx = 0
      for (const q of queue) {
        const slice = translated.slice(idx, idx + q.plan.segments.length)
        idx += q.plan.segments.length
        q.apply(q.plan.assemble(slice))
      }
    }
    for (const l of listQueue) {
      l.apply(await this.translateList(l.items))
    }
  }

  // ═══════════════════════ enqueue / bulk / status / jobs ═══════════════════════

  /** افزودن یک موجودیت به صف (dedupe روی pending) */
  async enqueue(entityType: TranslationEntityType, entityId: string): Promise<{ queued: boolean }> {
    if (!TRANSLATION_ENTITY_TYPES.includes(entityType)) {
      throw Err.validation('نوع موجودیت قابل‌ترجمه نیست.')
    }
    let id = entityId.trim()
    if (id === '') throw Err.validation('شناسه‌ی موجودیت خالی است.')
    if (entityType === 'about') id = '1'
    if (entityType === 'terms' && id === 'latest') {
      const [row] = await this.deps.db
        .select({ id: terms.id })
        .from(terms)
        .orderBy(desc(terms.version))
        .limit(1)
      if (!row) return { queued: false }
      id = row.id
    }
    const existing = await this.deps.db
      .select({ id: translationJobs.id })
      .from(translationJobs)
      .where(
        and(
          eq(translationJobs.entityType, entityType),
          eq(translationJobs.entityId, id),
          eq(translationJobs.status, 'pending'),
        ),
      )
      .limit(1)
    if (existing.length > 0) return { queued: false }
    try {
      await this.deps.db.insert(translationJobs).values({ entityType, entityId: id })
      return { queued: true }
    } catch (e) {
      if (isUniqueViolation(e)) return { queued: false }
      throw e
    }
  }

  /** صف‌کردن همه‌ی رکوردهای ناقص یک نوع (یا همه‌ی انواع) */
  async enqueueBulkMissing(entityType?: TranslationEntityType): Promise<{ queued: number }> {
    if (entityType && !TRANSLATION_ENTITY_TYPES.includes(entityType)) {
      throw Err.validation('نوع موجودیت قابل‌ترجمه نیست.')
    }
    const types = entityType
      ? [entityType]
      : ([...TRANSLATION_ENTITY_TYPES] as TranslationEntityType[])
    let queued = 0
    for (const t of types) {
      const ids = await this.missingIds(t)
      if (ids.length === 0) continue
      const rows = await this.deps.db
        .insert(translationJobs)
        .values(ids.map((id) => ({ entityType: t, entityId: id })))
        .onConflictDoNothing()
        .returning({ id: translationJobs.id })
      queued += rows.length
    }
    return { queued }
  }

  /** وضعیت صف + شمار ناقص‌ها + سلامت مترجم (برای کارت پنل) */
  async status(): Promise<TranslationStatusDto> {
    const statusRows = await this.deps.db
      .select({ status: translationJobs.status, n: count() })
      .from(translationJobs)
      .groupBy(translationJobs.status)
    const queue = { pending: 0, running: 0, done: 0, failed: 0 }
    for (const r of statusRows) {
      if (r.status === 'pending' || r.status === 'running' || r.status === 'done' || r.status === 'failed') {
        queue[r.status] = r.n
      }
    }
    const missing: Partial<Record<TranslationEntityType, number>> = {}
    for (const t of TRANSLATION_ENTITY_TYPES) {
      const n = await this.missingCount(t)
      if (n > 0) missing[t] = n
    }
    const [lastRow] = await this.deps.db
      .select({ last: max(translationJobs.finishedAt) })
      .from(translationJobs)
    const health = await this.cachedHealth()
    return {
      queue,
      missing,
      translatorUp: health.up,
      translatorModel: health.up ? health.model : 'مترجم آفلاین است',
      lastFinishedAt: lastRow?.last ? lastRow.last.toISOString() : null,
    }
  }

  /** jobهای اخیر — جدول کارت پنل */
  async jobs(limit: number): Promise<TranslationJobDto[]> {
    const cap = Math.max(1, Math.min(50, Math.trunc(limit) || 15))
    const rows = await this.deps.db
      .select()
      .from(translationJobs)
      .orderBy(desc(translationJobs.createdAt))
      .limit(cap)
    return rows.map((r) => ({
      id: r.id,
      entityType: r.entityType as TranslationEntityType,
      entityId: r.entityId,
      status: r.status as TranslationJobStatus,
      attempts: r.attempts,
      maxAttempts: r.maxAttempts,
      lastError: r.lastError,
      createdAt: r.createdAt.toISOString(),
      startedAt: r.startedAt ? r.startedAt.toISOString() : null,
      finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
    }))
  }

  // ═══════════════════════ اسکن رکوردهای ناقص ═══════════════════════

  private productMissingWhere() {
    return or(
      isNull(products.nameAr),
      and(isNotNull(products.description), isNull(products.descriptionAr)),
      sql`jsonb_array_length(COALESCE(${products.ingredients}, '[]'::jsonb)) > 0 AND ${products.ingredientsAr} IS NULL`,
      and(
        eq(products.sizesEnabled, true),
        sql`EXISTS (SELECT 1 FROM ${productSizes} ps WHERE ps.product_id = ${products.id} AND ps.name_ar IS NULL)`,
      ),
    )
  }

  private categoryMissingWhere() {
    return or(
      isNull(categories.nameAr),
      and(
        sql`jsonb_array_length(COALESCE(${categories.sizeNames}, '[]'::jsonb)) > 0`,
        isNull(categories.sizeNamesAr),
      ),
    )
  }

  private articleMissingWhere() {
    return or(
      isNull(articles.titleAr),
      isNull(articles.excerptAr),
      isNull(articles.contentAr),
      and(
        sql`jsonb_array_length(COALESCE(${articles.processes}, '[]'::jsonb)) > 0`,
        isNull(articles.processesAr),
      ),
    )
  }

  /** شناسه‌ی رکوردهایی که «حداقل یک» فیلد عربی‌شان خالی است */
  private async missingIds(t: TranslationEntityType): Promise<string[]> {
    const { db } = this.deps
    switch (t) {
      case 'product':
        return (
          await db
            .select({ id: products.id })
            .from(products)
            .where(this.productMissingWhere())
            .limit(BULK_CAP_PER_TYPE)
        ).map((r) => r.id as string)
      case 'mainCategory':
        return (
          await db
            .select({ id: mainCategories.id })
            .from(mainCategories)
            .where(isNull(mainCategories.nameAr))
            .limit(BULK_CAP_PER_TYPE)
        ).map((r) => r.id as string)
      case 'category':
        return (
          await db
            .select({ id: categories.id })
            .from(categories)
            .where(this.categoryMissingWhere())
            .limit(BULK_CAP_PER_TYPE)
        ).map((r) => r.id as string)
      case 'article':
        return (
          await db
            .select({ id: articles.id })
            .from(articles)
            .where(this.articleMissingWhere())
            .limit(BULK_CAP_PER_TYPE)
        ).map((r) => r.id)
      case 'articleCategory':
        return (
          await db
            .select({ id: articleCategories.id })
            .from(articleCategories)
            .where(isNull(articleCategories.nameAr))
            .limit(BULK_CAP_PER_TYPE)
        ).map((r) => r.id)
      case 'articleSubCategory':
        return (
          await db
            .select({ id: articleSubCategories.id })
            .from(articleSubCategories)
            .where(isNull(articleSubCategories.nameAr))
            .limit(BULK_CAP_PER_TYPE)
        ).map((r) => r.id)
      case 'gallery':
        return (
          await db
            .select({ id: galleryImages.id })
            .from(galleryImages)
            .where(isNull(galleryImages.altAr))
            .limit(BULK_CAP_PER_TYPE)
        ).map((r) => r.id as string)
      case 'terms': {
        const [row] = await db
          .select({ id: terms.id, sectionsAr: terms.sectionsAr })
          .from(terms)
          .orderBy(desc(terms.version))
          .limit(1)
        return row && !isFilled(row.sectionsAr) ? [row.id] : []
      }
      case 'about': {
        const [row] = await db.select().from(contentAbout).where(eq(contentAbout.id, 1))
        if (!row) return []
        const missing = [row.heroTitleAr, row.heroTextAr, row.teamTitleAr, row.teamAltAr].some(
          (v) => !isFilled(v),
        )
        return missing ? ['1'] : []
      }
    }
  }

  private async missingCount(t: TranslationEntityType): Promise<number> {
    const { db } = this.deps
    switch (t) {
      case 'product': {
        const [r] = await db.select({ n: count() }).from(products).where(this.productMissingWhere())
        return r?.n ?? 0
      }
      case 'mainCategory': {
        const [r] = await db
          .select({ n: count() })
          .from(mainCategories)
          .where(isNull(mainCategories.nameAr))
        return r?.n ?? 0
      }
      case 'category': {
        const [r] = await db.select({ n: count() }).from(categories).where(this.categoryMissingWhere())
        return r?.n ?? 0
      }
      case 'article': {
        const [r] = await db.select({ n: count() }).from(articles).where(this.articleMissingWhere())
        return r?.n ?? 0
      }
      case 'articleCategory': {
        const [r] = await db
          .select({ n: count() })
          .from(articleCategories)
          .where(isNull(articleCategories.nameAr))
        return r?.n ?? 0
      }
      case 'articleSubCategory': {
        const [r] = await db
          .select({ n: count() })
          .from(articleSubCategories)
          .where(isNull(articleSubCategories.nameAr))
        return r?.n ?? 0
      }
      case 'gallery': {
        const [r] = await db
          .select({ n: count() })
          .from(galleryImages)
          .where(isNull(galleryImages.altAr))
        return r?.n ?? 0
      }
      case 'terms':
      case 'about':
        return (await this.missingIds(t)).length
    }
  }

  private async cachedHealth(): Promise<{ up: boolean; model: string }> {
    if (Date.now() - this.healthAt < HEALTH_CACHE_MS) {
      return { up: this.healthUp, model: this.healthModel }
    }
    const h = await this.client.health()
    this.healthAt = Date.now()
    this.healthUp = h.up
    this.healthModel = h.model
    return h
  }
}
