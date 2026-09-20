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
  hour: (p: string) => `otp:h:${p}`,
  day: (p: string) => `otp:d:${p}`,
}

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

    // ۱) فاصله‌ی بین دو درخواست
    if (await redis.exists(K.cooldown(phone))) {
      throw Err.rateLimited(
        `کد قبلی هنوز معتبر است؛ ${cooldownSeconds} ثانیه دیگر تلاش کنید.`,
        cooldownSeconds,
      )
    }

    // ۲) سقف ساعتی و روزانه هر شماره
    const hourCount = Number((await redis.get(K.hour(phone))) ?? 0)
    if (hourCount >= maxPerHourPerPhone) {
      throw Err.rateLimited('سقف درخواست کد در این ساعت پر شده است.', 3600)
    }
    const dayCount = Number((await redis.get(K.day(phone))) ?? 0)
    if (dayCount >= maxPerDayPerPhone) {
      throw Err.rateLimited('سقف درخواست کد در امروز پر شده است.', 86400)
    }

    // ۳) کد + هش (خود کد هرگز ذخیره نمی‌شود)
    const code = randomOtpCode(4)
    const codeHash = sha256(`${code}:${phone}`)

    // نسل A از multi/exec استفاده می‌کرد که RedisClient بانی ندارد؛
    // اینجا دنباله‌ای می‌نویسیم — دو درخواست هم‌زمان یعنی بازنویسی کد، بی‌خطر.
    const ok = await redis.set(K.code(phone), codeHash, { ex: ttlSeconds })
    if (ok !== 'OK') throw Err.internal('ذخیره‌ی کد ناموفق بود؛ کمی بعد تلاش کنید.')
    await redis.set(K.cooldown(phone), '1', { ex: cooldownSeconds })
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

  /** مقایسه‌ی زمان-ثابت با هشِ ذخیره — ۳ تلاش ناموفق، بعد کد جدید */
  async verify(phone: string, code: string): Promise<void> {
    const { redis } = this.deps
    const { ttlSeconds, maxAttempts } = this.deps.config.otp

    const stored = await redis.get(K.code(phone))
    if (!stored) {
      throw Err.validation('کدی برای این شماره صادر نشده یا منقضی شده است.')
    }

    const attempts = Number((await redis.get(K.attempts(phone))) ?? 0)
    if (attempts >= maxAttempts) {
      await redis.del(K.code(phone))
      throw Err.rateLimited('تعداد تلاش‌های ناموفق زیاد است؛ کد جدید بگیر.')
    }

    if (!safeEqual(stored, sha256(`${code}:${phone}`))) {
      await redis.incr(K.attempts(phone))
      await redis.expire(K.attempts(phone), ttlSeconds)
      const left = maxAttempts - attempts - 1
      throw Err.validation(
        left > 0 ? `کد وارد شده صحیح نیست. ${left} تلاش باقی مانده.` : 'کد وارد شده صحیح نیست.',
      )
    }

    // درست بود → مصرف شود
    await redis.del(K.code(phone))
  }
}