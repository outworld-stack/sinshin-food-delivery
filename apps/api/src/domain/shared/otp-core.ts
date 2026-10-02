//src/domain/shared/otp-core.ts
// هسته‌ی مشترک جریان OTP روی ردیس — منبع واحد رارد ۴۸ (اسکن A2).
// پیش از این، OtpService اصلی و مسیر پیک هر دو همین مکانیزم را جدا می‌نوشتند
// و نسخه‌ی پیک روی گیتِ غیراتمیکِ قدیمی (exists→set) مانده بود: دو درخواست
// هم‌زمان هر دو از exists رد می‌شدند → دو پیامک + بازنویسی کد.
// سیاست‌های متفاوت (پنجره‌ی خطای تاییدِ کاربر، توکن پیک، متن پیام‌ها)
// بیرون از هسته می‌مانند — هسته فقط مکانیزم است.

import type { RedisService } from '#/infra/redis/redis'
import type { SmsService } from '#/infra/sms/sms.service'
import { Err } from '#/domain/shared/errors'
import { randomOtpCode, safeEqual, sha256 } from '#/domain/shared/crypto'

/** کلیدهای ردیسی جریان — هر فراخوان پیشوند خودش را دارد */
export interface OtpKeys {
  code: (phone: string) => string
  cooldown: (phone: string) => string
  attempts: (phone: string) => string
  hour: (phone: string) => string
  day?: (phone: string) => string
}

/** متن‌های خطا روی مرز هر فراخوان — پیام‌های کاربر تغییر نمی‌کنند */
export interface OtpMessages {
  hourCap: string
  dayCap?: string
  cooldown: (seconds: number) => string
  storeFail: string
  smsFail: string
}

export interface SendOtpParams {
  phone: string
  ttlSeconds: number
  cooldownSeconds: number
  maxPerHour: number
  maxPerDay?: number
  keys: OtpKeys
  messages: OtpMessages
  smsText: (code: string) => string
  isProd: boolean
}

/** نتیجه‌ی تایید — سرویس فراخوان، خطا و سیاست‌های خاص خودش را رویش می‌سازد */
export type OtpVerifyResult =
  | { ok: true }
  | { ok: false; reason: 'no-code' }
  | { ok: false; reason: 'too-many' }
  | { ok: false; reason: 'mismatch'; attemptsLeft: number }

/**
 * ارسال کد: سقف‌ها → گیت اتمیک کول‌داون → ذخیره‌ی هش → شمارنده‌ها → پیامک.
 * ترتیب گاردها: سقف‌ها قبل از گیت — ردِ سقف، گیتِ کول‌داون را نگرفته باشد.
 */
export async function sendOtp(
  deps: { redis: RedisService; sms: SmsService },
  p: SendOtpParams,
): Promise<{ cooldownSeconds: number; devCode?: string }> {
  const { redis } = deps
  const { keys, messages } = p

  // ۱) سقف ساعتی/روزانه‌ی هر شماره — فقط‌خواندنی، ردِ سریع
  const hourCount = Number((await redis.get(keys.hour(p.phone))) ?? 0)
  if (hourCount >= p.maxPerHour) {
    throw Err.rateLimited(messages.hourCap, 3600)
  }
  if (keys.day && p.maxPerDay) {
    const dayCount = Number((await redis.get(keys.day(p.phone))) ?? 0)
    if (dayCount >= p.maxPerDay) {
      throw Err.rateLimited(messages.dayCap ?? messages.hourCap, 86400)
    }
  }

  // ۲) فاصله‌ی بین دو درخواست — گیت اتمیک (امن-۲):
  // SET NX فقط به یکی از درخواست‌های هم‌زمان اجازه می‌دهد.
  // null (ردیس در دسترس نیست) = در خطا باز می‌گذارد، مثل بقیه‌ی محدودیت‌ها.
  const gate = await redis.setNx(keys.cooldown(p.phone), '1', { ex: p.cooldownSeconds })
  if (gate === false) {
    throw Err.rateLimited(messages.cooldown(p.cooldownSeconds), p.cooldownSeconds)
  }

  // ۳) کد + هش (خود کد هرگز ذخیره نمی‌شود) — round-28: ۶ رقم
  const code = randomOtpCode(6)
  const ok = await redis.set(keys.code(p.phone), sha256(`${code}:${p.phone}`), {
    ex: p.ttlSeconds,
  })
  if (ok !== 'OK') {
    // ردیس ناپایدار — گیت را پس بگیر تا کاربر روی کول‌داون قفل نشود
    await redis.del(keys.cooldown(p.phone))
    throw Err.internal(messages.storeFail)
  }
  await redis.incr(keys.hour(p.phone))
  await redis.expire(keys.hour(p.phone), 3600)
  if (keys.day) {
    await redis.incr(keys.day(p.phone))
    await redis.expire(keys.day(p.phone), 86400)
  }
  await redis.del(keys.attempts(p.phone))

  // ۴) ارسال — از تنها نقطه‌ی SMS سیستم
  const sent = await deps.sms.send(p.phone, p.smsText(code))
  if (!sent && p.isProd) {
    // درگاه مرد؛ کد و کول‌داون را پس بگیر تا کول‌داون کاربر سوخته نشود
    await redis.del(keys.code(p.phone))
    await redis.del(keys.cooldown(p.phone))
    throw Err.internal(messages.smsFail)
  }
  // در محیط توسعه یا provider=console کد در پاسخ هم هست تا بدون پنل تست کنی
  const reveal = !p.isProd
  return { cooldownSeconds: p.cooldownSeconds, ...(reveal ? { devCode: code } : {}) }
}

/**
 * تایید کد: مقایسه‌ی زمان-ثابت با هشِ ذخیره.
 * شمارنده‌ی تلاش اتمیک است (INCR اول، بعد سقف — round-28): N درخواست موازی
 * دیگر همه attempts=0 نمی‌بینند و هر حدس دقیقاً یکی شمرده می‌شود.
 * این تابع عمداً خطا نمی‌اندازد: سرویس فراخوان، پیام و سیاست (پنجره‌ی مستقل خطای
 * تایید، پیام «چند تلاش مانده» و…) را خودش اعمال می‌کند.
 */
export async function verifyOtp(
  deps: { redis: RedisService },
  p: {
    phone: string
    code: string
    maxAttempts: number
    ttlSeconds: number
    keys: OtpKeys
  },
): Promise<OtpVerifyResult> {
  const { redis } = deps
  const { keys } = p

  const stored = await redis.get(keys.code(p.phone))
  if (!stored) return { ok: false, reason: 'no-code' }

  const attempts = await redis.incr(keys.attempts(p.phone))
  if (attempts === 1) await redis.expire(keys.attempts(p.phone), p.ttlSeconds)
  if (attempts > p.maxAttempts) {
    await redis.del(keys.code(p.phone))
    return { ok: false, reason: 'too-many' }
  }

  if (!safeEqual(stored, sha256(`${p.code}:${p.phone}`))) {
    return { ok: false, reason: 'mismatch', attemptsLeft: p.maxAttempts - attempts }
  }

  // درست بود → مصرف شود (کد + شمارنده؛ پنجره‌های خاص هر سرویس بیرون پاک می‌شوند)
  await redis.del(keys.code(p.phone))
  await redis.del(keys.attempts(p.phone))
  return { ok: true }
}