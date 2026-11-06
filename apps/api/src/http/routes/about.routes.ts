import { articleBlocksContentForLimit, assertContentSourceRevision, contentSourceRevision, getArticleBlockTextFields, localizeContentRecord, mergeArticleBlocksTranslation, normalizeArticleBlocksTranslation, reconcileArticleBlocksTranslation, reconcileContentTranslation, setArticleBlockTranslations, validateArticleBlockItemIdentities, type AboutLocationDto, type ArticleBlocksDoc } from '@sinshin/shared'
import { isDeepStrictEqual } from 'node:util'
import { eq, sql } from 'drizzle-orm'
import { Elysia, t } from 'elysia'
import { normalizeBlocksDoc } from '#/domain/article/blocks-normalize'
import type { SessionService } from '#/domain/auth/session.service'
import type { SettingsService } from '#/domain/settings/settings.service'
import { Err } from '#/domain/shared/errors'
import { langFromHeaders, nullIfEmpty, pickAr } from '#/domain/shared/lang'
import { requireAdmin } from '#/http/hooks/require-auth'
import type { Db } from '#/infra/db/client'
import { contentAbout } from '#/infra/db/schema'
import { blocksArDocSchema } from './articles.routes'
import { contentSourceRevisionSchema, translationEditsSchema } from './content-translation.schemas'

export interface AboutRoutesDeps {
  db: Db
  sessions: SessionService
  settings: Pick<SettingsService, 'restaurantLocation'>
}

// The existing article normalizer validates each block's props, URLs and styles.
// Bound the envelope and the raw UTF-8 input before normalization as well.
const blocksDocSchema = t.Nullable(t.Object({
  version: t.Literal(1),
  blocks: t.Array(t.Object({
    id: t.Optional(t.String({ maxLength: 64 })),
    type: t.String({ minLength: 1, maxLength: 40 }),
    props: t.Optional(t.Record(t.String(), t.Unknown())),
    width: t.Optional(t.String({ maxLength: 10 })),
    anim: t.Optional(t.String({ maxLength: 20 })),
    style: t.Optional(t.Record(t.String(), t.Unknown())),
  }), { maxItems: 200 }),
}))

function normalizeAboutBlocks(input: unknown): ArticleBlocksDoc | null {
  if (Buffer.byteLength(JSON.stringify(articleBlocksContentForLimit(input)), 'utf8') > 262_144) {
    throw Err.validation('حجم هر بخش محتوای درباره ما نباید بیشتر از ۲۵۶ کیلوبایت باشد.')
  }
  return normalizeBlocksDoc(input)
}

function normalizeAboutArabicBlocks(source: ArticleBlocksDoc | null, input: unknown): ArticleBlocksDoc | null {
  if (input == null) return null
  if (Buffer.byteLength(JSON.stringify(articleBlocksContentForLimit(input)), 'utf8') > 2_097_152) throw Err.validation('حجم سند ترجمه درباره ما بیش از حد مجاز است.')
  const out = normalizeArticleBlocksTranslation(source, input)
  if (out && Buffer.byteLength(JSON.stringify(articleBlocksContentForLimit({ version: out.version, blocks: out.blocks })), 'utf8') > 262_144) {
    throw Err.validation('حجم ترجمه بلوکی درباره ما نباید بیشتر از ۲۵۶ کیلوبایت باشد.')
  }
  return out
}

function validCoordinates(value: unknown): value is { lat: number; lng: number } {
  if (!value || typeof value !== 'object') return false
  const point = value as { lat?: unknown; lng?: unknown }
  return typeof point.lat === 'number' && Number.isFinite(point.lat)
    && point.lat >= -90 && point.lat <= 90
    && typeof point.lng === 'number' && Number.isFinite(point.lng)
    && point.lng >= -180 && point.lng <= 180
}

const emptyContent: typeof contentAbout.$inferSelect = {
  id: 1,
  heroTitle: 'درباره سین شین',
  heroText: '',
  heroGradient: '',
  teamTitle: '',
  teamGradient: '',
  teamAlt: '',
  heroTitleAr: null,
  heroTextAr: null,
  teamTitleAr: null,
  teamAltAr: null,
  blocks: null,
  blocksAr: null,
  location: null,
  arAuto: false,
  updatedAt: new Date(0),
  translationState: null,
}

