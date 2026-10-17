// ═══════════════════════════════════════════════════════════════
// phase-2 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/domain/shared/otp-core.ts
// وضعیت: جایگزینی کامل فایل موجود (پایه: نسخه‌ی رارد ۴۸)
// تغییر: smsText(متن آزاد) → sendSms(قالب) — معماری SMS.ir
// ═══════════════════════════════════════════════════════════════

//src/domain/shared/otp-core.ts
// هسته‌ی مشترک جریان OTP روی ردیس — منبع واحد رارد ۴۸ (اسکن A2).
// پیش از این، OtpService اصلی و مسیر پیک هر دو همین مکانیزم را جدا می‌نوشتند
// و نسخه‌ی پیک روی گیتِ غیراتمیکِ قدیمی (exists→set) مانده بود: دو درخواست
// هم‌زمان هر دو از exists رد می‌شدند → دو پیامک + بازنویسی کد.
// سیاست‌های متفاوت (پنجره‌ی خطای تاییدِ کاربر، توکن پیک، متن پیام‌ها)
// بیرون از هسته می‌مانند — هسته فقط مکانیزم است.
//
// فاز-۲: پیامک حالا «قالب‌محور» است (SMS.ir verify). به‌جای smsText که
// متن آزاد می‌ساخت، فراخوان‌کننده sendSms تزریق می‌کند — بسته به اینکه
// کد برای کاربر است یا پیک، قالب درست را انتخاب می‌کند. هسته همچنان
// به SMS.ir وابسته نیست (فقط boolean می‌گیرد).

import type { RedisService } from '#/infra/redis/redis'
import { Err } from '#/domain/shared/errors'
import { randomOtpCode, randomToken, sha256 } from '#/domain/shared/crypto'

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
  /**
   * فاز-۲ — ارسال کد با قالب SMS.ir (verify).
   * فراخوان‌کننده تزریق می‌کند: کاربر → قالب otp، پیک → قالب courier-otp.
   */
  sendSms: (phone: string, code: string) => Promise<boolean>
  isProd: boolean
}

/** نتیجه‌ی تایید — سرویس فراخوان، خطا و سیاست‌های خاص خودش را رویش می‌سازد */
export type OtpVerifyResult =
  | { ok: true }
  | { ok: false; reason: 'no-code' }
  | { ok: false; reason: 'too-many' }
  | { ok: false; reason: 'locked'; retryAfterSeconds: number }
  | { ok: false; reason: 'mismatch'; attemptsLeft: number }

/**
 * ارسال کد: سقف‌ها → گیت اتمیک کول‌داون → ذخیره‌ی هش → شمارنده‌ها → پیامک.
 * ترتیب گاردها: سقف‌ها قبل از گیت — ردِ سقف، گیتِ کول‌داون را نگرفته باشد.
 */
export async function sendOtp(
  deps: { redis: RedisService },
  p: SendOtpParams,
): Promise<{ cooldownSeconds: number; devCode?: string }> {
  const { redis } = deps
  const { keys, messages } = p

  const code = randomOtpCode(6)
  const value = `${sha256(`${code}:${p.phone}`)}:${randomToken(16)}`
  const challengeKeys: [string, string, string] = [
    keys.code(p.phone), keys.cooldown(p.phone), keys.attempts(p.phone),
  ]
  // Reserve cooldown, challenge and fixed-window budgets in one operation.
  const issued = await redis.issueOtp({
    keys: [...challengeKeys, keys.hour(p.phone), ...(keys.day ? [keys.day(p.phone)] : [])],
    value,
    ttlSeconds: p.ttlSeconds,
    cooldownSeconds: p.cooldownSeconds,
    maxPerHour: p.maxPerHour,
    maxPerDay: p.maxPerDay,
  })
  if (!issued) throw Err.serviceUnavailable(messages.storeFail)
  const [status, retryAfter] = issued
  if (status === 'hour') throw Err.rateLimited(messages.hourCap, retryAfter)
  if (status === 'day') throw Err.rateLimited(messages.dayCap ?? messages.hourCap, retryAfter)
  if (status === 'cooldown') {
    throw Err.rateLimited(messages.cooldown(retryAfter), retryAfter)
  }
  if (status !== 'ok') throw Err.serviceUnavailable(messages.storeFail)

  let sent: boolean
  try {
    sent = await p.sendSms(p.phone, code)
  } catch {
    await redis.cancelOtp(challengeKeys, value)
    throw Err.internal(messages.smsFail)
  }
  if (!sent && p.isProd) {
    await redis.cancelOtp(challengeKeys, value)
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
 * Code consumption, attempts and the optional cross-code failure window are
 * atomic. Verification outcomes are returned; Redis unavailability throws 503.
 */
export async function verifyOtp(
  deps: { redis: RedisService },
  p: {
    phone: string
    code: string
    maxAttempts: number
    ttlSeconds: number
    keys: OtpKeys
    failureWindow?: { key: string; cap: number; ttlSeconds: number }
  },
): Promise<OtpVerifyResult> {
  const { redis } = deps
  const { keys } = p

  const result = await redis.consumeOtp({
    keys: [keys.code(p.phone), keys.attempts(p.phone),
      ...(p.failureWindow ? [p.failureWindow.key] : [])],
    hash: sha256(`${p.code}:${p.phone}`),
    maxAttempts: p.maxAttempts,
    ttlSeconds: p.ttlSeconds,
    failureCap: p.failureWindow?.cap,
    failureWindowSeconds: p.failureWindow?.ttlSeconds,
  })
  if (!result) throw Err.serviceUnavailable()
  const [status, attemptsLeft, retryAfterSeconds] = result
  switch (status) {
    case 'ok': return { ok: true }
    case 'no-code': return { ok: false, reason: 'no-code' }
    case 'too-many': return { ok: false, reason: 'too-many' }
    case 'locked': return { ok: false, reason: 'locked', retryAfterSeconds }
    case 'mismatch': return { ok: false, reason: 'mismatch', attemptsLeft }
    default: throw Err.serviceUnavailable()
  }
}
