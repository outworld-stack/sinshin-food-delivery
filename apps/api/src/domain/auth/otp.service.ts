//src/domain/auth/otp.service.ts
import type { RedisService } from '#/infra/redis/redis'
import type { AppConfig } from '#/infra/config/env'
import type { SmsService } from '#/infra/sms/sms.service'
import { Err } from '#/domain/shared/errors'
import { randomOtpCode, safeEqual, sha256 } from '#/domain/shared/crypto'


const K = {
  code: (p: string) => `otp:code:${p}`,
  cooldown: (p: string) => `otp:cd:${p}`,
  attempts: (p: string) => `otp:att:${p}`,
  /** round-28 — پنجره‌ی مستقل خطای verify (بین کدها؛ با کد جدید ریست «نمی‌شود») */
  vfails: (p: string) => `otp:vf:${p}`,
  hour: (p: string) => `otp:h:${p}`,
  day: (p: string) => `otp:d:${p}`,
}

/** round-28 — سقف کل خطاهای verify در پنجره‌ی ثابت، مستقل از چرخه‌ی کد:
 *  قبلن هر «کد جدید» شمارنده‌ی تلاش‌ها را صفر می‌کرد؛ حمله می‌توانست با
 *  چرخه‌ی کد-جدید/حدس‌های-موازی بی‌نهایت حدس جمع کند. این پنجره با کد
 *  جدید ریست نمی‌شود — فقط verify موفق آن را پاک می‌کند. */
const VERIFY_FAIL_WINDOW_S = 15 * 60
const VERIFY_FAIL_CAP = 10

export class OtpService {
  constructor(
    private readonly deps: { redis: RedisService; config: AppConfig; sms: SmsService },
  ) { }

  /**
   * کد ۴ رقمی می‌سازد، «هش» آن را در Redis می‌گذارد و پیامک می‌فرستد.
   * نرخ‌ها طبق قرارداد فرانت: ۶۰s فاصله / ۳ تلاش / سقف ساعتی و روزانه.
   */
  async send(phone: string): Promise<{ cooldownSeconds: number; devCode?: string }> {
    const { redis } = this.deps
    const { ttlSeconds, cooldownSeconds, maxPerHourPerPhone, maxPerDayPerPhone } =
      this.deps.config.otp

    // ۱) سقف ساعتی و روزانه هر شماره — read-only، ردِ سریع
    // (قبل از گیت می‌آیند تا ردِ سقف، گیتِ کول‌داون را نگرفته باشد)
    const hourCount = Number((await redis.get(K.hour(phone))) ?? 0)
    if (hourCount >= maxPerHourPerPhone) {
      throw Err.rateLimited('سقف درخواست کد در این ساعت پر شده است.', 3600)
    }
    const dayCount = Number((await redis.get(K.day(phone))) ?? 0)
    if (dayCount >= maxPerDayPerPhone) {
      throw Err.rateLimited('سقف درخواست کد در امروز پر شده است.', 86400)
    }

    // ۲) فاصله‌ی بین دو درخواست — گیت اتمیک (امن-۲)
    // قبلاً exists-بعد-set بود: دو درخواست هم‌زمان هر دو از exists رد می‌شدند
    // → دو پیامک + بازنویسی کد. SET NX فقط به یکی اجازه می‌دهد.
    // null (ردیس در دسترس نیست) = fail-open مثل بقیه‌ی محدودیت‌ها.
    const gate = await redis.setNx(K.cooldown(phone), '1', { ex: cooldownSeconds })
    if (gate === false) {
      throw Err.rateLimited(
        `کد قبلی هنوز معتبر است؛ ${cooldownSeconds} ثانیه دیگر تلاش کنید.`,
        cooldownSeconds,
      )
    }

    // ۳) کد + هش (خود کد هرگز ذخیره نمی‌شود)
    // round-28 — ۶ رقم: کد ۴رقمی فضای ۱۰هزارتایی دارد؛ با شمارنده‌ی اتمیک و
    // سقف‌های جدید، ۶رقمی (یک میلیون) brute-force را عملاً بی‌معنا می‌کند.
    const code = randomOtpCode(6)
    const codeHash = sha256(`${code}:${phone}`)

    const ok = await redis.set(K.code(phone), codeHash, { ex: ttlSeconds })
    if (ok !== 'OK') {
      // ردیس ناپایدار — گیت را پس بگیر تا کاربر ۶۰ ثانیه قفل نشود
      await redis.del(K.cooldown(phone))
      throw Err.internal('ذخیره‌ی کد ناموفق بود؛ کمی بعد تلاش کنید.')
    }
    await redis.incr(K.hour(phone))
    await redis.expire(K.hour(phone), 3600)
    await redis.incr(K.day(phone))
    await redis.expire(K.day(phone), 86400)
    await redis.del(K.attempts(phone))

    // ۴) ارسال — از تنها نقطه‌ی SMS سیستم
    const sent = await this.deps.sms.send(phone, `کد ورود شما به سین‌شین: ${code}`)
    if (!sent && this.deps.config.isProd) {
      // phase-1: درگاه مرد؛ کد و کول‌داون را پس بگیر تا کاربر قفل نشود
      // (قبلاً sent:true برمی‌گشت و کول‌داون کاربر سوخته می‌شد)
      await redis.del(K.code(phone))
      await redis.del(K.cooldown(phone))
      throw Err.internal('ارسال پیامک ناموفق بود؛ کمی بعد تلاش کنید.')
    }
    // در dev یا provider=console کد در پاسخ هم هست تا بدون پنل تست کنی
    const reveal = !this.deps.config.isProd
    return { cooldownSeconds, ...(reveal ? { devCode: code } : {}) }
  }

