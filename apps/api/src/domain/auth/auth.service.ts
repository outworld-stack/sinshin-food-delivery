//src/domain/auth/auth.service.ts
import { desc, eq, sql } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import { devices, deviceIdentities, users, type UserRow, type DeviceRow } from '#/infra/db/schema'
import type { AppConfig } from '#/infra/config/env'
import { Err } from '#/domain/shared/errors'
import type { OtpService } from './otp.service'
import type { SessionService, SessionIssue } from './session.service'
import type { DeviceService } from '#/domain/device/device.service'
import type { Admin2Service } from '#/domain/admin2/admin2.service'
import type { DeviceSignals } from '#/domain/device/device-signals'
import type { AuthUser, Role } from '@sinshin/shared'
import { asUserId } from '#/domain/shared/brand'

// رارد ۴۷ — کاربر عمومی = قرارداد مشترک AuthUser (کپی محلی حذف شد)؛
// برند id و union نقش در مرز ساختِ publicUser اعمال می‌شود.

// ═══ stage-70 ═══
// جریان ورود/ثبت‌نام بازطراحی شد (اسکن راند ۷۰ — P1-۲/P1-۳/P2-۴/P2-۵):
//   ۱) peek فقط-خواندنی: هیچ اثر دائمی قبل از موفقیت (نه دستگاه، نه
//      لینک، نه مسدودسازی، نه ابطال سشن).
//   ۲) سقف سختِ «هر دستگاه یک ثبت‌نام» فقط روی «همان ردیفِ دستگاه» با
//      claim اتمیک اعمال می‌شود؛ خوشه‌ی شباهت فقط سیگنال ریسک/معرف است.
//   ۳) کاربر + دستگاه + claim + هویت، همه در «یک تراکنش» — یا هیچ.
//   ۴) قفل advisory روی شماره + FOR UPDATE روی ردیف دستگاه: رقابت‌های
//      هم‌زمان دقیقاً یک برنده دارند و بازنده خطای دامنه‌ای تمیز می‌گیرد.

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

  publicUser(u: UserRow): AuthUser {
    return {
      id: asUserId(u.id),
      phone: u.phone,
      name: u.name,
      role: u.role as Role,
      referralCode: u.referralCode,
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt,
    }
  }

  requestOtp(phone: string) {
    return this.deps.otp.send(phone)
  }

  /**
   * چکِ سبکِ قبل از ارسال کد — بدون هزینه‌ی پیامک.
   * round-28 — role حذف شد: این روت «قبل از احراز هویت» است و نقش را فاش
   * می‌کرد (مهاجم شماره‌ی ادمین‌ها را شناسایی و هدف‌گیری می‌کرد). نقش فقط
   * بعد از لاگین واقعی (پس از تایید کد، از user.role) برمی‌گردد.
   */
  async checkPhone(
    phone: string,
  ): Promise<{ isNewUser: boolean; needsTerms: boolean }> {
    const user = await this.deps.db.query.users.findFirst({ where: eq(users.phone, phone) })
    if (!user) return { isNewUser: true, needsTerms: true }
    return {
      isNewUser: false,
      needsTerms: user.termsAcceptedAt === null,
    }
  }

  /**
   * ورود با OTP — یک مسیر واحد برای همه‌ی نقش‌ها:
   *  ۱) کد چک می‌شود
   *  ۲) پیش‌بینیِ فقط-خواندنیِ دستگاه (stage-70: بدون اثر دائمی)
   *  ۳) دستگاه مسدود → رد (مسدودی = فقط تصمیم ادمین یا ریسکِ پس از ثبت‌نام)
   *  ۴) کاربر جدید: قوانین + مالکِ ردیفِ دستگاه + معرف — سپس در «یک
   *     تراکنش»: ساخت کاربر + نهایی‌سازی دستگاه (claim اتمیک مالکیت)
   *  ۵) کاربر موجود: در همان الگو — به‌روزرسانی + نهایی‌سازی LOGIN
   *  ۶) نشست روی دستگاه فیزیکی
   *  ۷) admin2: قواعد لاگین / onLogin
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

    // ── هوشمندی دستگاه — فقط پیش‌بینی، صفر اثر جانبی ──
    const peek = await this.deps.devices.peek(signals, phone)
    if (peek.device?.isBlocked) {
      throw Err.forbidden('این دستگاه مسدود شده است؛ با پشتیبانی تماس بگیرید.')
    }

    let user = await db.query.users.findFirst({ where: eq(users.phone, phone) })
    const isNewUser = !user
    const maxPhones = config.device.maxPhonesPerDevice
    let finalDevice: DeviceRow | undefined

    if (!user) {
      if (!opts.termsAccepted) {
        throw Err.validation('پذیرش قوانین برای ثبت‌نام الزامی است.')
      }

      // ── سقف شماره‌های دستگاه (stage-60/62) — stage-70: فقط «همین ردیف» ──
      // مالکِ ردیفِ دستگاهِ فعلی؛ کل خوشه دیگر معیار رد نیست (P1-۲).
      // ورود با شماره‌های ثبت‌نام‌شده (کاربر موجود) همیشه آزاد است.
      const owner = peek.device?.registeredOwnerPhone ?? null
      if (config.deviceEnforcement && maxPhones > 0 && owner && owner !== phone) {
        if (peek.device) {
          await this.deps.devices.logEvent(
            peek.device.id,
            phone,
            'PHONE_LIMIT_BLOCKED',
            ip,
            signals.userAgent ?? null,
            { phone, limit: maxPhones, ownerPhone: owner },
          )
        }
        throw Err.devicePhoneLimit(maxPhones)
      }

      const willBeRole = config.isSuperAdmin(phone) ? 'admin' : 'user'

      // ── معرف + REFERRAL_BLOCK (خوشه = سیگنال ضدفارم، نه رد قطعی) ──
      let referredBy: string | null = null
      if (opts.refCode) {
        if (peek.referralBlocked) {
          if (peek.device) {
            await this.deps.devices.logEvent(
              peek.device.id,
              phone,
              'REFERRAL_BLOCKED',
              ip,
              signals.userAgent ?? null,
              { refCode: opts.refCode, clusterPhones: peek.clusterPhoneCount },
            )
          }
          console.log(
            `[device] referral blocked for ${phone} — cluster already has ${peek.clusterPhoneCount} phone(s)`,
          )
        } else {
          const refCode = opts.refCode.trim().toUpperCase().slice(0, 32)
          const referrer = await db.query.users.findFirst({
            where: eq(users.referralCode, refCode),
          })
          referredBy = referrer?.id ?? null
        }
      }

      await this.deps.devices.assertQuota(phone, willBeRole, peek.device?.id ?? null)

      // ── تراکنش اتمیک: کاربر + دستگاه + claim مالکیت — یا هیچ ──
      const outcome = await db.transaction(async (tx) => {
        // قفلِ شماره: ثبت‌نام/ورودِ هم‌زمانِ همین شماره سریال می‌شود
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${phone}))`)

        // بازبینی مالکیت زیر قفل — رقیبی بین peek و تراکنش claim کرده باشد
        if (peek.device) {
          const rows = await tx
            .select({ owner: devices.registeredOwnerPhone })
            .from(devices)
            .where(eq(devices.id, peek.device.id))
            .for('update')
          const currentOwner = rows[0]?.owner ?? null
          if (config.deviceEnforcement && maxPhones > 0 && currentOwner && currentOwner !== phone) {
            throw Err.devicePhoneLimit(maxPhones)
          }
        }

        const [createdUser] = await tx
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
        if (!createdUser) throw Err.internal('ذخیره‌سازی کاربر ناموفق بود؛ دوباره تلاش کن.')

        const { device } = await this.deps.devices.finalize(tx, {
          signals,
          phone,
          ip,
          peek,
          event: 'REGISTER',
        })
        return { user: createdUser, device }
      })
      user = outcome.user
      finalDevice = outcome.device
    } else {
      if (user.bannedAt) throw Err.banned()

      await this.deps.devices.assertQuota(phone, user.role, peek.device?.id ?? null)

      const existingUser = user
      const outcome = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${phone}))`)

        const patch: Partial<typeof users.$inferInsert> = { lastLoginAt: new Date() }
        if (config.isSuperAdmin(phone) && existingUser.role !== 'admin') patch.role = 'admin'
        if (opts.termsAccepted && !existingUser.termsAcceptedAt) {
          patch.termsAcceptedAt = new Date()
          patch.termsVersion = opts.termsVersion ?? null
        }
        const [updated] = await tx
          .update(users)
          .set(patch)
          .where(eq(users.id, existingUser.id))
          .returning()

        const { device } = await this.deps.devices.finalize(tx, {
          signals,
          phone,
          ip,
          peek,
          event: 'LOGIN',
        })
        return { user: updated ?? existingUser, device }
      })
      user = outcome.user
      finalDevice = outcome.device
    }

    if (!user) throw Err.internal('ذخیره‌سازی کاربر ناموفق بود؛ دوباره تلاش کن.')
    if (!finalDevice) throw Err.internal('تفسیر دستگاه ناموفق بود؛ دوباره تلاش کنید.')

    const deviceRow = finalDevice

    // ── قلاب admin2 — قبل از سشن: قواعد لاگین (ساعتی بسته → رد) ──
    await this.deps.admin2.assertLoginAllowed(user)

    const issue = await this.deps.sessions.createSession(
      user,
      deviceRow.id,
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
        id: deviceRow.id,
        name: deviceRow.label ?? deviceRow.platform ?? 'دستگاه',
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
        // stage-70 — برند/مدل/نوع برای «دستگاه‌های فعال» پروفایل
        deviceType: r.device.deviceType,
        deviceBrand: r.device.deviceBrand,
        deviceModel: r.device.deviceModel,
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
