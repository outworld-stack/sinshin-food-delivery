//src/domain/auth/auth.service.ts
import { desc, eq, sql } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import { devices, deviceEvents, deviceIdentities, users, type UserRow, type DeviceRow } from '#/infra/db/schema'
import type { AppConfig } from '#/infra/config/env'
import { AppError, Err } from '#/domain/shared/errors'
import { isUniqueViolation } from '#/domain/shared/pg'
import { ensureUserReferralCode, generateUniqueReferralCode } from '#/domain/shared/referral-code'
import type { OtpService } from './otp.service'
import type { SessionService, SessionIssue } from './session.service'
import type { DeviceService } from '#/domain/device/device.service'
import type { Admin2Service } from '#/domain/admin2/admin2.service'
import type { DeviceSignals } from '#/domain/device/device-signals'
import type { RegistrationPermitService } from '#/domain/auth/registration-permit.service'
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

export class AuthService {
  constructor(
    private readonly deps: {
      db: Db
      config: AppConfig
      otp: OtpService
      sessions: SessionService
      devices: DeviceService
      admin2: Admin2Service
      /** stage-79 — مجوز ثبت‌نام ویژه (استثنای ادمینِ اصلی) */
      permits: RegistrationPermitService
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
   *     stage-79 — استثنا: مجوزِ ثبت‌نامِ فعال برای همین شماره (کاربرِ
   *     تازه) مسدودیِ دستگاه را برای همین ثبت‌نام رد می‌کند (PERMIT_BYPASS).
   *  ۴) کاربر جدید: قوانین + مالکِ ردیفِ دستگاه + معرف — سپس در «یک
   *     تراکنش»: ساخت کاربر + نهایی‌سازی دستگاه (claim اتمیک مالکیت)
   *     stage-79 — داخل tx: مجوز «اتمیک مصرف» می‌شود (claim شرطی)؛ اگر
   *     در فاصله‌ی peek→tx لغو/منقضی شده باشد، مسیر به حالتِ سختِ عادی
   *     برمی‌گردد (رفتارِ پیش از ۷۹) — پنجره‌ی TOCTOU صفر است.
   *  ۵) کاربر موجود: در همان الگو — به‌روزرسانی + نهایی‌سازی LOGIN
   *     (مجوز هرگز روی ورودِ کاربرِ موجود اثر ندارد)
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

    // ── stage-79 — وضعیتِ کاربر قبل از تصمیمِ مسدودی (خواندنِ خالص؛
    // فقط ترتیبِ دو SELECT خواندنی عوض شد). مجوز فقط برای «ثبت‌نامِ
    // کاربرِ تازه» معنا دارد — کاربرِ موجود هیچ‌وقت از مسیرِ مجوز
    // نمی‌گذرد (توافقِ صریح: به منطقِ ورود دست نزنیم). ──
    let user = await db.query.users.findFirst({ where: eq(users.phone, phone) })
    const isNewUser = !user
    const permit = isNewUser ? await this.deps.permits.peekActivePermit(phone) : null

    // ── هوشمندی دستگاه — فقط پیش‌بینی، صفر اثر جانبی ──
    const peek = await this.deps.devices.peek(signals, phone)
    if (peek.device?.isBlocked && !permit) {
      throw Err.forbidden('این دستگاه مسدود شده است؛ با پشتیبانی تماس بگیرید.')
    }

    const maxPhones = config.device.maxPhonesPerDevice
    let finalDevice: DeviceRow | undefined
    // stage-79 — آیا همین ثبت‌نام از مسیرِ مجوزِ مصرف‌شده گذشت؟ (برای
    // پیامِ پایانی و اطمینان از سوختن دستگاه در tx)
    let permitUsed = false

    if (!user) {
      if (!opts.termsAccepted) {
        throw Err.validation('پذیرش قوانین برای ثبت‌نام الزامی است.')
      }

      // ── سقف شماره‌های دستگاه (stage-60/62) — stage-70: فقط «همین ردیف» ──
      // مالکِ ردیفِ دستگاهِ فعلی؛ کل خوشه دیگر معیار رد نیست (P1-۲).
      // ورود با شماره‌های ثبت‌نام‌شده (کاربر موجود) همیشه آزاد است.
      // stage-79 — مجوزِ فعال: این چکِ «قبل از tx» نادیده گرفته می‌شود؛
      // مرزِ امن داخل tx بعد از claim اتمیک مجوز است (پایین‌تر).
      const owner = peek.device?.registeredOwnerPhone ?? null
      if (config.deviceEnforcement && maxPhones > 0 && owner && owner !== phone && !permit) {
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
          const refCode = opts.refCode.trim().toUpperCase()
          if (/^[A-Z0-9_-]{3,16}$/.test(refCode)) {
            const referrers = await db.query.users.findMany({
              where: sql`upper(${users.referralCode}) = ${refCode}`,
              limit: 2,
            })
            // Legacy codes can differ only by case. Do not guess which account
            // should receive money when the normalized code is ambiguous.
            referredBy = referrers.length === 1 ? referrers[0]!.id : null
          }
        }
      }

