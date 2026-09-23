// src/domain/auth/session.service.ts
import { and, eq, isNull, sql } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import { sessions, users, type UserRow } from '#/infra/db/schema'
import type { AppConfig } from '#/infra/config/env'
import { Err } from '#/domain/shared/errors'
import { randomToken, sha256 } from '#/domain/shared/crypto'
import { asDeviceId, asSessionId, asUserId } from '#/domain/shared/brand'
import { TokenService } from './token.service'

export interface AuthContext {
  userId: string
  deviceId: string
  sessionId: string
  tokenVersion: number
}

export interface SessionIssue {
  user: UserRow
  accessToken: string
  refreshToken: string
  device: { id: string; name?: string | null }
}

export class SessionService {
  /**
   * round-16 — throttle نوشتن lastUsedAt: حداکثر یک UPDATE در ۶۰ ثانیه برای هر
   * نشست (قبلاً «هر» درخواستِ احراز یک UPDATE مستقل می‌نوشت — تقویت نوشتاری
   * بی‌مص روی WAL/vacuum؛ پنل زنده با پول ۲.۵ ثانیه‌ای یعنی ~۲۴ نویت در دقیقه).
   */
  private readonly lastTouch = new Map<string, number>()

  constructor(
    private readonly deps: { db: Db; config: AppConfig; tokens: TokenService },
  ) {}

  /** نشست تازه روی دستگاه فیزیکیِ resolve-شده */
  async createSession(
    user: UserRow,
    deviceId: string,
    ip?: string | null,
    userAgent?: string | null,
  ): Promise<SessionIssue> {
    const { db, config } = this.deps

    const refreshToken = randomToken(48)
    const [session] = await db
      .insert(sessions)
      .values({
        userId: asUserId(user.id),
        deviceId: asDeviceId(deviceId),
        refreshHash: sha256(refreshToken),
        ip: ip ?? null,
        userAgent: userAgent ?? null,
        expiresAt: new Date(Date.now() + config.sessionTtlDays * 86_400_000),
      })
      .returning()
    if (!session) throw Err.internal('ساخت نشست ناموفق بود.')

    const accessToken = await this.deps.tokens.sign({
      sub: user.id,
      dev: deviceId,
      ses: session.id,
      tv: user.tokenVersion,
    })

    return { user, accessToken, refreshToken, device: { id: deviceId } }
  }

  /** چرخش refresh + تشخیص استفاده‌ی مجدد (reuse detection) */
  async rotateSession(
    token: string,
    ip?: string | null,
  ): Promise<{ user: UserRow; accessToken: string; refreshToken: string }> {
    const { db } = this.deps
    const hash = sha256(token)

    const current = await db.query.sessions.findFirst({
      where: eq(sessions.refreshHash, hash),
    })

    if (current) {
      this.assertUsable(current)
      const user = await this.mustGetUser(current.userId)

      const refreshToken = randomToken(48)
      await db
        .update(sessions)
        .set({
          refreshHash: sha256(refreshToken),
          previousRefreshHash: hash,
          rotatedAt: new Date(),
          lastUsedAt: new Date(),
          ip: ip ?? current.ip,
        })
        .where(eq(sessions.id, current.id))

      const accessToken = await this.deps.tokens.sign({
        sub: user.id,
        dev: current.deviceId,
        ses: current.id,
        tv: user.tokenVersion,
      })
      return { user, accessToken, refreshToken }
    }

    const stale = await db.query.sessions.findFirst({
      where: eq(sessions.previousRefreshHash, hash),
    })
    if (stale) {
      await db
        .update(sessions)
        .set({ revokedAt: new Date(), revokedReason: 'reuse-detected' })
        .where(eq(sessions.id, stale.id))
      console.warn(`[session] reuse detected — session ${stale.id} revoked`)
      throw Err.unauthorized('نشست نامعتبر است؛ دوباره وارد شوید.')
    }

    throw Err.unauthorized('نشست شما منقضی شده است؛ دوباره وارد شوید.')
  }

  /** احراز access token + اعتبارسنجی دیتابیسی */
  async authenticate(token: string): Promise<{ user: UserRow; ctx: AuthContext }> {
    const { db } = this.deps
    const claims = await this.deps.tokens.verify(token)
    if (!claims) throw Err.unauthorized('نشست شما منقضی شده است؛ دوباره وارد شوید.')

    // round-16 — user + session با یک JOIN (قبلاً دو کوئری پشت‌سرهم در هر درخواست)
    const rows = await db
      .select({ user: users, session: sessions })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.id, asSessionId(claims.ses)))
      .limit(1)
    const found = rows[0]
    if (!found) throw Err.unauthorized()
    const { user, session } = found
    // توکن امضاشده است؛ این گارد فقط برای عمق دفاعی (عدم تطابق sub/ses):
    if (user.id !== claims.sub) throw Err.unauthorized()
    if (user.bannedAt) throw Err.banned()
    if (user.tokenVersion !== claims.tv) {
      throw Err.unauthorized('همه‌ی نشست‌های شما باطل شده‌اند؛ دوباره وارد شوید.')
    }
    this.assertUsable(session)

    const now = Date.now()
    if (now - (this.lastTouch.get(session.id) ?? 0) >= 60_000) {
      this.lastTouch.set(session.id, now)
      // سقف حافظه — نقشهٔ تازه (نشست‌های مرده مهم نیستند)
      if (this.lastTouch.size > 10_000) this.lastTouch.clear()
      void (async () => {
        try {
          await db
            .update(sessions)
            .set({ lastUsedAt: new Date() })
            .where(eq(sessions.id, session.id))
        } catch {
          /* noop */
        }
      })()
    }

    return {
      user,
      ctx: {
        userId: user.id,
        deviceId: session.deviceId,
        sessionId: session.id,
        tokenVersion: user.tokenVersion,
      },
    }
  }

  async revokeSession(sessionId: string, userId: string, reason = 'logout'): Promise<void> {
    await this.deps.db
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(sessions.id, asSessionId(sessionId)), eq(sessions.userId, asUserId(userId))))
  }

  async revokeAllSessions(userId: string): Promise<void> {
    const { db } = this.deps
    await db
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: 'logout-all' })
      .where(and(eq(sessions.userId, asUserId(userId)), isNull(sessions.revokedAt)))
    await db
      .update(users)
      .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.id, userId))
  }

  // ── داخلی ──

  private assertUsable(s: { revokedAt: Date | null; expiresAt: Date }): void {
    if (s.revokedAt) throw Err.unauthorized('نشست باطل شده است؛ دوباره وارد شوید.')
    if (s.expiresAt.getTime() <= Date.now()) {
      throw Err.unauthorized('نشست شما منقضی شده است؛ دوباره وارد شوید.')
    }
  }

  private async mustGetUser(userId: string): Promise<UserRow> {
    const user = await this.deps.db.query.users.findFirst({ where: eq(users.id, userId) })
    if (!user) throw Err.unauthorized()
    if (user.bannedAt) throw Err.banned()
    return user
  }
}