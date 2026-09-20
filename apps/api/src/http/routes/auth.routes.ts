//src/http/routes/auth.routes.ts
import { Elysia, t } from 'elysia'

import type { AppConfig } from '#/infra/config/env'
import type { RedisService } from '#/infra/redis/redis'
import type { Admin2Service } from '#/domain/admin2/admin2.service'
import type { AuthService } from '#/domain/auth/auth.service'
import type { SessionService } from '#/domain/auth/session.service'
import type { DeviceService } from '#/domain/device/device.service'

import { Err } from '#/domain/shared/errors'
import { normalizePhone, toEnglishDigits } from '#/domain/shared/phone'
import { parseCookies, serializeCookie } from '#/domain/shared/cookies'
import { requireAuth } from '#/http/hooks/require-auth'
import { ipRateLimit } from '#/http/hooks/ip-rate-limit'
import { clientIp } from '#/domain/shared/net'

const RT_COOKIE = 'sinshin_rt'
const HASH_PATTERN = '^[a-f0-9]{64}$'
const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

export interface AuthRoutesDeps {
  config: AppConfig
  redis: RedisService
  auth: AuthService
  sessions: SessionService
  devices: DeviceService
  admin2: Admin2Service
}

const deviceSchema = t.Object({
  clientId: t.Optional(t.Nullable(t.String({ maxLength: 64 }))),
  canvasHash: t.String({ pattern: HASH_PATTERN }),
  webglHash: t.String({ pattern: HASH_PATTERN }),
  audioHash: t.String({ pattern: HASH_PATTERN }),
  fontsHash: t.String({ pattern: HASH_PATTERN }),
  screen: t.Optional(t.Nullable(t.String({ maxLength: 40 }))),
  platform: t.Optional(t.Nullable(t.String({ maxLength: 60 }))),
  timezone: t.Optional(t.Nullable(t.String({ maxLength: 60 }))),
  language: t.Optional(t.Nullable(t.String({ maxLength: 20 }))),
  hardwareConcurrency: t.Optional(t.Nullable(t.Integer({ minimum: 1, maximum: 256 }))),
  deviceMemory: t.Optional(t.Nullable(t.Number({ minimum: 0, maximum: 64 }))),
  touch: t.Optional(t.Nullable(t.Boolean())),
  networkType: t.Optional(t.Nullable(t.String({ maxLength: 20 }))),
  label: t.Optional(t.Nullable(t.String({ maxLength: 100 }))),
})

