// src/http/hooks/ip-rate-limit.ts
import type { RedisService } from '#/infra/redis/redis'
import { Err } from '#/domain/shared/errors'
import { clientIp } from '#/domain/shared/net'

export interface RateLimitOptions {
  redis: RedisService
  scope: string
  limit: number
  windowSeconds: number
}

/**
 * محدودیت IP — به‌صورت beforeHandle «اختصاصی هر روت».
 * (نسخه‌ی plugin با .use وسط زنجیره، به روت‌های بعدی هم نشت می‌کرد و
 *  سقف‌ها روی هم جمع می‌شدند — این نسخه فقط روتِ خودش را می‌شمارد.)
 * پنجره‌ی لغزان: هر درخواستِ مجاز TTL را تمدید می‌کند.
 *
 * phase-1:
 *   • IP = آخرین entry های XFF (نوشته‌ی Caddy؛ اولین entry جعلی است)
 *   • fail-closed: قطعی Redis = رد درخواست. بدون rate-limit، روت‌های OTP
 *     در معرض هزینه‌ی SMS و brute-force اند؛ خاموشیِ بی‌صدا ممنوع.
 */
export const ipRateLimit = (opts: RateLimitOptions) => {
  return async ({ request }: { request: Request }): Promise<void> => {
    const ip = clientIp(request.headers.get('x-forwarded-for')) ?? 'local'
    const key = `rl:${opts.scope}:${ip}`

    let count: number
    try {
      count = await opts.redis.incr(key)
    } catch {
      // RedisService خطا را پرتاب کرد → fail-closed
      throw Err.serviceUnavailable()
    }
    if (!Number.isFinite(count) || count < 1) {
      // RedisService خطا را قورت داده و مقدار بی‌معنا برگردانده → fail-closed
      // (incr همیشه ≥ 1 برمی‌گرداند؛ هر چیز دیگر یعنی خرابی)
      throw Err.serviceUnavailable()
    }

    try {
      if (count === 1 || count <= opts.limit) {
        await opts.redis.expire(key, opts.windowSeconds)
      }
    } catch {
      // expire خطا خورد — درخواست را می‌گذریم؛ اگر Redis واقعاً مرده باشد
      // incr بالا قبل از این‌جا fail-closed کرده است
    }

    if (count > opts.limit) {
      throw Err.rateLimited(
        'درخواست‌های شما زیاد است؛ کمی بعد دوباره تلاش کنید.',
        opts.windowSeconds,
      )
    }
  }
}