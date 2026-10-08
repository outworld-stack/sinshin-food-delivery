//src/hooks/require-auth.ts
import { Elysia } from 'elysia'

import type { SessionService } from '#/domain/auth/session.service'
import { Err } from '#/domain/shared/errors'

/** استخراج + احراز توکن — مشترک بین requireAuth و requireAdmin */
export async function authenticateRequest(sessions: SessionService, request: Request) {
  const header = request.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null
  // رارد H5 — مسیر query string حذف شد: توکن کامل در URL یعنی نشت به
  // هیستوری مرورگر و access-log هر لایه‌ی میانی. SSE از این پس با
  // fetch + هدر Authorization خوانده می‌شود (useAdmin2Panel.ts).
  if (!token) throw Err.unauthorized()

  return sessions.authenticate(token)
}

/** گارد احراز — `auth` و `user` را به حوزه اضافه می‌کند */
export const requireAuth = (sessions: SessionService) =>
  new Elysia({ name: 'require-auth' })
    .resolve({ as: 'scoped' }, async ({ request }) => {
      const { user, ctx } = await authenticateRequest(sessions, request)
      return { auth: ctx, user }
    })

/** گارد ادمین اصلی — نقش admin (ادمین سطح ۲ برای مدیریت دستگاه مجاز نیست) */
export const requireAdmin = (sessions: SessionService) =>
  new Elysia({ name: 'require-admin' })
    .resolve({ as: 'scoped' }, async ({ request }) => {
      const { user, ctx } = await authenticateRequest(sessions, request)
      if (user.role !== 'admin') {
        throw Err.forbidden('این بخش فقط برای ادمین اصلی مجاز است.')
      }
      return { auth: ctx, user }
    })