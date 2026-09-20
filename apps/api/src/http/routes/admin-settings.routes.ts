// src/http/routes/admin-settings.routes.ts
import { Elysia, t } from 'elysia'
import type { SessionService } from '#/domain/auth/session.service'
import type { Admin2Service } from '#/domain/admin2/admin2.service'
import type { DeliveryZoneService } from '#/domain/delivery/delivery-zone.service'
import type { SettingsService } from '#/domain/settings/settings.service'
import { requireAdmin } from '#/http/hooks/require-auth'
import { requireAdmin2 } from '#/http/hooks/require-admin2'

export interface AdminSettingsRoutesDeps {
  sessions: SessionService
  zones: DeliveryZoneService
  settings: SettingsService
  admin2: Admin2Service
}

export const adminSettingsRoutes = (deps: AdminSettingsRoutesDeps) => {
  // ══ خواندن + عملیاتِ permission-دار — ادمین اصلی + ادمین۲ فعال ══
  // (temporary-close و packaging-fee: permission شان داخل service چک می‌شود)
  const shared = new Elysia({ prefix: '/admin/settings', tags: ['Admin / Settings'] })
    .use(requireAdmin2({ sessions: deps.sessions, admin2: deps.admin2 }))

    .get('/delivery-zones', async () => ({ zones: await deps.zones.list() }), {
      detail: { summary: 'Delivery zones sorted by radius' },
    })
    .get('/restaurant', () => deps.settings.restaurantOpen(), {
      detail: { summary: 'Open status + next open time' },
    })
    .get(
      '/restaurant/status',
      () => deps.settings.restaurantStatus(),
      { detail: { summary: 'Full status — schedule + temporary' } },
    )
    .get('/packaging-fee', () => deps.settings.packagingFee(), {
      detail: { summary: 'Current packaging fee (PICKUP)' },
    })
    .post(
      '/temporary-close',
      async ({ user, body }) => {
        await deps.admin2.setTemporaryClose(user.id, user.role, body.closed, body.reason ?? null)
        return { success: true }
      },
      {
        body: t.Object({
          closed: t.Boolean(),
          reason: t.Optional(t.Nullable(t.String({ maxLength: 120 }))),
        }),
        detail: {
          summary: 'Temporary close/open (gas/power outages...)',
          description:
            'Admin always allowed. Level-2 with canToggleTemporaryClose allowed. Users: same rules as schedule-close (orders queue), but level-2 login stays allowed.',
        },
      },
    )
    .post(
      '/packaging-fee',
      async ({ user, body }) => {
        await deps.admin2.setPackagingFee(user.id, user.role, body.fee)
        return { success: true }
      },
      {
        body: t.Object({ fee: t.Number({ minimum: 0, maximum: 1000000 }) }),
        detail: {
          summary: 'Set packaging fee',
          description: 'Admin always. Level-2 with canEditPackagingFee (activity logged).',
        },
      },
    )

  // ══ phase-1: تنظیمات سراسری/پولی — فقط ادمین اصلی ══
  // قبلاً هر admin2 می‌توانست: ساعات کاری را ببند/باز کند، ناحیه‌های
  // ارسال (قیمت ارسال!) را تغییر دهد، ردیابی سراسری را toggle کند.
  // (دو instance جدا — .use وسط زنجیره به روت‌های بعدی نشت می‌کند)
  const ownerOnly = new Elysia({ prefix: '/admin/settings', tags: ['Admin / Settings'] })
    .use(requireAdmin(deps.sessions))

    .post(
      '/delivery-zones',
      ({ body }) => deps.zones.add(body.radiusKm, body.fee),
      {
        body: t.Object({
          radiusKm: t.Number({ minimum: 0.5, maximum: 500 }),
          fee: t.Number({ minimum: 0 }),
        }),
        detail: { summary: 'Add delivery zone (duplicate radius rejected) — main admin only' },
      },
    )
    .post(
      '/delivery-zones/remove',
      ({ body }) => deps.zones.remove(body.radiusKm),
      {
        body: t.Object({ radiusKm: t.Number({ minimum: 0.5, maximum: 500 }) }),
        detail: { summary: 'Remove zone (last one is kept) — main admin only' },
      },
    )
    .post(
      '/restaurant',
      async ({ body }) => {
        await deps.settings.set('restaurant_open', body.isOpen)
        if (body.nextOpenTime) await deps.settings.set('next_open_time', body.nextOpenTime)
        return { success: true }
      },
      {
        body: t.Object({
          isOpen: t.Boolean(),
          nextOpenTime: t.Optional(t.String({ maxLength: 40 })),
        }),
        detail: { summary: 'Set restaurant schedule — main admin only' },
      },
    )
    .post(
      '/live-tracking',
      async ({ body }) => {
        await deps.settings.set('live_tracking_enabled', body.enabled)
        return { success: true }
      },
      {
        body: t.Object({ enabled: t.Boolean() }),
        detail: {
          summary: 'Enable/disable courier live tracking — main admin only',
          description:
            'Orders created BEFORE enabling never track (per-order snapshot at checkout).',
        },
      },
    )

  return new Elysia().use(shared).use(ownerOnly)
}