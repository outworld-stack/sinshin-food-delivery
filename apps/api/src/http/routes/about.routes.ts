import type { AboutLocationDto, ArticleBlocksDoc } from '@sinshin/shared'
import { Elysia, t } from 'elysia'
import { normalizeBlocksDoc } from '#/domain/article/blocks-normalize'
import type { SessionService } from '#/domain/auth/session.service'
import type { SettingsService } from '#/domain/settings/settings.service'
import { Err } from '#/domain/shared/errors'
import { langFromHeaders, nullIfEmpty, pickAr } from '#/domain/shared/lang'
import { requireAdmin } from '#/http/hooks/require-auth'
import type { Db } from '#/infra/db/client'
import { contentAbout } from '#/infra/db/schema'

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
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > 262_144) {
    throw Err.validation('حجم هر بخش محتوای درباره ما نباید بیشتر از ۲۵۶ کیلوبایت باشد.')
  }
  return normalizeBlocksDoc(input)
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
}

export const aboutRoutes = (deps: AboutRoutesDeps) => {
  const readContent = async () => {
    const row = (await deps.db.select().from(contentAbout).limit(1))[0] ?? emptyContent
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
      const location = row.location ?? await readDefaultLocation()
      return {
        ...row,
        heroTitle: pickAr(lang, row.heroTitleAr, row.heroTitle),
        heroText: pickAr(lang, row.heroTextAr, row.heroText),
        teamTitle: pickAr(lang, row.teamTitleAr, row.teamTitle),
        teamAlt: pickAr(lang, row.teamAltAr, row.teamAlt),
        blocks: lang === 'ar' ? row.blocksAr ?? row.blocks : row.blocks,
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
      const [row, defaultLocation] = await Promise.all([readContent(), readDefaultLocation()])
      return { ...row, defaultLocation }
    }, { detail: { summary: 'Original About content (main admin)' } })
    .patch('/', async ({ body }) => {
      const heroTitle = body.heroTitle.trim()
      if (!heroTitle) throw Err.validation('عنوان اصلی درباره ما را وارد کنید.')
      const patch = {
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
        ...(body.blocks !== undefined ? { blocks: normalizeAboutBlocks(body.blocks) } : {}),
        ...(body.blocksAr !== undefined ? { blocksAr: normalizeAboutBlocks(body.blocksAr) } : {}),
        ...(body.location !== undefined ? { location: body.location === null ? null : {
          lat: body.location.lat,
          lng: body.location.lng,
          address: body.location.address.trim(),
          addressAr: nullIfEmpty(body.location.addressAr),
        } } : {}),
        arAuto: false,
        updatedAt: new Date(),
      }
      const existing = (await deps.db.select({ id: contentAbout.id }).from(contentAbout).limit(1))[0]
      await deps.db.insert(contentAbout).values({ id: existing?.id ?? 1, ...patch })
        .onConflictDoUpdate({ target: contentAbout.id, set: patch })
      return { success: true }
    }, {
      body: t.Object({
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
        blocksAr: t.Optional(blocksDocSchema),
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
