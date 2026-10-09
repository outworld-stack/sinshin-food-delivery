// ═══════════════════════════════════════════════════════════════
// phase-2 — sinshin-food-delivery — فایل جدید
// مسیر مقصد: apps/api/src/http/routes/notification.routes.ts
// ═══════════════════════════════════════════════════════════════

// src/http/routes/notification.routes.ts
import { Elysia, t } from 'elysia'

import type { SessionService } from '#/domain/auth/session.service'
import type { NotificationService } from '#/domain/notification/notification.service'
import { requireAuth, requireAdmin } from '#/http/hooks/require-auth'

export interface NotificationRoutesDeps {
  sessions: SessionService
  notifications: NotificationService
}

/**
 * فاز-۲ — مسیرهای نوتیفیکیشن.
 *
 * کاربر (requireAuth):
 *  GET  /notifications               → لیست + خوانده‌نشده
 *  GET  /notifications/unread-count   → فقط شمارش (poll سبک)
 *  POST /notifications/read           → { id } یا { all: true }
 *  GET  /notifications/vapid-public   → کلید عمومی پوش (برای subscribe)
 *  POST /notifications/subscriptions  → ثبت اشتراک Web Push
 *  DELETE /notifications/subscriptions → حذف اشتراک
 *
 * ادمین اصلی (requireAdmin):
 *  POST /notifications/broadcast  → پخش عمومی (همه‌ی کاربران)
 *  POST /notifications/send       → ارسال به یک کاربر (تست)
 */
export const notificationRoutes = (deps: NotificationRoutesDeps) => {
  const user = new Elysia({ prefix: '/notifications', tags: ['Notifications'] })
    .use(requireAuth(deps.sessions))

    .get(
      '/',
      async ({ user }) => {
        const [items, unread] = await Promise.all([
          deps.notifications.list(user.id, 30),
          deps.notifications.unreadCount(user.id),
        ])
        return { items, unread }
      },
      { detail: { summary: 'My notifications (latest 30 + unread count)' } },
    )

    .get(
      '/unread-count',
      async ({ user }) => ({ unread: await deps.notifications.unreadCount(user.id) }),
      { detail: { summary: 'Unread count only (lightweight polling)' } },
    )

    .post(
      '/read',
      async ({ user, body }) => {
        if (body.all) {
          const marked = await deps.notifications.markAllRead(user.id)
          return { success: true, marked }
        }
        const ok = await deps.notifications.markRead(user.id, body.id ?? '')
        return { success: ok }
      },
      {
        body: t.Object({
          id: t.Optional(t.String({ maxLength: 40 })),
          all: t.Optional(t.Boolean()),
        }),
        detail: { summary: 'Mark one (id) or all notifications as read' },
      },
    )

    .get(
      '/vapid-public',
      () => ({ key: deps.notifications.vapidPublicKey() }),
      {
        detail: {
          summary: 'VAPID public key (base64url) — for pushManager.subscribe',
          description:
            'فاز-۲: کلید عمومی VAPID از VAPID_PUBLIC_KEY (env). کلید خصوصی هرگز بیرون نمی‌رود.',
        },
      },
    )

    .get(
      '/push-status',
      async ({ user }) => deps.notifications.pushStatus(user.id),
      { detail: { summary: 'Active push subscriptions of me' } },
    )

    .post(
      '/subscriptions',
      async ({ user, body, request }) => {
        const res = await deps.notifications.registerSubscription(user.id, {
          endpoint: body.endpoint,
          p256dh: body.keys.p256dh,
          auth: body.keys.auth,
          userAgent: request.headers.get('user-agent') ?? undefined,
        })
        if (!res.ok) {
          return new Response(
            JSON.stringify({ error: { code: 'PUSH_SUB_INVALID', message: 'اشتراک پوش معتبر نیست.', reason: res.reason } }),
            { status: 422, headers: { 'content-type': 'application/json' } },
          )
        }
        return { success: true }
      },
      {
        body: t.Object({
          endpoint: t.String({ maxLength: 2048 }),
          keys: t.Object({
            p256dh: t.String({ maxLength: 255 }),
            auth: t.String({ maxLength: 255 }),
          }),
        }),
        detail: { summary: 'Register/update my Web Push subscription (upsert on endpoint)' },
      },
    )

    .delete(
      '/subscriptions',
      async ({ user, body }) => {
        const ok = await deps.notifications.removeSubscription(user.id, body.endpoint)
        return { success: ok }
      },
      {
        body: t.Object({ endpoint: t.String({ maxLength: 2048 }) }),
        detail: { summary: 'Remove my Web Push subscription' },
      },
    )

  // ── ادمین اصلی ──
  const admin = new Elysia({ prefix: '/notifications', tags: ['Notifications'] })
    .use(requireAdmin(deps.sessions))

    .post(
      '/broadcast',
      async ({ body }) => {
        const res = await deps.notifications.broadcast({
          type: 'broadcast',
          title: body.title.slice(0, 120),
          body: body.body.slice(0, 300),
          url: body.url || undefined,
          data: {},
        })
        return { success: true, targeted: res.targeted }
      },
      {
        body: t.Object({
          title: t.String({ minLength: 2, maxLength: 120 }),
          body: t.String({ minLength: 2, maxLength: 300 }),
          url: t.Optional(t.String({ maxLength: 300 })),
        }),
        detail: {
          summary: 'Broadcast notification to all users (admin only)',
          description:
            'به همه‌ی کاربران عادی: ردیف صندوق + پوش به مشترکان. ادمین‌ها هدف نیستند.',
        },
      },
    )

    .post(
      '/send',
      async ({ body }) => {
        const res = await deps.notifications.notifyUser(body.userId, {
          type: 'system',
          title: body.title.slice(0, 120),
          body: body.body.slice(0, 300),
          url: body.url || undefined,
          data: {},
        })
        return { success: res.id !== null, pushed: res.pushed }
      },
      {
        body: t.Object({
          userId: t.String({ maxLength: 40 }),
          title: t.String({ minLength: 2, maxLength: 120 }),
          body: t.String({ minLength: 2, maxLength: 300 }),
          url: t.Optional(t.String({ maxLength: 300 })),
        }),
        detail: { summary: 'Send notification to one user (admin only — for testing)' },
      },
    )

  return new Elysia().use(user).use(admin)
}
