//src/domain/auth/auth.service.ts
import { desc, eq } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import { devices, deviceIdentities, users, type UserRow } from '#/infra/db/schema'
import type { AppConfig } from '#/infra/config/env'
import { Err } from '#/domain/shared/errors'
import type { OtpService } from './otp.service'
import type { SessionService, SessionIssue } from './session.service'
import type { DeviceService } from '#/domain/device/device.service'
import type { Admin2Service } from '#/domain/admin2/admin2.service'
import type { DeviceSignals } from '#/domain/device/device-signals'

export interface PublicUser {
  id: string
  phone: string
  name: string | null
  role: string
  referralCode: string | null
  createdAt: Date
  lastLoginAt: Date | null
}

export interface LoginOptions {
  refCode?: string | null
  termsAccepted?: boolean
  termsVersion?: string | null
}

const REF_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

function randomReferralCode(len: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len))
  let s = ''
  for (const b of bytes) s += REF_ALPHABET[b % REF_ALPHABET.length]
  return `SIN-${s}`
}

export class AuthService {
  constructor(
    private readonly deps: {
      db: Db
      config: AppConfig
      otp: OtpService
      sessions: SessionService
      devices: DeviceService
      admin2: Admin2Service
    },
  ) { }

  publicUser(u: UserRow): PublicUser {
    return {
      id: u.id,
      phone: u.phone,
      name: u.name,
      role: u.role,
      referralCode: u.referralCode,
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt,
    }
  }

  requestOtp(phone: string) {
    return this.deps.otp.send(phone)
  }

  /** چکِ سبکِ قبل از ارسال کد — بدون هزینه‌ی پیامک */
  async checkPhone(
    phone: string,
  ): Promise<{ isNewUser: boolean; needsTerms: boolean; role: string | null }> {
    const user = await this.deps.db.query.users.findFirst({ where: eq(users.phone, phone) })
    if (!user) return { isNewUser: true, needsTerms: true, role: null }
    return {
      isNewUser: false,
      needsTerms: user.termsAcceptedAt === null,
      role: user.role,
    }
  }