  /**
   * مقایسه‌ی زمان-ثابت با هشِ ذخیره — ۳ تلاش ناموفق، بعد کد جدید.
   *
   * round-28 — دو سخت‌گیری جدید:
   *  • شمارنده‌ی تلاش «اتمیک»: قبلاً get→check→incr بود؛ N درخواست موازی
   *    همه attempts=0 می‌دیدند و هر کدام یک حدس می‌گرفتند. حالا INCR اول
   *    بالا می‌رود، بعد سقف چک می‌شود — هر حدس دقیقاً یکی شمرده می‌شود.
   *  • سقف مستقل ۱۵دقیقه‌ای: خطاهای verify بین کدها هم جمع می‌شوند؛
   *    چرخه‌ی «کد جدید بگیر تا شمارنده صفر شود» دیگر حدس اضافه نمی‌دهد.
   */
  async verify(phone: string, code: string): Promise<void> {
    const { redis } = this.deps
    const { ttlSeconds, maxAttempts } = this.deps.config.otp

    const stored = await redis.get(K.code(phone))
    if (!stored) {
      throw Err.validation('کدی برای این شماره صادر نشده یا منقضی شده است.')
    }

    // INCR اول — بعد سقف (اتمیک؛ توازی دیگر حدس مجانی نمی‌دهد)
    const attempts = await redis.incr(K.attempts(phone))
    if (attempts === 1) await redis.expire(K.attempts(phone), ttlSeconds)
    if (attempts > maxAttempts) {
      await redis.del(K.code(phone))
      throw Err.rateLimited('تعداد تلاش‌های ناموفق زیاد است؛ کد جدید بگیر.')
    }

    if (!safeEqual(stored, sha256(`${code}:${phone}`))) {
      // پنجره‌ی مستقل — با کد جدید ریست نمی‌شود (شرح در VERIFY_FAIL_CAP)
      const fails = await redis.incr(K.vfails(phone))
      if (fails === 1) await redis.expire(K.vfails(phone), VERIFY_FAIL_WINDOW_S)
      if (fails >= VERIFY_FAIL_CAP) {
        throw Err.rateLimited(
          `تلاش‌های ناموفق زیاد است؛ ${Math.ceil(VERIFY_FAIL_WINDOW_S / 60)} دقیقه دیگر تلاش کنید.`,
          VERIFY_FAIL_WINDOW_S,
        )
      }
      const left = maxAttempts - attempts
      throw Err.validation(
        left > 0 ? `کد وارد شده صحیح نیست. ${left} تلاش باقی مانده.` : 'کد وارد شده صحیح نیست.',
      )
    }

    // درست بود → مصرف شود (کد + شمارنده‌ها — پنجره‌ی مستقل هم پاک می‌شود
    // چون مالکِ شماره ثابت شده است)
    await redis.del(K.code(phone))
    await redis.del(K.attempts(phone))
    await redis.del(K.vfails(phone))
  }
}