      // ── تراکنش اتمیک: کاربر + دستگاه + claim مالکیت — یا هیچ ──
      // stage-72 (P2-۹/۱۰): ① سهمیه داخل tx بعد از قفلِ شماره (TOCTOU)
      // ② ثبت‌نامِ هم‌زمانِ همان شماره = 409 تمیز نه 500 خام  ③ رویداد
      // PHONE_LIMIT_BLOCKED بعد از rollback (بیرون tx) ثبت می‌شود
      // stage-79: ④ مجوز با claim اتمیکِ تک‌عبارتی «اولِ tx» مصرف می‌شود —
      // لغو/انقضای هم‌زمان یعنی permitOverride=false و ادامه با قواعدِ
      // کاملِ سختِ عادی (بدون هیچ باقی‌ماندنی از استثنا). مصرف داخل tx
      // است ⇒ rollback ثبت‌نام، مجوز را هم دست‌نخورده برمی‌گرداند.
      const outcome = await this.withRegistrationGuards(
        db.transaction(async (tx) => {
          // قفلِ شماره: ثبت‌نام/ورودِ هم‌زمانِ همین شماره سریال می‌شود
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${phone}))`)
          const currentPeek = await this.deps.devices.peekOn(tx, signals, phone)
          await this.deps.devices.assertQuotaOn(tx, phone, willBeRole, currentPeek.device?.id ?? null)

          // ── stage-79 — claim اتمیکِ مجوز (قبل از هر تصمیمِ استثنا) ──
          const claimedPermit = permit
            ? await this.deps.permits.consumeForRegistration(tx, phone, currentPeek.device?.id ?? null)
            : null
          const permitOverride = claimedPermit !== null

          // مجوزِ لحظه‌ای (peek) دیده شد ولی claim نشد — لغو/انقضای هم‌زمان:
          // تصمیمِ گذر از مسدودیِ مرحله‌ی peek را برگردان (مسیرِ سختِ عادی)
          if (!permitOverride && currentPeek.device?.isBlocked) {
            throw Err.forbidden('این دستگاه مسدود شده است؛ با پشتیبانی تماس بگیرید.')
          }

          // بازبینی مالکیت زیر قفل — رقیبی بین peek و تراکنش claim کرده باشد
          // (stage-79: با مجوزِ مصرف‌شده این چک نادیده گرفته می‌شود —
          // finalize با claim بی‌قیدوشرط مالک را بازنویسی می‌کند و گام ۵-b
          // دستگاه را برای همیشه می‌بندد)
          if (currentPeek.device && !permitOverride) {
            const rows = await tx
              .select({ owner: devices.registeredOwnerPhone })
              .from(devices)
              .where(eq(devices.id, currentPeek.device.id))
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
              referralCode: await generateUniqueReferralCode(tx),
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
            peek: currentPeek,
            event: 'REGISTER',
            ...(permitOverride
              ? { permitOverride: true, permitId: claimedPermit?.id ?? null }
              : {}),
          })

          // New device links only exist after finalize. Recheck the resulting
          // cluster before committing a referral, including storage-reset devices.
          if (createdUser.referredBy) {
            const clusterPhones = await this.deps.devices.referralBlockedForDeviceOn(
              tx, device.id, phone,
            )
            if (clusterPhones >= config.device.referralBlockAfter) {
              await tx.update(users).set({ referredBy: null }).where(eq(users.id, createdUser.id))
              createdUser.referredBy = null
              await tx.insert(deviceEvents).values({
                deviceId: device.id,
                phone,
                event: 'REFERRAL_BLOCKED',
                ip: ip ?? null,
                userAgent: signals.userAgent ?? null,
                metadata: { refCode: opts.refCode, clusterPhones },
              })
            }
          }

          // رکوردِ ممیزی: ردیفِ دستگاهِ نهایی که مجوز را مصرف کرد
          if (claimedPermit) {
            await this.deps.permits.recordUsedDevice(tx, claimedPermit.id, device.id)
          }

          return { user: createdUser, device, permitUsed: permitOverride }
        }),
        { phone, ip, userAgent: signals.userAgent ?? null, peekDeviceId: peek.device?.id ?? null },
      )
      user = outcome.user
      finalDevice = outcome.device
      permitUsed = outcome.permitUsed
    } else {
      if (user.bannedAt) throw Err.banned()

      const existingUser = user
      const outcome = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${phone}))`)
        const currentPeek = await this.deps.devices.peekOn(tx, signals, phone)
        const effectiveRole = config.isSuperAdmin(phone) ? 'admin' : existingUser.role
        await this.deps.devices.assertQuotaOn(tx, phone, effectiveRole, currentPeek.device?.id ?? null)

