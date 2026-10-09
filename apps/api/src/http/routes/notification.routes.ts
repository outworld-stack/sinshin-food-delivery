// ═══════════════════════════════════════════════════════════════
// stage-48 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/http/routes/notification.routes.ts
// وضعیت: جایگزینی کامل فایل موجود
// تغییر:
//   • broadcast: ادمین اصلی + ادمین۲ با مجوز notificationsSend؛
//     فرستنده در notification_log ثبت می‌شود (نقش + نام)
//   • /notifications/history: تاریخچه‌ی ارسال با فیلتر (جستجو/نوع/
//     فرستنده/بازه/صفحه‌بندی) — ادمین اصلی + ادمین۲ با notificationsRead
//   • POST /send (ارسال تست) حذف شد — خواسته‌ی صریح: باکس تست برداشته شود
// ═══════════════════════════════════════════════════════════════

// src/http/routes/notification.routes.ts
import { Elysia, t } from 'elysia'

import type { SessionService } from '#/domain/auth/session.service'
import type { Admin2Service } from '#/domain/admin2/admin2.service'
import type { NotificationService } from '#/domain/notification/notification.service'
import { requireAuth } from '#/http/hooks/require-auth'
import { requireAdmin2Permission } from '#/http/hooks/require-admin2'

export interface NotificationRoutesDeps {
  sessions: SessionService
  notifications: NotificationService
  /** stage-48 — گارد مجوز ادمین۲ (notificationsSend / notificationsRead) */
  admin2: Admin2Service
}

/**
 * فاز-۲ + stage-48 — مسیرهای نوتیفیکیشن.
 *
 * کاربر (requireAuth):
 *  GET  /notifications               → لیست + خوانده‌نشده
 *  GET  /notifications/unread-count   → فقط شمارش (poll سبک)
 *  POST /notifications/read           → { id } یا { all: true }
 *  GET  /notifications/vapid-public   → کلید عمومی پوش (برای subscribe)
 *  POST /notifications/subscriptions  → ثبت اشتراک Web Push
 *  DELETE /notifications/subscriptions → حذف اشتراک
 *
 * پنل (ادمین اصلی همیشه؛ ادمین۲ با مجوز):
 *  POST /notifications/broadcast  → پخش عمومی (send: notificationsSend)
 *  GET  /notifications/history    → تاریخچه‌ی ارسال (read: notificationsRead)
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

  // ── پنل — ادمین اصلی همیشه رد می‌شود؛ ادمین۲ با مجوز مربوطه ──
  // (requireAdmin2Permission برای نقش admin بدون چک مجوز رد می‌شود)
  const send = new Elysia({ prefix: '/notifications', tags: ['Notifications'] })
    .use(
      requireAdmin2Permission(
        { sessions: deps.sessions, admin2: deps.admin2 },
        'notificationsSend',
      ),
    )

    .post(
      '/broadcast',
      async ({ body, user }) => {
        // stage-48 — فرستنده در تاریخچه ثبت می‌شود (نقش + نام/شماره)
        const senderName = (user.name ?? '').trim() || user.phone
        const res = await deps.notifications.broadcast(
          {
            type: 'broadcast',
            title: body.title.slice(0, 120),
            body: body.body.slice(0, 300),
            url: body.url || undefined,
            data: {},
          },
          { role: user.role === 'admin2' ? 'admin2' : 'admin', name: senderName },
        )
        return { success: true, targeted: res.targeted }
      },
      {
        body: t.Object({
          title: t.String({ minLength: 2, maxLength: 120 }),
          body: t.String({ minLength: 2, maxLength: 300 }),
          url: t.Optional(t.String({ maxLength: 300 })),
        }),
        detail: {
          summary: 'Broadcast notification to all users (main admin or admin2 with notificationsSend)',
          description:
            'به همه‌ی کاربران عادی: ردیف صندوق + پوش به مشترکان. ادمین‌ها هدف نیستند. ' +
            'stage-48: هر ارسال در تاریخچه (notification_log) با نقش/نام فرستنده ثبت می‌شود.',
        },
      },
    )

  const history = new Elysia({ prefix: '/notifications', tags: ['Notifications'] })
    .use(
      requireAdmin2Permission(
        { sessions: deps.sessions, admin2: deps.admin2 },
        'notificationsRead',
      ),
    )

    .get(
      '/history',
      async ({ query }) => {
        const from = query.from ? dateOrUndefined(query.from) : undefined
        const to = query.to ? dateOrUndefined(query.to) : undefined
        return deps.notifications.listHistory({
          search: query.search || undefined,
          type: query.type || undefined,
          senderRole: query.sender || undefined,
          from,
          to,
          page: query.page,
          limit: query.limit,
        })
      },
      {
        query: t.Object({
          page: t.Number({ minimum: 1 }),
          limit: t.Number({ minimum: 5, maximum: 100 }),
          search: t.Optional(t.String({ maxLength: 80 })),
          type: t.Optional(t.String({ maxLength: 40 })),
          sender: t.Optional(t.String({ maxLength: 16 })),
          from: t.Optional(t.String({ maxLength: 30 })),
          to: t.Optional(t.String({ maxLength: 30 })),
        }),
        detail: {
          summary: 'Notification send history with advanced filters (main admin or admin2 with notificationsRead)',
          description:
            'stage-48: تاریخچه‌ی ارسال‌های گروهی (broadcast ادمین/ادمین۲ + پخش خودکار تخفیف محصول). ' +
            'فیلترها: جستجو در عنوان/متن، نوع، فرستنده (admin/admin2/system)، بازه‌ی تاریخ، صفحه‌بندی.',
        },
      },
    )

  return new Elysia().use(user).use(send).use(history)
}

/** تاریخ ISO خراب → undefined (نه Invalid Date → RangeError → 500 — الگوی رارد M21) */
function dateOrUndefined(raw: string): Date | undefined {
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? undefined : d
}