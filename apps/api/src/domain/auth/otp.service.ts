//src/domain/auth/otp.service.ts
import type { RedisService } from '#/infra/redis/redis'
import type { AppConfig } from '#/infra/config/env'
import type { SmsService } from '#/infra/sms/sms.service'
import { Err } from '#/domain/shared/errors'
import { sendOtp, verifyOtp, type OtpKeys } from '#/domain/shared/otp-core'


const K: OtpKeys = {
  code: (p: string) => `otp:code:${p}`,
  cooldown: (p: string) => `otp:cd:${p}`,
  attempts: (p: string) => `otp:att:${p}`,
  hour: (p: string) => `otp:h:${p}`,
  day: (p: string) => `otp:d:${p}`,
}

/** round-28 — پنجره‌ی مستقل خطای تایید (بین کدها؛ با کد جدید ریست «نمی‌شود») — کلیدِ مخصوص همین سرویس */
const vfailsKey = (p: string) => `otp:vf:${p}`

/** round-28 — سقف کل خطاهای تایید در پنجره‌ی ثابت، مستقل از چرخه‌ی کد:
 *  قبلن هر «کد جدید» شمارنده‌ی تلاش‌ها را صفر می‌کرد؛ حمله می‌توانست با
 *  چرخه‌ی کد-جدید/حدس‌های-موازی بی‌نهایت حدس جمع کند. این پنجره با کد
 *  جدید ریست نمی‌شود — فقط تایید موفق آن را پاک می‌کند. */
const VERIFY_FAIL_WINDOW_S = 15 * 60
const VERIFY_FAIL_CAP = 10

export class OtpService {
  constructor(
    private readonly deps: { redis: RedisService; config: AppConfig; sms: SmsService },
  ) { }

  /**
   * کد ۶ رقمی می‌سازد، «هش» آن را در Redis می‌گذارد و پیامک می‌فرستد.
   * نرخ‌ها طبق قرارداد فرانت: ۶۰s فاصله / ۳ تلاش / سقف ساعتی و روزانه.
   * مکانیزم در otp-core مشترک است (رارد ۴۸) — این‌جا فقط سیاستِ کاربر.
   */
  async send(phone: string): Promise<{ cooldownSeconds: number; devCode?: string }> {
    const { ttlSeconds, cooldownSeconds, maxPerHourPerPhone, maxPerDayPerPhone } =
      this.deps.config.otp
    return sendOtp(this.deps, {
      phone,
      ttlSeconds,
      cooldownSeconds,
      maxPerHour: maxPerHourPerPhone,
      maxPerDay: maxPerDayPerPhone,
      keys: K,
      messages: {
        hourCap: 'سقف درخواست کد در این ساعت پر شده است.',
        dayCap: 'سقف درخواست کد در امروز پر شده است.',
        cooldown: (s) => `کد قبلی هنوز معتبر است؛ ${s} ثانیه دیگر تلاش کنید.`,
        storeFail: 'ذخیره‌ی کد ناموفق بود؛ کمی بعد تلاش کنید.',
        smsFail: 'ارسال پیامک ناموفق بود؛ کمی بعد تلاش کنید.',
      },
      smsText: (code) => `کد ورود شما به سین‌شین: ${code}`,
      isProd: this.deps.config.isProd,
    })
  }

  /**
   * مقایسه‌ی زمان-ثابت با هشِ ذخیره — ۳ تلاش ناموفق، بعد کد جدید.
   *
   * round-28 — دو سخت‌گیری روی هسته‌ی مشترک:
   *  • شمارنده‌ی تلاش «اتمیک»: هر حدس دقیقاً یکی شمرده می‌شود.
   *  • سقف مستقل ۱۵دقیقه‌ای: خطاهای تایید بین کدها هم جمع می‌شوند؛
   *    چرخه‌ی «کد جدید بگیر تا شمارنده صفر شود» دیگر حدس اضافه نمی‌دهد.
   */
  async verify(phone: string, code: string): Promise<void> {
    const { redis } = this.deps
    const { ttlSeconds, maxAttempts } = this.deps.config.otp

    const result = await verifyOtp(this.deps, {
      phone,
      code,
      maxAttempts,
      ttlSeconds,
      keys: K,
    })
    if (result.ok) {
      // مالکِ شماره ثابت شده است — پنجره‌ی مستقل هم پاک می‌شود
      await redis.del(vfailsKey(phone))
      return
    }
    if (result.reason === 'no-code') {
      throw Err.validation('کدی برای این شماره صادر نشده یا منقضی شده است.')
    }
    if (result.reason === 'too-many') {
      throw Err.rateLimited('تعداد تلاش‌های ناموفق زیاد است؛ کد جدید بگیر.')
    }
    // mismatch — پنجره‌ی مستقل (با کد جدید ریست نمی‌شود؛ شرح در VERIFY_FAIL_CAP)
    const fails = await redis.incr(vfailsKey(phone))
    if (fails === 1) await redis.expire(vfailsKey(phone), VERIFY_FAIL_WINDOW_S)
    if (fails >= VERIFY_FAIL_CAP) {
      throw Err.rateLimited(
        `تلاش‌های ناموفق زیاد است؛ ${Math.ceil(VERIFY_FAIL_WINDOW_S / 60)} دقیقه دیگر تلاش کنید.`,
        VERIFY_FAIL_WINDOW_S,
      )
    }
    const left = result.attemptsLeft
    throw Err.validation(
      left > 0 ? `کد وارد شده صحیح نیست. ${left} تلاش باقی مانده.` : 'کد وارد شده صحیح نیست.',
    )
  }
}