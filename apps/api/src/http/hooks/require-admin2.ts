// src/http/hooks/require-admin2.ts
import { Elysia } from 'elysia'

import type { SessionService } from '#/domain/auth/session.service'
import type { Admin2Service, Admin2Permissions } from '#/domain/admin2/admin2.service'
import { Err } from '#/domain/shared/errors'

/** استخراج + احراز مشترک */
async function authenticate(sessions: SessionService, request: Request) {
  const header = request.headers.get('authorization') ?? ''
  let token = header.startsWith('Bearer ') ? header.slice(7).trim() : null
  if (!token) token = new URL(request.url).searchParams.get('token')
  if (!token) throw Err.unauthorized()
  return sessions.authenticate(token)
}

/**
 * phase-1 — پروفایل + isActive + permissions در یک مسیر.
 * قبلاً: admin2ی «غیرفعال‌شده» و admin2ی بدون پروفایل از گارد رد می‌شدند و
 * کل مدل permission دکوری بود. isActive حالا داخل permissionsOf چک می‌شود.
 */
async function resolveAdmin2Permissions(
  admin2: Admin2Service,
  userId: string,
): Promise<Admin2Permissions> {
  const permissions = await admin2.permissionsOf(userId)
  if (!permissions) throw Err.forbidden('پروفایل ادمین سطح ۲ یافت نشد.')
  return permissions
}

/**
 * گارد ادمین۲ (و ادمین اصلی — ادمین اصلی همه‌چیز می‌تواند):
 *  auth + user + admin2 (permissions یا null اگر admin اصلی)
 */
export const requireAdmin2 = (deps: { sessions: SessionService; admin2: Admin2Service }) =>
  new Elysia({ name: 'require-admin2' })
    .resolve({ as: 'scoped' }, async ({ request }) => {
      const { user, ctx } = await authenticate(deps.sessions, request)
      if (user.role === 'admin') return { auth: ctx, user, admin2: null }
      if (user.role !== 'admin2') {
        throw Err.forbidden('این بخش فقط برای ادمین‌ها مجاز است.')
      }
      return { auth: ctx, user, admin2: await resolveAdmin2Permissions(deps.admin2, user.id) }
    })

/** گارد permission خاص — phase-1: حالا واقعاً سیم‌کشی شده (ادمین‌routes پیک) */
export const requireAdmin2Permission = (
  deps: { sessions: SessionService; admin2: Admin2Service },
  perm: keyof Admin2Permissions,
) =>
  new Elysia({ name: `require-admin2-perm-${String(perm)}` })
    .resolve({ as: 'scoped' }, async ({ request }) => {
      const { user, ctx } = await authenticate(deps.sessions, request)
      if (user.role === 'admin') return { auth: ctx, user, admin2: null }
      if (user.role !== 'admin2') throw Err.forbidden()

      const permissions = await resolveAdmin2Permissions(deps.admin2, user.id)
      if (!permissions[perm]) throw Err.forbidden('اجازه‌ی این عملیات را ندارید.')
      return { auth: ctx, user, admin2: permissions }
    })