export const authRoutes = (deps: AuthRoutesDeps) => {
  const rtMaxAge = deps.config.sessionTtlDays * 86_400

  const rtCookie = (token: string) =>
    serializeCookie(RT_COOKIE, token, {
      maxAge: rtMaxAge,
      httpOnly: true,
      secure: true,                    // ← همیشه true — localhost هم secure است
      sameSite: deps.config.isProd ? 'Lax' : 'None',
      path: '/',
    })
  const clearRtCookie = serializeCookie(RT_COOKIE, '', {
    maxAge: 0,
    httpOnly: true,
    path: '/',
  })

  return new Elysia({ prefix: '/auth', tags: ['Auth'] })

    .post(
      '/check',
      async ({ body }) => {
        const phone = normalizePhone(body.phone)
        if (!phone) throw Err.validation('شماره موبایل معتبر نیست.')
        return deps.auth.checkPhone(phone)
      },
      {
        body: t.Object({ phone: t.String() }),
        // ← phase-1: rate-limit روی /auth/check — قبلاً آزاد بود
        beforeHandle: ipRateLimit({
          redis: deps.redis,
          scope: 'auth-check',
          limit: 30,
          windowSeconds: 60,
        }),
        detail: {
          summary: 'Check user before sending OTP (no SMS cost)',
          description:
            'Lightweight gate for the terms/referral step before spending SMS. Rate limit: 30/min per IP. Per-phone limits live in OtpService.',
        },
      },
    )

    .post(
      '/otp/request',
      async ({ body, set }) => {
        const phone = normalizePhone(body.phone)
        if (!phone) throw Err.validation('شماره موبایل معتبر نیست.')

        const r = await deps.auth.requestOtp(phone)
        set.status = 200
        return {
          sent: true,
          cooldownSeconds: r.cooldownSeconds,
          ...(r.devCode ? { devCode: r.devCode } : {}),
        }
      },
      {
        // فقط همین روت — سقف IP: ۲۰ در دقیقه (سقف‌های شماره‌محور در OtpService اصلی‌اند)
        beforeHandle: ipRateLimit({
          redis: deps.redis,
          scope: 'otp-request',
          limit: 20,
          windowSeconds: 60,
        }),
        body: t.Object({ phone: t.String() }),
        detail: {
          summary: 'Request login OTP',
          description:
            'IP limit: 20/min. Per-phone limits (primary SMS-cost guard): 60s cooldown, 5/hour, 20/day.',
        },
      },
    )

    .post(
      '/otp/verify',
      async ({ body, headers, set }) => {
        const phone = normalizePhone(body.phone)
        if (!phone) throw Err.validation('شماره موبایل معتبر نیست.')

        const code = toEnglishDigits(body.code).replace(/\s+/g, '')
        if (!/^\d{4}$/.test(code)) throw Err.validation('کد وارد شده معتبر نیست.')

        const ip = clientIp(headers['x-forwarded-for']);
        const result = await deps.auth.loginWithOtp(
          phone,
          code,
          { ...body.device, userAgent: headers['user-agent'] ?? null },
          ip,
          {
            refCode: body.refCode ?? null,
            termsAccepted: body.termsAccepted ?? false,
            termsVersion: body.termsVersion ?? null,
          },
        )

        set.headers['set-cookie'] = rtCookie(result.refreshToken)
        return {
          accessToken: result.accessToken,
          expiresIn: deps.config.accessTokenTtlMinutes * 60,
          isNewUser: result.isNewUser,
          user: deps.auth.publicUser(result.user),
          device: result.device,
          ...(result.queueCount !== undefined ? { queueCount: result.queueCount } : {}),
        }
      },
      {
        // فقط همین روت — سقف IP: ۴۰ در دقیقه
        beforeHandle: ipRateLimit({
          redis: deps.redis,
          scope: 'otp-verify',
          limit: 40,
          windowSeconds: 60,
        }),
        body: t.Object({
          phone: t.String(),
          code: t.String({ minLength: 4, maxLength: 4 }),
          device: deviceSchema,
          refCode: t.Optional(t.Nullable(t.String({ maxLength: 20 }))),
          termsAccepted: t.Optional(t.Boolean()),
          termsVersion: t.Optional(t.Nullable(t.String({ maxLength: 20 }))),
        }),
        detail: {
          summary: 'Verify OTP and login',
          description:
            'Device fingerprint (layer 1 clientId + layer 2 signal hashes) is resolved server-side: exact hash match, similarity linking, risk scoring, referral-fraud block. Creates user on first login (termsAccepted required). Refresh token rotates in an HttpOnly cookie.',
        },
      },
    )

    .post(
      '/refresh',
      async ({ request, set }) => {
        const token = parseCookies(request)[RT_COOKIE]
        if (!token) throw Err.unauthorized('نشستی پیدا نشد؛ دوباره وارد شوید.')

        const ip = clientIp(request.headers.get('x-forwarded-for'))
        const r = await deps.sessions.rotateSession(token, ip)

        set.headers['set-cookie'] = rtCookie(r.refreshToken)
        return {
          accessToken: r.accessToken,
          expiresIn: deps.config.accessTokenTtlMinutes * 60,
          user: deps.auth.publicUser(r.user),
        }
      },
      {
        detail: {
          summary: 'Rotate refresh token',
          description: 'Refresh reuse detection revokes the whole session family.',
        },
      },
    )

    .use(requireAuth(deps.sessions))

    .post(
      '/logout',
      async ({ auth, user, set }) => {
        if (user.role === 'admin2') await deps.admin2.onLogout(user)
        await deps.sessions.revokeSession(auth.sessionId, auth.userId, 'logout')
        set.headers['set-cookie'] = clearRtCookie
        return { ok: true }
      },
      { detail: { summary: 'Logout current device' } },
    )

    .post(
      '/logout-all',
      async ({ user, set }) => {
        await deps.sessions.revokeAllSessions(user.id)
        set.headers['set-cookie'] = clearRtCookie
        return { ok: true }
      },
      { detail: { summary: 'Logout all devices (bumps tokenVersion)' } },
    )

    .get(
      '/me',
      ({ auth, user }) => deps.auth.getAccount(user.id, auth.deviceId),
      { detail: { summary: 'Current profile and known devices' } },
    )

    .delete(
      '/devices/:id',
      async ({ user, params }) => {
        const ok = await deps.devices.revokeIdentity(user.id, user.phone, params.id)
        if (!ok) throw Err.notFound('دستگاهی با این شناسه برای شما پیدا نشد.')
        return { ok: true }
      },
      {
        params: t.Object({ id: t.String({ pattern: UUID_PATTERN }) }),
        detail: { summary: 'Remove one of my devices (identity + its sessions)' },
      },
    )
}