        const patch: Partial<typeof users.$inferInsert> = { lastLoginAt: new Date() }
        if (!existingUser.referralCode?.trim()) await ensureUserReferralCode(tx, existingUser.id)
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
          peek: currentPeek,
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

    // stage-72 (P2-۱۰) — دستگاهِ تازه auto-blockشده دیگر سشنِ کاری نمی‌گیرد:
    // قبلاً revoke سشن‌ها داخل tx بود اما createSession «بعد از» تراکنش صادر
    // می‌شد و سشنِ تازه از ابطال فرار می‌کرد. ثبت‌نام موفق است (کاربر ساخته
    // شد) اما استفاده از این دستگاه مسدود است — همان خطای ورودِ بعدی.
    // stage-79 — همان قاعده‌ی طلایی برای مسیرِ مجوز: ثبت‌نام کامل شد (که
    // خواسته‌ی اصلی بود) اما دستگاه طبق قراردادِ مجوز سوخت؛ پیامِ متمایز
    // تا شخص بداند سرِ کجاست — با دستگاهِ دیگری وارد شود (ادمین هم
    // می‌تواند با ابزارِ موجودِ UNBLOCK دستگاه را برای ورود باز کند؛
    // claim مالکیت می‌ماند و ثبت‌نامِ بعدی از همان دستگاه ممکن نمی‌شود).
    if (deviceRow.isBlocked) {
      throw Err.forbidden(
        permitUsed
          ? 'ثبت‌نام شما کامل شد، اما این دستگاه طبق مجوز ثبت‌نام بلاک شد؛ برای ورود از دستگاه دیگری استفاده کنید.'
          : 'این دستگاه مسدود شده است؛ با پشتیبانی تماس بگیرید.',
      )
    }

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
      // stage-75 (P3-29) — هم‌راستا با ادمین (admin.service): desc پیش‌فرضِ
      // PG یعنی NULLS FIRST — دستگاه‌هایی که هرگز لاگین نکرده‌اند اولِ لیست
      // می‌آمدند و پروفایل/ادمین برای همان کاربر دو ترتیبِ متفاوت نشان
      // می‌دادند. کلیدِ دوم هم آینه‌ی ادمین: firstLoginAt desc.
      .orderBy(
        sql`${deviceIdentities.lastLoginAt} desc nulls last`,
        desc(deviceIdentities.firstLoginAt),
      )

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

  /**
   * stage-72 (P2-۹/۱۰) — پوششِ خطاهای تراکنشِ ثبت‌نام:
   *  ① 23505 روی users_phone_key (OTP double-verify / دو تب هم‌زمان) →
   *    خطای 409 تمیز دامنه‌ای، نه 500 خام
   *  ② سقف شماره‌ی دستگاه (DEVICE_PHONE_LIMIT) → رویدادِ ممیزیِ
   *    PHONE_LIMIT_BLOCKED بعد از rollback بیرون tx ثبت و دوباره پرتاب
   *    می‌شود (قبلاً داخل tx لاگ می‌شد و با rollback گم می‌شد)
   */
  private async withRegistrationGuards<T>(
    run: Promise<T>,
    ctx: { phone: string; ip?: string | null; userAgent?: string | null; peekDeviceId?: string | null },
  ): Promise<T> {
    try {
      return await run
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw Err.conflict(
          'ثبت‌نام این شماره همین لحظه انجام شد؛ چند ثانیه بعد دوباره وارد شوید.',
        )
      }
      if (error instanceof AppError && error.code === 'DEVICE_PHONE_LIMIT' && ctx.peekDeviceId) {
        const limit = this.deps.config.device.maxPhonesPerDevice
        await this.deps.devices.logEvent(
          ctx.peekDeviceId,
          ctx.phone,
          'PHONE_LIMIT_BLOCKED',
          ctx.ip,
          ctx.userAgent,
          { phone: ctx.phone, limit, race: true },
        )
      }
      throw error
    }
  }
}
