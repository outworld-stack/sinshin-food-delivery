// ═══════════════════════════════════════════════════════════════
// stage-55 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/domain/translation/translation.service.ts
// وضعیت: جایگزینی کامل فایل موجود
// تغییر: isUniqueViolation مشترک از shared/pg (حذف کپی محلی)
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// round-48 — sinshin-food-delivery — فایل 30 از 97
// مسیر مقصد: apps/api/src/domain/translation/translation.service.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage forty-three
// ═══════════════════════════════════════════════════════════════

// src/domain/translation/translation.service.ts
/**
 * Persian-to-Arabic previews and the existing entity translation queue.
 * Field provenance controls eligibility; arAuto is only a compatibility badge.
 * Each queued field is source/revision checked under the entity row lock before persistence.
 * Completed fields and manual translations are never automatically replaced.
 * Existing block whitelists, document proofs and Markdown protection remain shared.
 */
import { and, count, desc, eq, inArray, max, sql } from 'drizzle-orm'

import type { Db, DbOrTx } from '#/infra/db/client'
import type { AppConfig } from '#/infra/config/env'
import type { MenuService } from '#/domain/menu/menu.service'
import type { ArticleService } from '#/domain/article/article.service'
import { asProductId } from '#/domain/shared/brand'
import type { PackagingService } from '#/domain/menu/packaging.service'
import type { SettingsService } from '#/domain/settings/settings.service'
import { contentRows, readContentRow } from './content-translation.store'
import { ContentTranslationWorker } from './content-translation.worker'
import { AppError, Err } from '#/domain/shared/errors'
import { isUniqueViolation } from '#/domain/shared/pg'
import { TranslateClient } from '#/domain/translation/translate-client'
import { planText } from '#/domain/translation/markdown'
import {
  productSizes,
  terms,
  translationJobs,
} from '#/infra/db/schema'
import type {
  ArticleBlocksDoc,
  ArticleBlockType,
  ArticleBlockTextPath,
  TranslationEntityType,
  TranslationJobDto,
  TranslationJobStatus,
  TranslationStatusDto,
} from '@sinshin/shared'
import {
  articleBlocksContentForLimit,
  getArticleBlockTextFields,
  isArticleBlockTextPath,
  normalizeArticleBlocksTranslation,
  readArticleBlockText,
  setArticleBlockTranslations,
} from '@sinshin/shared'

export const TRANSLATION_ENTITY_TYPES: readonly TranslationEntityType[] = [
  'product',
  'productSize',
  'mainCategory',
  'category',
  'article',
  'articleCategory',
  'articleSubCategory',
  'gallery',
  'terms',
  'about',
  'packagingItem',
  'temporaryClose',
] as const

/** TTL کش سلامت مترجم برای بج پنل */
const HEALTH_CACHE_MS = 30_000
/** سقف enqueued هر نوع در هر فراخوانی bulk */
const BULK_CAP_PER_TYPE = 1000
  /** Bounded legacy text previews; Markdown is still segmented by the existing planner. */
const PREVIEW_MAX_CHARS = 1_000_000

interface ClaimedJob {
  id: string
  entityType: TranslationEntityType
  entityId: string
  attempts: number
  maxAttempts: number
  startedAt: Date
}

// stage-55 — isUniqueViolation به shared/pg رفت (DRY — همان 23505)

export class TranslationService {
  private readonly client: TranslateClient
  private readonly fields: ContentTranslationWorker

  // کش سلامت مترجم — بج پنل نباید به ازای هر poll یک fetch بزند
  private healthAt = 0
  private healthUp = false
  private healthModel = ''

  constructor(
    private readonly deps: { db: Db; config: AppConfig; menu: MenuService; articles: ArticleService; packaging?: PackagingService; settings?: SettingsService },
  ) {
    this.client = new TranslateClient({ config: deps.config })
    this.fields = new ContentTranslationWorker({ db: deps.db, translate: texts => this.translateTexts(texts), invalidate: async type => {
      if (['product', 'productSize', 'mainCategory', 'category', 'packagingItem'].includes(type)) await deps.menu.bustCache()
      if (['article', 'articleCategory', 'articleSubCategory'].includes(type)) await deps.articles.bustCache()
      if (type === 'packagingItem') deps.packaging?.bustCache()
      if (type === 'temporaryClose') deps.settings?.invalidateContentTranslationCache()
    } })
  }