export const aboutRoutes = (deps: AboutRoutesDeps) => {
  const readStoredContent = async () => (await deps.db.select().from(contentAbout).limit(1))[0] ?? emptyContent
  const readContent = async () => {
    const row = await readStoredContent()
    return { ...row, location: validCoordinates(row.location) ? row.location : null }
  }

  const readDefaultLocation = async (): Promise<AboutLocationDto | null> => {
    const configured = await deps.settings.restaurantLocation()
    return validCoordinates(configured)
      ? { lat: configured.lat, lng: configured.lng, address: '', addressAr: null }
      : null
  }

  const publicRoutes = new Elysia({ prefix: '/about', tags: ['About'] })
    .get('/', async ({ headers }) => {
      const lang = langFromHeaders(headers)
      const row = await readContent()
      const valid = lang === 'ar' ? localizeContentRecord('about', row) : row
      const { translationState: _state, blocksAr: _arabicDocument, ...publicRow } = valid
      const location = valid.location ?? await readDefaultLocation()
      return {
        ...publicRow,
        heroTitle: pickAr(lang, valid.heroTitleAr, valid.heroTitle),
        heroText: pickAr(lang, valid.heroTextAr, valid.heroText),
        teamTitle: pickAr(lang, valid.teamTitleAr, valid.teamTitle),
        teamAlt: pickAr(lang, valid.teamAltAr, valid.teamAlt),
        blocks: lang === 'ar' ? mergeArticleBlocksTranslation(row.blocks, row.blocksAr) : row.blocks,
        location: location ? {
          ...location,
          address: pickAr(lang, location.addressAr, location.address),
        } : null,
      }
    }, { detail: { summary: 'Localized About page and restaurant destination' } })

  const adminRoutes = new Elysia({ prefix: '/admin/about', tags: ['Admin / About'] })
    .use(requireAdmin(deps.sessions))
    // Never feed localized public text back into the Persian editor fields.
    // Keep the stored override separate so unrelated edits do not freeze the default.
    .get('/', async () => {
      const [row, defaultLocation] = await Promise.all([readStoredContent(), readDefaultLocation()])
      return { ...row, location: validCoordinates(row.location) ? row.location : null,
        defaultLocation, sourceRevision: contentSourceRevision('about', row) }
    }, { detail: { summary: 'Original About content (main admin)' } })
    .patch('/', async ({ body }) => {
      const heroTitle = body.heroTitle.trim()
      if (!heroTitle) throw Err.validation('عنوان اصلی درباره ما را وارد کنید.')
      await deps.db.transaction(async tx => {
        // Serialize singleton creation as well as later saves; worker writes lock this row.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('content:about'))`)
        const [existing] = await tx.select().from(contentAbout).limit(1).for('update')
        const current = existing ?? emptyContent
        if (existing && !assertContentSourceRevision('about', current, body.sourceRevision)) throw Err.validation('محتوای درباره ما تغییر کرده است؛ فرم را دوباره بارگذاری کنید.')
        if (body.blocks !== undefined && !validateArticleBlockItemIdentities(existing?.blocks ?? null, body.blocks, existing?.blocksAr)) {
          throw Err.validation('شناسه آیتم‌های بلوک معتبر نیست؛ فرم را دوباره بارگذاری کنید.')
        }
        const blocks = body.blocks === undefined || isDeepStrictEqual(body.blocks, current.blocks)
          ? current.blocks : normalizeAboutBlocks(body.blocks)
        const blocksAr = body.blocksAr !== undefined || blocks !== current.blocks
          ? normalizeAboutArabicBlocks(blocks, body.blocksAr === null ? setArticleBlockTranslations(blocks, current.blocksAr,
            (blocks?.blocks ?? []).flatMap(block => getArticleBlockTextFields(block).map(field => ({ blockId: block.id, path: field.path, text: '' }))), 'manual') : reconcileArticleBlocksTranslation(
            current.blocks, blocks, current.blocksAr, body.blocksAr,
          )) : current.blocksAr
        const next = reconcileContentTranslation('about', String(current.id), existing ?? null, {
        ...current,
        heroTitle,
        heroText: body.heroText.trim(),
        heroGradient: body.heroGradient.trim(),
        teamTitle: body.teamTitle.trim(),
        teamGradient: body.teamGradient.trim(),
        teamAlt: body.teamAlt.trim(),
        ...(body.heroTitleAr !== undefined ? { heroTitleAr: nullIfEmpty(body.heroTitleAr) } : {}),
        ...(body.heroTextAr !== undefined ? { heroTextAr: nullIfEmpty(body.heroTextAr) } : {}),
        ...(body.teamTitleAr !== undefined ? { teamTitleAr: nullIfEmpty(body.teamTitleAr) } : {}),
        ...(body.teamAltAr !== undefined ? { teamAltAr: nullIfEmpty(body.teamAltAr) } : {}),
        blocks,
        blocksAr,
        ...(body.location !== undefined ? { location: body.location === null ? null : {
          lat: body.location.lat,
          lng: body.location.lng,
          address: body.location.address.trim(),
          addressAr: body.location.addressAr === undefined ? current.location?.addressAr ?? null : nullIfEmpty(body.location.addressAr),
        } } : {}),
        arAuto: false,
        updatedAt: new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1)),
      }, body.translationEdits)
      if (existing) await tx.update(contentAbout).set(next).where(eq(contentAbout.id, existing.id))
      else await tx.insert(contentAbout).values(next)
      })
      return { success: true }
    }, {
      body: t.Object({
        sourceRevision: t.Optional(contentSourceRevisionSchema),
        heroTitle: t.String({ minLength: 1, maxLength: 120 }),
        heroText: t.String({ maxLength: 2000 }),
        heroGradient: t.String({ maxLength: 2048 }),
        teamTitle: t.String({ maxLength: 120 }),
        teamGradient: t.String({ maxLength: 2048 }),
        teamAlt: t.String({ maxLength: 200 }),
        heroTitleAr: t.Optional(t.Nullable(t.String({ maxLength: 120 }))),
        heroTextAr: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
        teamTitleAr: t.Optional(t.Nullable(t.String({ maxLength: 120 }))),
        teamAltAr: t.Optional(t.Nullable(t.String({ maxLength: 200 }))),
        blocks: t.Optional(blocksDocSchema),
        blocksAr: t.Optional(blocksArDocSchema),
        translationEdits: t.Optional(translationEditsSchema),
        location: t.Optional(t.Nullable(t.Object({
          lat: t.Number({ minimum: -90, maximum: 90 }),
          lng: t.Number({ minimum: -180, maximum: 180 }),
          address: t.String({ maxLength: 500 }),
          addressAr: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
        }))),
      }),
      detail: { summary: 'Save, add or remove About content (main admin)' },
    })

  return new Elysia().use(publicRoutes).use(adminRoutes)
}