  /**
   * ورود با OTP — یک مسیر واحد برای همه‌ی نقش‌ها:
   *  ۱) کد چک می‌شود
   *  ۲) دستگاه resolve (clientId → هش مرکب → شباهت+link) + ریسک + autoblock
   *  ۳) دستگاه مسدود → رد
   *  ۴) کاربر پیدا/ساخته می‌شود — admin2: قواعد لاگین (ساعتی بسته → رد)
   *  ۵) سهمیه‌ی دستگاه + هویت + رویداد
   *  ۶) نشست روی دستگاه فیزیکی
   *  ۷) admin2: onLogin → سشن + رویداد + queueCountِ scope
   */
  async loginWithOtp(
    phone: string,
    code: string,
    signals: DeviceSignals,
    ip?: string | null,
    opts: LoginOptions = {},
  ): Promise<SessionIssue & { isNewUser: boolean; queueCount?: number }> {
    const { db, config } = this.deps
    await this.deps.otp.verify(phone, code)

    // ── هوشمندی دستگاه ──
    const resolution = await this.deps.devices.resolve(signals, phone, ip)
    if (resolution.device.isBlocked) {
      throw Err.forbidden('این دستگاه مسدود شده است؛ با پشتیبانی تماس بگیرید.')
    }

    let user = await db.query.users.findFirst({ where: eq(users.phone, phone) })
    let isNewUser = false

    if (!user) {
      isNewUser = true
      if (!opts.termsAccepted) {
        throw Err.validation('پذیرش قوانین برای ثبت‌نام الزامی است.')
      }
      const willBeRole = config.isSuperAdmin(phone) ? 'admin' : 'user'

      // ── معرف + REFERRAL_BLOCK ──
      let referredBy: string | null = null
      if (opts.refCode) {
        if (resolution.referralBlocked) {
          await this.deps.devices.logEvent(
            resolution.device.id,
            phone,
            'REFERRAL_BLOCKED',
            ip,
            signals.userAgent ?? null,
            { refCode: opts.refCode, clusterPhones: resolution.clusterPhoneCount },
          )
          console.log(
            `[device] referral blocked for ${phone} — cluster already has ${resolution.clusterPhoneCount} phone(s)`,
          )
        } else {
          const refCode = opts.refCode.trim().toUpperCase().slice(0, 32)
          const referrer = await db.query.users.findFirst({
            where: eq(users.referralCode, refCode),
          })
          referredBy = referrer?.id ?? null
        }
      }

      await this.deps.devices.assertQuota(phone, willBeRole, resolution.device.id)

      const [createdUser] = await db
        .insert(users)
        .values({
          phone,
          role: willBeRole,
          lastLoginAt: new Date(),
          referralCode: await this.generateUniqueReferralCode(),
          referredBy,
          termsAcceptedAt: new Date(),
          termsVersion: opts.termsVersion ?? null,
        })
        .returning()
      user = createdUser

      await this.deps.devices.attachIdentity(
        resolution.device.id,
        phone,
        'REGISTER',
        ip,
        signals.userAgent ?? null,
      )
    } else {
      if (user.bannedAt) throw Err.banned()

      const patch: Partial<typeof users.$inferInsert> = { lastLoginAt: new Date() }
      if (config.isSuperAdmin(phone) && user.role !== 'admin') patch.role = 'admin'
      if (opts.termsAccepted && !user.termsAcceptedAt) {
        patch.termsAcceptedAt = new Date()
        patch.termsVersion = opts.termsVersion ?? null
      }
      const [updated] = await db
        .update(users)
        .set(patch)
        .where(eq(users.id, user.id))
        .returning()
      user = updated ?? user

      await this.deps.devices.assertQuota(phone, user.role, resolution.device.id)
      await this.deps.devices.attachIdentity(
        resolution.device.id,
        phone,
        'LOGIN',
        ip,
        signals.userAgent ?? null,
      )
    }

    if (!user) throw Err.internal('ذخیره‌سازی کاربر ناموفق بود؛ دوباره تلاش کن.')

    // ── قلاب admin2 — قبل از سشن: قواعد لاگین (ساعتی بسته → رد) ──
    await this.deps.admin2.assertLoginAllowed(user)

    const issue = await this.deps.sessions.createSession(
      user,
      resolution.device.id,
      ip,
      signals.userAgent ?? null,
    )

    // ── قلاب admin2 — بعد از سشن: onLogin + queueCount ──
    let queueCount: number | undefined
    if (user.role === 'admin2') {
      const r = await this.deps.admin2.onLogin(user)
      queueCount = r.queueCount
    }

    return {
      ...issue,
      device: {
        id: resolution.device.id,
        name: resolution.device.label ?? resolution.device.platform ?? 'دستگاه',
      },
      isNewUser,
      ...(queueCount !== undefined ? { queueCount } : {}),
    }
  }

  /** پروفایل + دستگاه‌های کاربر — از هویت‌ها */
  async getAccount(userId: string, currentDeviceId: string) {
    const { db } = this.deps
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) })
    if (!user) throw Err.unauthorized()

    const rows = await db
      .select({
        device: devices,
        relation: deviceIdentities.relation,
        firstLoginAt: deviceIdentities.firstLoginAt,
        lastLoginAt: deviceIdentities.lastLoginAt,
      })
      .from(deviceIdentities)
      .innerJoin(devices, eq(devices.id, deviceIdentities.deviceId))
      .where(eq(deviceIdentities.phone, user.phone))
      .orderBy(desc(deviceIdentities.lastLoginAt))

    return {
      user: this.publicUser(user),
      devices: rows.map((r) => ({
        id: r.device.id,
        name: r.device.label ?? r.device.platform ?? 'دستگاه',
        platform: r.device.platform,
        riskScore: r.device.riskScore,
        lastActiveAt: r.lastLoginAt ?? r.firstLoginAt,
        createdAt: r.firstLoginAt,
        current: r.device.id === currentDeviceId,
      })),
    }
  }

  private async generateUniqueReferralCode(): Promise<string> {
    for (let i = 0; i < 5; i++) {
      const code = i < 4 ? randomReferralCode(6) : randomReferralCode(10)
      const clash = await this.deps.db.query.users.findFirst({
        where: eq(users.referralCode, code),
      })
      if (!clash) return code
    }
    return `SIN-${Date.now().toString(36).toUpperCase()}`
  }
}