  // ═══════════════════════ مسیر ۱: preview (بدون نوشتن DB) ═══════════════════════

  /** پیشنهاد ترجمه — Markdown-aware؛ برای دکمه‌ی «ترجمه‌ی خودکار» فرم‌ها */
  async preview(texts: string[]): Promise<string[]> {
    const cleaned = texts.map((t) => t.trim())
    if (cleaned.length === 0 || cleaned.some((t) => t === '')) {
      throw Err.validation('متن خالی قابل ترجمه نیست.')
    }
    if (cleaned.some((t) => t.length > PREVIEW_MAX_CHARS)) {
      throw Err.validation('متن خیلی طولانی است (سقف: ۱٬۰۰۰٬۰۰۰ کاراکتر).')
    }
    if (cleaned.reduce((length, text) => length + text.length, 0) > PREVIEW_MAX_CHARS) throw Err.validation('Preview input exceeds the total translation payload limit.')
    return this.translateTexts(cleaned)
  }

  /** A field preview sends exactly the selected source value, including its whitespace. */
  async previewBlockField(input: {
    blockId: string
    blockType: ArticleBlockType
    fieldPath: ArticleBlockTextPath
    text: string
    entityType?: 'article' | 'about'
    entityId?: string
    revision?: number
  }): Promise<{
    blockId: string
    blockType: ArticleBlockType
    fieldPath: ArticleBlockTextPath
    sourceText: string
    translation: string
    entityType?: 'article' | 'about'
    entityId?: string
    revision?: number
  }> {
    if (typeof input.blockId !== 'string' || !input.blockId.trim() || input.blockId.length > 64
      || !isArticleBlockTextPath(input.blockType, input.fieldPath)) {
      throw Err.validation('مسیر فیلد متنی بلوک معتبر نیست.')
    }
    if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > PREVIEW_MAX_CHARS) {
      throw Err.validation('متن فیلد بلوک خالی یا خیلی طولانی است.')
    }
    if (input.entityType !== undefined || input.entityId !== undefined || input.revision !== undefined) {
      if (!input.entityType || !input.entityId || input.revision === undefined) throw Err.validation('Saved block previews require entity identity and revision.')
      const translation = await this.fields.previewStoredBlockField({ ...input, entityType: input.entityType, entityId: input.entityId, revision: input.revision })
      return { blockId: input.blockId, blockType: input.blockType, fieldPath: [...input.fieldPath], sourceText: input.text, translation,
        entityType: input.entityType, entityId: input.entityId, revision: input.revision }
    }
    const [translation] = await this.client.translate([input.text])
    return {
      blockId: input.blockId,
      blockType: input.blockType,
      fieldPath: [...input.fieldPath],
      sourceText: input.text,
      translation: translation?.trim() ?? '',
    }
  }

  /** Translate only text into a separate review document; URLs and coordinates never enter the translator. */
  async previewBlocks(input: { blocks: unknown; blocksAr?: unknown; blockId?: string }): Promise<ArticleBlocksDoc> {
    const source = input.blocks as ArticleBlocksDoc | null
    if (!source || source.version !== 1 || !Array.isArray(source.blocks) || source.blocks.length > 200) {
      throw Err.validation('سند بلوکی مقاله معتبر نیست.')
    }
    if (Buffer.byteLength(JSON.stringify(articleBlocksContentForLimit(source)), 'utf8') > 262_144) {
      throw Err.validation('حجم محتوای بلوکی مقاله نباید بیشتر از ۲۵۶ کیلوبایت باشد.')
    }
    if (input.blockId !== undefined && !source.blocks.some(block => block?.id === input.blockId)) {
      throw Err.validation('بلوک انتخاب‌شده پیدا نشد.')
    }
    let out = normalizeArticleBlocksTranslation(source, input.blocksAr)
    if (!out) throw Err.validation('سند بلوکی مقاله معتبر نیست.')
    const queue: { blockId: string; path: ArticleBlockTextPath; text: string }[] = []
    for (const block of source.blocks) {
      if (input.blockId !== undefined && block?.id !== input.blockId) continue
      const current = out.blocks.find(candidate => candidate?.id === block?.id && candidate?.type === block?.type)
      for (const field of getArticleBlockTextFields(block)) {
        if (!field.text.trim() || readArticleBlockText(current, field.path).trim()) continue
        const proof = out.translation?.fields.find(state => state.blockId === block.id && state.blockType === block.type
          && JSON.stringify(state.fieldPath) === JSON.stringify(field.path))
        if (proof?.origin === 'manual' || proof?.origin === 'legacy') continue
        if (field.text.length > PREVIEW_MAX_CHARS) throw Err.validation('متن بلوک خیلی طولانی است.')
        queue.push({ blockId: block.id, path: field.path, text: field.text })
      }
    }
    if (queue.length > 0) {
      const translations = await this.translateTexts(queue.map(field => field.text))
      out = setArticleBlockTranslations(source, out, queue.map((field, index) => ({
        ...field, text: translations[index]?.trim() ?? '',
      })), 'automatic') ?? out
    }
    if (Buffer.byteLength(JSON.stringify(articleBlocksContentForLimit({ version: out.version, blocks: out.blocks })), 'utf8') > 262_144) {
      throw Err.validation('حجم ترجمه‌ی بلوکی مقاله نباید بیشتر از ۲۵۶ کیلوبایت باشد.')
    }
    if (Buffer.byteLength(JSON.stringify(articleBlocksContentForLimit(out)), 'utf8') > 2_097_152) {
      throw Err.validation('حجم سند ترجمه و وضعیت فیلدهای آن نباید بیشتر از ۲ مگابایت باشد.')
    }
    return out
  }

  /** چند متن → چند متن؛ هرکدام plan خودش را دارد و همه در دسته‌ای واحد می‌روند */
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

  // ═══════════════════════ مسیر ۲: صف ترجمه (worker) ═══════════════════════

  /** تصرف اتمیک یک کار — FOR UPDATE SKIP LOCKED بین رپلیکاها */
  private async claim(): Promise<ClaimedJob | null> {
    return this.deps.db.transaction(async tx => {
      // Serialize claims across replicas, including a pending successor to a running entity.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(73401926)`)
      const rows = await tx
        .update(translationJobs)
        .set({
          status: 'running',
          attempts: sql`${translationJobs.attempts} + 1`,
          startedAt: new Date(),
          nextAttemptAt: new Date(),
        })
      .where(
        sql`${translationJobs.id} = (
          SELECT pending.id FROM ${translationJobs} pending
          WHERE pending.status = 'pending' AND pending.next_attempt_at <= now()
            AND NOT EXISTS (SELECT 1 FROM ${translationJobs} running
              WHERE running.status = 'running' AND running.entity_type = pending.entity_type AND lower(running.entity_id) = lower(pending.entity_id))
          ORDER BY pending.created_at
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
      startedAt: r.startedAt ?? new Date(),
    }
    })
  }

  private async returnToPending(job: ClaimedJob, patch: { nextAttemptAt: Date; lastError: string; attempts?: number }, staleBefore?: Date): Promise<boolean> {
    return this.deps.db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(73401926)`)
      const [successor] = await tx.select({ id: translationJobs.id }).from(translationJobs).where(and(
        eq(translationJobs.entityType, job.entityType), sql`lower(${translationJobs.entityId}) = ${job.entityId.toLowerCase()}`, eq(translationJobs.status, 'pending'),
      )).limit(1)
      const changed = await tx.update(translationJobs).set(successor
        ? { status: 'failed', finishedAt: new Date(), lastError: patch.lastError }
        : { status: 'pending', ...patch }).where(and(eq(translationJobs.id, job.id),
          eq(translationJobs.status, 'running'), eq(translationJobs.startedAt, job.startedAt),
          staleBefore ? sql`${translationJobs.nextAttemptAt} < ${staleBefore}` : undefined)).returning({ id: translationJobs.id })
      return changed.length > 0
    })
  }

  /** نجات jobهای گیر‌کرده (کرش وسط اجرا) — runningِ کهنه → pending */
  async reapStuck(stuckMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - stuckMs)
    const rows = await this.deps.db.select().from(translationJobs)
      .where(and(eq(translationJobs.status, 'running'), sql`${translationJobs.startedAt} < ${cutoff}`, sql`${translationJobs.nextAttemptAt} < ${cutoff}`))
    let reaped = 0
    for (const row of rows) if (await this.returnToPending({ ...row, startedAt: row.startedAt ?? new Date(), entityType: row.entityType as TranslationEntityType }, {
      nextAttemptAt: new Date(), lastError: 'Recovered an interrupted translation job.',
    }, cutoff)) reaped++
    return reaped
  }

  /**
   * پردازش یک job. خروجی برای حلقه‌ی worker:
   * 'empty' صف خالی | 'done' موفق | 'failed' شکست (تلاش مجدد یا نهایی) |
   * 'translator-down' مترجم در دسترس نبود — حلقه را می‌بندد
   */
  async processNext(): Promise<'empty' | 'done' | 'failed' | 'translator-down'> {
    const job = await this.claim()
    if (!job) return 'empty'
    let heartbeatPending = false
    const heartbeat = setInterval(() => {
      if (heartbeatPending) return
      heartbeatPending = true
      void this.deps.db.update(translationJobs).set({ nextAttemptAt: new Date() }).where(and(
        eq(translationJobs.id, job.id), eq(translationJobs.status, 'running'), eq(translationJobs.startedAt, job.startedAt),
      )).catch(error => console.error('[translate] queue heartbeat failed', error)).finally(() => { heartbeatPending = false })
    }, 30_000)
    heartbeat.unref()
    try {
      const note = await this.runJob(job)
      await this.deps.db
        .update(translationJobs)
        .set({ status: 'done', finishedAt: new Date(), lastError: note })
        .where(and(eq(translationJobs.id, job.id), eq(translationJobs.status, 'running'), eq(translationJobs.startedAt, job.startedAt)))
      return 'done'
    } catch (err) {
      // مترجم پایین — تلاش را برمی‌گردانیم؛ صف بعداً خودش دوباره می‌آید
      if (err instanceof AppError && err.code === 'SERVICE_UNAVAILABLE') {
        await this.returnToPending(job, { attempts: Math.max(job.attempts - 1, 0),
          nextAttemptAt: new Date(Date.now() + 5 * 60_000), lastError: 'Translator unavailable; retry in five minutes.' })
        return 'translator-down'
      }
      const msg = (err instanceof Error ? err.message : String(err)).slice(0, 500)
      if (job.attempts >= job.maxAttempts) {
        await this.deps.db
          .update(translationJobs)
          .set({ status: 'failed', lastError: msg, finishedAt: new Date() })
          .where(and(eq(translationJobs.id, job.id), eq(translationJobs.status, 'running'), eq(translationJobs.startedAt, job.startedAt)))
        console.error(`[translate] job ${job.entityType}/${job.entityId} نهایتاً شکست خورد:`, msg)
        return 'failed'
      }
      // backoff تصاعدی: ~۳۰s بعد تلاش اول، ~۱۲۰s بعد دومی
      const backoffMs = 30_000 * job.attempts * job.attempts
      await this.returnToPending(job, { lastError: msg, nextAttemptAt: new Date(Date.now() + backoffMs) })
      return 'failed'
    } finally {
      clearInterval(heartbeat)
    }
  }

  async previewField(input: Parameters<ContentTranslationWorker['previewField']>[0]) { return this.fields.previewField(input) }

  private async runJob(job: ClaimedJob): Promise<string | null> {
    const isActive = async (tx?: DbOrTx) => {
      const query = (tx ?? this.deps.db).select({ id: translationJobs.id }).from(translationJobs).where(and(
        eq(translationJobs.id, job.id), eq(translationJobs.status, 'running'), eq(translationJobs.startedAt, job.startedAt),
      ))
      return (tx ? await query.for('share') : await query).length > 0
    }
    await this.fields.run(job.entityType, job.entityId, isActive)
    if (!await isActive()) return null
    if (job.entityType === 'product') {
      const sizes = await this.deps.db.select({ id: productSizes.id }).from(productSizes).where(eq(productSizes.productId, asProductId(job.entityId)))
      for (const size of sizes) {
        const row = await readContentRow(this.deps.db, 'productSize', size.id)
        if (row && this.fields.hasEligibleFields('productSize', row)) await this.enqueue('productSize', size.id)
      }
    }
    const row = await readContentRow(this.deps.db, job.entityType, job.entityId)
    if (row && this.fields.hasEligibleFields(job.entityType, row)) await this.enqueue(job.entityType, job.entityId)
    return null
  }
  // ═══════════════════════ صف‌گذاری / دسته‌ای / وضعیت / کارها ═══════════════════════

  /** افزودن یک موجودیت به صف (dedupe روی pending) */
  async enqueue(entityType: TranslationEntityType, entityId: string): Promise<{ queued: boolean }> {
    if (!TRANSLATION_ENTITY_TYPES.includes(entityType)) {
      throw Err.validation('نوع موجودیت قابل‌ترجمه نیست.')
    }
    let id = entityId.trim()
    if (id === '') throw Err.validation('شناسه‌ی موجودیت خالی است.')
    if (entityType === 'about') id = '1'
    if (entityType !== 'about' && entityType !== 'temporaryClose' && id !== 'latest') id = id.toLowerCase()
    if (entityType === 'terms' && id === 'latest') {
      const [row] = await this.deps.db
        .select({ id: terms.id })
        .from(terms)
        .orderBy(desc(terms.version))
        .limit(1)
      if (!row) return { queued: false }
      id = row.id
    }
    if (!await readContentRow(this.deps.db, entityType, id)) throw Err.notFound('Translation content not found.')
    return this.deps.db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(73401926)`)
      const existing = await tx
        .select({ id: translationJobs.id })
        .from(translationJobs)
        .where(
          and(
            eq(translationJobs.entityType, entityType),
          sql`lower(${translationJobs.entityId}) = ${id.toLowerCase()}`,
            eq(translationJobs.status, 'pending'),
          ),
        )
        .limit(1)
      if (existing.length > 0) return { queued: false }
      try {
        await tx.insert(translationJobs).values({ entityType, entityId: id })
        return { queued: true }
      } catch (e) {
        if (isUniqueViolation(e)) return { queued: false }
        throw e
      }
    })
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
      const rows = await this.deps.db.transaction(async tx => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(73401926)`)
        const pending = await tx.select({ entityId: translationJobs.entityId }).from(translationJobs).where(and(
          eq(translationJobs.entityType, t), eq(translationJobs.status, 'pending'), inArray(sql`lower(${translationJobs.entityId})`, ids.map(id => id.toLowerCase())),
        ))
        const existing = new Set(pending.map(row => row.entityId.toLowerCase()))
        const remaining = ids.filter(id => !existing.has(id.toLowerCase()))
        if (remaining.length === 0) return []
        return tx.insert(translationJobs)
        .values(remaining.map((id) => ({ entityType: t, entityId: id })))
        .onConflictDoNothing()
        .returning({ id: translationJobs.id })
      })
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
    // رارد ۴۸ (اسکن C6) — شمارنده‌های مستقل موازی شدند؛ این مسیر با پول ۵
    // ثانیه‌ای پنل ترجمه گرم می‌شود و قبلاً ~۹ رفت‌وبرگشت متوالی DB داشت.
    const [missingEntries, lastRow, health] = await Promise.all([
      Promise.all(
        TRANSLATION_ENTITY_TYPES.map(async (t) => [t, await this.missingCount(t)] as const),
      ),
      this.deps.db
        .select({ last: max(translationJobs.finishedAt) })
        .from(translationJobs)
        .then((rows) => rows[0]),
      this.cachedHealth(),
    ])
    const missing: Partial<Record<TranslationEntityType, number>> = {}
    for (const [t, n] of missingEntries) {
      if (n > 0) missing[t] = n
    }
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

  private async missingIds(type: TranslationEntityType, limit = BULK_CAP_PER_TYPE): Promise<string[]> {
    const missing: string[] = []
    for (let offset = 0; ; offset += 250) {
      const rows = await contentRows(this.deps.db, type, 250, offset)
      for (const row of rows) {
        if (this.fields.hasEligibleFields(type, row)) missing.push(String(row.id))
        if (missing.length >= limit) return missing
      }
      if (rows.length < 250) break
    }
    return missing
  }

  private async missingCount(type: TranslationEntityType): Promise<number> { return (await this.missingIds(type, Number.POSITIVE_INFINITY)).length }

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
