// ═══════════════════════════════════════════════════════════════
// round-37 — sinshin-food-delivery — فایل 5 از 17
// مسیر مقصد: apps/api/src/http/routes/admin-settings.routes.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty-three
// ═══════════════════════════════════════════════════════════════

// src/http/routes/admin-settings.routes.ts
import { Elysia, t } from 'elysia'
import type { SessionService } from '#/domain/auth/session.service'
import type { Admin2Service } from '#/domain/admin2/admin2.service'
import type { DeliveryZoneService } from '#/domain/delivery/delivery-zone.service'
import type { SettingsService } from '#/domain/settings/settings.service'
import type { AuditService } from '#/domain/audit/audit.service'
import type { RegistrationPermitService } from '#/domain/auth/registration-permit.service'
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
  /** stage-79 — مجوز ثبت‌نام ویژه (فقط ادمین اصلی) */
  permits: RegistrationPermitService
}

export const adminSettingsRoutes = (deps: AdminSettingsRoutesDeps) => {
  // ══ خواندن + عملیاتِ مجوزدار — ادمین اصلی + ادمین۲ فعال ══
  // (temporary-close: مجوز داخل سرویس چک می‌شود)
  // stage-10: packaging-fee حذف شد — بسته‌بندی هر محصول در فرم محصول است.
  const shared = new Elysia({ prefix: '/admin/settings', tags: ['Admin / Settings'] })
    .use(requireAdmin2({ sessions: deps.sessions, admin2: deps.admin2 }))

    .get(
      '/delivery-zones',
      async () => ({
        zones: await deps.zones.list(),
        fallbackFee: await deps.zones.fallbackFee(),
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
      { detail: { summary: 'Full status — schedule + temporary + busy' } },
    )
    // stage-84 — اعلام وضعیت «شلوغ» (ادمین اصلی + ادمین۲ با canAnnounceBusy؛
    // مجوز داخل سرویس چک می‌شود — الگوی temporary-close). شلوغی فقط
    // اطلاع‌رسانی است: سفارش‌دهی آزاد می‌ماند و سرو در محل یادداشت می‌خواهد.
    .post(
      '/busy',
      async ({ user, body }) => {
        await deps.admin2.setBusy(user.id, user.role, body.busy)
        await deps.audit.log({
          actorId: user.id,
          action: body.busy ? 'BUSY_ON' : 'BUSY_OFF',
          entity: 'settings',
          metadata: { busy: body.busy },
        })
        return { success: true }
      },
      {
        body: t.Object({ busy: t.Boolean() }),
        detail: {
          summary: 'Announce restaurant busy status (main admin or level-2 with canAnnounceBusy)',
          description:
            'stage-84: busy is informational only — ordering stays open. In checkout, DINE_IN orders require the customer note (name + table number) while busy. Mirrors temporary-close permission model.',
        },
      },
    )
    .post(
      '/temporary-close',
      async ({ user, body }) => {
        await deps.admin2.setTemporaryClose(
          user.id,
          user.role,
          body.closed,
          body.reason,
          body.reopenTime ?? null,
          // round-34 — علت عربی (اختیاری؛ خالی = همان فارسی در حالت عربی چک‌اوت)
          body.reasonAr ?? null,
        )
        // round-13 — ممیزی برای هر دو نقش (قبلاً ادمین اصلی هیچ ردی نداشت)
        await deps.audit.log({
          actorId: user.id,
          action: body.closed ? 'TEMP_CLOSE' : 'TEMP_OPEN',
          entity: 'settings',
          metadata: {
            closed: body.closed,
            reason: body.reason,
            reopenTime: body.reopenTime ?? null,
            reasonAr: body.reasonAr ?? null,
          },
        })
        return { success: true }
      },
      {
        body: t.Object({
          closed: t.Boolean(),
          /** round-13 — علت برای بستن «و» باز کردن اجباری است (به مشتری در چک‌اوت نمایش داده می‌شود) */
          reason: t.String({ minLength: 3, maxLength: 120 }),
          /** round-29 — زمان باز شدن مجدد (اختیاری؛ فقط هنگام بستن معنا دارد) — در چک‌اوت به‌جای ساعت کاری اصلی نمایش داده می‌شود */
          reopenTime: t.Optional(t.String({ maxLength: 40 })),
          /** round-34 — علت عربی (اختیاری؛ خالی = حذف ترجمه = پشتیبان فارسی) */
          reasonAr: t.Optional(t.Nullable(t.String({ maxLength: 120 }))),
        }),
        detail: {
          summary: 'Temporary close/open — reason REQUIRED (shown to customers)',
          description:
            'Admin always allowed. Level-2 with canToggleTemporaryClose allowed. Reason (3-120 chars) is required for BOTH closing and opening; customers see it in the checkout order-summary box. reopenTime (optional, closing only) replaces the scheduled next-open time shown to customers while temporarily closed. Same rules as schedule-close (orders queue), but level-2 login stays allowed. round-34: reasonAr is the Arabic reason shown when x-sinshin-lang: ar.',
        },
      },
    )

  // ══ phase-1: تنظیمات سراسری/پولی — فقط ادمین اصلی ══
  // قبلاً هر admin2 می‌توانست: ساعات کاری را ببند/باز کند، ناحیه‌های
  // ارسال (قیمت ارسال!) را تغییر دهد، ردیابی سراسری را تغییر وضعیت دهد.
  // (دو نمونه‌ی جدا — .use وسط زنجیره به روت‌های بعدی نشت می‌کند)
  const ownerOnly = new Elysia({ prefix: '/admin/settings', tags: ['Admin / Settings'] })
    .use(requireAdmin(deps.sessions))

    .post(
      '/delivery-zones/fallback-fee',
      async ({ body, user }) => {
        const result = await deps.zones.setFallbackFee(body.fee)
        if (!result.success) return result
        await deps.audit.log({
          actorId: user.id,
          action: 'ZONE_FALLBACK_FEE_UPDATE',
          entity: 'delivery-zone',
          metadata: { fee: body.fee },
        })
        return result
      },
      {
        body: t.Object({ fee: t.Integer({ minimum: 0, maximum: 2_147_483_647 }) }),
        detail: { summary: 'Set delivery fee used during Neshan outages — main admin only' },
      },
    )

    .post(
      '/delivery-zones',
      async ({ body, user }) => {
        const result = await deps.zones.add(body.radiusKm, body.fee)
        if (!result.success) return result
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
          fee: t.Integer({ minimum: 0, maximum: 2_147_483_647 }),
        }),
        detail: { summary: 'Add delivery zone (duplicate radius rejected) — main admin only' },
      },
    )
    .post(
      '/delivery-zones/remove',
      async ({ body, user }) => {
        const result = await deps.zones.remove(body.radiusKm)
        if (!result.success) return result
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
          fee: t.Integer({ minimum: 0, maximum: 2_147_483_647 }),
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
    // stage-84 — سوئیچ درگاه‌های پرداخت (فقط ادمین اصلی): «فعال» یعنی نمایشِ
    // آن درگاه در چک‌اوت. اعمال سروری داخل tx چک‌اوت (بدون کش) + فیلترِ UI
    // از preview. callbackهای درگاهِ غیرفعال‌شده همچنان پردازش می‌شوند (پولِ
    // در جریان هرگز گروگانِ سوئیچ نمی‌شود).
    .get(
      '/gateways',
      async () => ({ gateways: await deps.settings.enabledGateways() }),
      {
        detail: {
          summary: 'Payment gateway switches (mellat/zarinpal/sep; default: all on) — main admin only',
        },
      },
    )
    .post(
      '/gateways',
      async ({ body, user }) => {
        await deps.settings.setGateways({
          mellat: body.mellat,
          zarinpal: body.zarinpal,
          sep: body.sep,
        })
        await deps.audit.log({
          actorId: user.id,
          action: 'GATEWAY_TOGGLE',
          entity: 'settings',
          metadata: {
            mellat: body.mellat,
            zarinpal: body.zarinpal,
            sep: body.sep,
          },
        })
        return { success: true }
      },
      {
        body: t.Object({
          mellat: t.Boolean(),
          zarinpal: t.Boolean(),
          sep: t.Boolean(),
        }),
        detail: {
          summary: 'Set enabled payment gateways — main admin only',
          description:
            'stage-84: enabled = shown to customers in checkout. Server-side validation reads the fresh value inside the checkout transaction (no 30s cache). In-flight payments of a later-disabled gateway still complete (callbacks are never blocked).',
        },
      },
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
            'When ON, non-Iranian IPs (including Iraq) get 403 geo-blocked (site + API). Effective within ~15s (cached). Admins abroad/VPN: set GEO_BYPASS_IPS in env. round-37: turning this OFF reveals the outside-scope choice (Iraq-only vs everyone) — see /outside-scope.',
        },
      },
    )
    // round-37 — دامنه‌ی ورود کاربران خارج از ایران (فقط عراق / همه)
    // فقط وقتی iran_only_access خاموش است معنا دارد؛ مقدارش حفظ می‌شود و
    // با روشن‌کردن دوباره‌ی قفل، بی‌اثر (نه پاک) می‌شود.
    .get(
      '/outside-scope',
      async () => ({
        scope: await deps.settings.get<'iraq' | 'world'>(SETTING_KEYS.outsideAccessScope, 'iraq'),
      }),
      {
        detail: {
          summary: 'Outside-Iran access scope (iraq | world, default: iraq) — main admin only',
          description:
            "Meaningful only while iran_only_access is OFF. 'iraq' = Iran + Iraq allowed, rest blocked. 'world' = no geo restriction.",
        },
      },
    )
    .post(
      '/outside-scope',
      async ({ body, user }) => {
        await deps.settings.set(SETTING_KEYS.outsideAccessScope, body.scope)
        await deps.audit.log({
          actorId: user.id,
          action: 'OUTSIDE_SCOPE_SET',
          entity: 'settings',
          metadata: { scope: body.scope },
        })
        return { success: true }
      },
      {
        body: t.Object({ scope: t.Union([t.Literal('iraq'), t.Literal('world')]) }),
        detail: {
          summary: 'Set outside-Iran access scope — main admin only',
          description:
            "'iraq' allows Iranian + Iraqi IPs only; 'world' opens the site to every country. Effective within ~15s (cached). Audit-logged as OUTSIDE_SCOPE_SET.",
        },
      },
    )

    // ═══ stage-100 — انیمیشن پس‌زمینه‌ی صفحه‌ی «محصول ویژه» ═══
    // انتخاب یکی از سه انیمیشن برای صفحه‌ی اختصاصی محصول ویژه (صفحه‌ای که
    // product.isFeatured=true دارد). مقدار غایب = 'shader' = همان انیمیشن
    // WebGL فعلی ⇒ هیچ نصبی با این استیج رفتارش عوض نمی‌شود. خواندنِ
    // عمومی از GET /menu/featured-animation (کشِ ETag منو — max-age=30).
    .get(
      '/featured-animation',
      async () => {
        const raw = await deps.settings.get<string>(
          SETTING_KEYS.featuredAnimation,
          'shader',
        )
        return { animation: raw === 'sonar' || raw === 'sparks' ? raw : 'shader' }
      },
      {
        detail: {
          summary: 'Featured-product page animation (shader | sonar | sparks) — main admin only',
          description:
            "stage-100: the default background animation of the special featured-product pages. 'shader' (default) = current WebGL waves; 'sonar' = SonarGrid dot field; 'sparks' = DualSparks corner rays. stage-101: per-product override lives on the product itself (featuredAnimation in the product form); this KV is the fallback for featured products without their own choice. Customers read it from the public GET /menu/featured-animation (ETag-cached, ~30s).",
        },
      },
    )
    .post(
      '/featured-animation',
      async ({ body, user }) => {
        await deps.settings.set(SETTING_KEYS.featuredAnimation, body.animation)
        await deps.audit.log({
          actorId: user.id,
          action: 'FEATURED_ANIMATION_SET',
          entity: 'settings',
          metadata: { animation: body.animation },
        })
        return { success: true }
      },
      {
        body: t.Object({
          animation: t.Union([
            t.Literal('shader'),
            t.Literal('sonar'),
            t.Literal('sparks'),
          ]),
        }),
        detail: {
          summary: 'Set the featured-product page animation — main admin only',
          description:
            "Stores the choice in the settings KV (featured_animation). New visitors see it within ~30s (public menu ETag cache). Audit-logged as FEATURED_ANIMATION_SET.",
        },
      },
    )

    // ═══ stage-79 — مجوز ثبت‌نام ویژه (فقط ادمین اصلی) ═══
    // دسترسیِ ویژه: شماره‌ای که اینجا صادر شود می‌تواند یک‌بار (در پنجره‌ی
    // اعتبار) ثبت‌نام کند — حتی از دستگاهِ سوخته/مسدود — و بعد از ثبت‌نامِ
    // موفق، همان دستگاه بلاک می‌شود (PERMIT_BURN / دلیل permit-burn).
    // مصرفِ مجوز اتمیک و داخل تراکنشِ ثبت‌نام است؛ لغو هر لحظه ممکن است.
    .get(
      '/registration-permits',
      () => deps.permits.list(),
      {
        detail: {
          summary: 'List recent registration permits — main admin only',
          description:
            'Latest 100 permits with effective status (pending/used/revoked/expired), note, expiry, and the device that consumed it.',
        },
      },
    )
    .post(
      '/registration-permits',
      async ({ body, user }) => {
        const permit = await deps.permits.issue({
          rawPhone: body.phone,
          note: body.note ?? null,
          ttlHours: body.ttlHours,
          adminId: user.id,
        })
        await deps.audit.log({
          actorId: user.id,
          action: 'REG_PERMIT_ISSUE',
          entity: 'registration-permit',
          entityId: permit.id,
          metadata: { phone: permit.phone, ttlHours: body.ttlHours ?? null, note: permit.note },
        })
        return { permit }
      },
      {
        body: t.Object({
          phone: t.String({ minLength: 4, maxLength: 20 }),
          note: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
          ttlHours: t.Optional(t.Number({ minimum: 1, maximum: 72 })),
        }),
        detail: {
          summary: 'Issue/refresh a registration permit — main admin only',
          description:
            'Grants ONE phone number a single-use registration pass (default 24h, max 72h). The number must not already have an account. During the permit window that number may register even from a burned/blocked device; when the registration succeeds the device is hard-blocked (reason: permit-burn) and the permit is atomically consumed inside the registration transaction. Re-issuing for the same pending number refreshes expiry/note. Audit-logged as REG_PERMIT_ISSUE.',
        },
      },
    )
    .post(
      '/registration-permits/revoke',
      async ({ body, user }) => {
        await deps.permits.revoke({ permitId: body.id, adminId: user.id })
        await deps.audit.log({
          actorId: user.id,
          action: 'REG_PERMIT_REVOKE',
          entity: 'registration-permit',
          entityId: body.id,
          metadata: {},
        })
        return { success: true }
      },
      {
        body: t.Object({ id: t.String({ format: 'uuid' }) }),
        detail: {
          summary: 'Revoke a pending registration permit — main admin only',
          description:
            'Only pending permits can be revoked. Atomic; if a registration is consuming the permit at this exact moment, the database transaction serializes the two (revocation wins → registration falls back to strict device rules). Audit-logged as REG_PERMIT_REVOKE.',
        },
      },
    )

  return new Elysia().use(shared).use(ownerOnly)
}
