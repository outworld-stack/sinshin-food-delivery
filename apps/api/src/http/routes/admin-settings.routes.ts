// src/http/routes/admin-settings.routes.ts
import { Elysia, t } from 'elysia'
import type { SessionService } from '#/domain/auth/session.service'
import type { Admin2Service } from '#/domain/admin2/admin2.service'
import type { DeliveryZoneService } from '#/domain/delivery/delivery-zone.service'
import type { SettingsService } from '#/domain/settings/settings.service'
import type { AuditService } from '#/domain/audit/audit.service'
import { SETTING_KEYS } from '#/infra/db/schema'
import { requireAdmin } from '#/http/hooks/require-auth'
import { requireAdmin2 } from '#/http/hooks/require-admin2'

export interface AdminSettingsRoutesDeps {
  sessions: SessionService
  zones: DeliveryZoneService
  settings: SettingsService
  admin2: Admin2Service
  /** stage-10: لاگ ممیزی — تغییرات پولی/سراسری ادمین اصلی */
  audit: AuditService
}

export const adminSettingsRoutes = (deps: AdminSettingsRoutesDeps) => {
  // ══ خواندن + عملیاتِ permission-دار — ادمین اصلی + ادمین۲ فعال ══
  // (temporary-close: permission داخل service چک می‌شود)
  // stage-10: packaging-fee حذف شد — بسته‌بندی per-product در فرم محصول است.
  const shared = new Elysia({ prefix: '/admin/settings', tags: ['Admin / Settings'] })
    .use(requireAdmin2({ sessions: deps.sessions, admin2: deps.admin2 }))

    .get(
      '/delivery-zones',
      async () => ({
        zones: await deps.zones.list(),
        // round-13 — مبدأ واقعی محاسبه‌ی فاصله (env > تنظیمات > پیش‌فرض) برای نمایش در پنل
        origin: await deps.settings.restaurantLocation(),
      }),
      { detail: { summary: 'Delivery zones (radius-sorted) + restaurant origin coords' } },
    )
    .get('/restaurant', () => deps.settings.restaurantOpen(), {
      detail: { summary: 'Open status + next open time' },
    })
    .get(
      '/restaurant/status',
      () => deps.settings.restaurantStatus(),
      { detail: { summary: 'Full status — schedule + temporary' } },
    )
    .post(
      '/temporary-close',
      async ({ user, body }) => {
        await deps.admin2.setTemporaryClose(user.id, user.role, body.closed, body.reason)
        // round-13 — ممیزی برای هر دو نقش (قبلاً ادمین اصلی هیچ ردی نداشت)
        await deps.audit.log({
          actorId: user.id,
          action: body.closed ? 'TEMP_CLOSE' : 'TEMP_OPEN',
          entity: 'settings',
          metadata: { closed: body.closed, reason: body.reason },
        })
        return { success: true }
      },
      {
        body: t.Object({
          closed: t.Boolean(),
          /** round-13 — علت برای بستن «و» باز کردن اجباری است (به مشتری در چک‌اوت نمایش داده می‌شود) */
          reason: t.String({ minLength: 3, maxLength: 120 }),
        }),
        detail: {
          summary: 'Temporary close/open — reason REQUIRED (shown to customers)',
          description:
            'Admin always allowed. Level-2 with canToggleTemporaryClose allowed. Reason (3-120 chars) is required for BOTH closing and opening; customers see it in the checkout order-summary box. Same rules as schedule-close (orders queue), but level-2 login stays allowed.',
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
      async ({ body, user }) => {
        await deps.zones.add(body.radiusKm, body.fee)
        await deps.audit.log({
          actorId: user.id,
          action: 'ZONE_ADD',
          entity: 'delivery-zone',
          metadata: { radiusKm: body.radiusKm, fee: body.fee },
        })
        return { success: true }
      },
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
      async ({ body, user }) => {
        await deps.zones.remove(body.radiusKm)
        await deps.audit.log({
          actorId: user.id,
          action: 'ZONE_REMOVE',
          entity: 'delivery-zone',
          metadata: { radiusKm: body.radiusKm },
        })
        return { success: true }
      },
      {
        body: t.Object({ radiusKm: t.Number({ minimum: 0.5, maximum: 500 }) }),
        detail: { summary: 'Remove zone (last one is kept) — main admin only' },
      },
    )
    // round-13 — ویرایش ناحیه (شعاع + هزینه) — فقط ادمین اصلی
    .post(
      '/delivery-zones/update',
      async ({ body, user }) => {
        const res = await deps.zones.update(body.radiusKm, body.newRadiusKm, body.fee)
        if (!res.success) return res
        await deps.audit.log({
          actorId: user.id,
          action: 'ZONE_UPDATE',
          entity: 'delivery-zone',
          metadata: {
            radiusKm: body.radiusKm,
            newRadiusKm: body.newRadiusKm,
            fee: body.fee,
          },
        })
        return res
      },
      {
        body: t.Object({
          radiusKm: t.Number({ minimum: 0.5, maximum: 500 }),
          newRadiusKm: t.Number({ minimum: 0.5, maximum: 500 }),
          fee: t.Number({ minimum: 0 }),
        }),
        detail: {
          summary: 'Update zone radius/fee (duplicate radius rejected) — main admin only',
        },
      },
    )
    .post(
      '/restaurant',
      async ({ body, user }) => {
        await deps.settings.set('restaurant_open', body.isOpen)
        if (body.nextOpenTime) await deps.settings.set('next_open_time', body.nextOpenTime)
        await deps.audit.log({
          actorId: user.id,
          action: 'RESTAURANT_SCHEDULE',
          entity: 'settings',
          metadata: { isOpen: body.isOpen, nextOpenTime: body.nextOpenTime ?? null },
        })
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
    .get(
      '/live-tracking',
      async () => ({ enabled: await deps.settings.liveTrackingEnabled() }),
      { detail: { summary: 'Live-tracking flag (default: off) — main admin only' } },
    )
    .post(
      '/live-tracking',
      async ({ body, user }) => {
        await deps.settings.set('live_tracking_enabled', body.enabled)
        await deps.audit.log({
          actorId: user.id,
          action: 'LIVE_TRACKING_TOGGLE',
          entity: 'settings',
          metadata: { enabled: body.enabled },
        })
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
    // phase-fix — محدودیت دسترسی «فقط ایران» — پیش‌فرض روشن
    .get(
      '/iran-only',
      async () => ({
        enabled: await deps.settings.get<boolean>(SETTING_KEYS.iranOnlyAccess, true),
      }),
      { detail: { summary: 'Iran-only access flag (default: on) — main admin only' } },
    )
    .post(
      '/iran-only',
      async ({ body, user }) => {
        await deps.settings.set(SETTING_KEYS.iranOnlyAccess, body.enabled)
        await deps.audit.log({
          actorId: user.id,
          action: 'IRAN_ONLY_TOGGLE',
          entity: 'settings',
          metadata: { enabled: body.enabled },
        })
        return { success: true }
      },
      {
        body: t.Object({ enabled: t.Boolean() }),
        detail: {
          summary: 'Toggle Iran-only access — main admin only',
          description:
            'When ON, non-Iranian IPs get 404 (site + API). Effective within ~15s (cached). Admins abroad/VPN: set GEO_BYPASS_IPS in env.',
        },
      },
    )

  return new Elysia().use(shared).use(ownerOnly)
}