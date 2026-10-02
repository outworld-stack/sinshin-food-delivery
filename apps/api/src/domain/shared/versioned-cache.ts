//src/domain/shared/versioned-cache.ts
// کش نسخه‌دار ردیسی + single-flight — منبع واحد رارد ۴۸ (اسکن C2).
// این همان مکانیزمی است که perf-fix کار-۴ برای منو ساخت؛ حالا که مقالات
// هم همین الگو را لازم داشتند، یک‌جا شد تا دو سرویس از یک پیاده‌سازی
// بخوانند. قرارداد کلیدها بایت‌به‌بایت همان قبل است (menu:v{ver}:...).

import type { RedisService } from '#/infra/redis/redis'

export interface VersionedCacheOptions {
  redis: RedisService
  /** کلید شمارنده‌ی نسخه — مثلاً menu:ver */
  versionKey: string
  /** پیشوند کلیدهای داده — مثلاً menu */
  prefix: string
  ttlSeconds: number
}

/**
 * کش نسخه‌دار: کلید داده = {prefix}:v{ver}:{key} ؛ نامعتبرسازی = INCR نسخه.
 * بدون SCAN/پترن — ساده‌ترین مکانیزم با کمترین حالت خراب.
 *
 * single-flight: در لحظه‌ی expire (لحظه‌ی پیک‌ترافیک) ده‌ها request موازی
 * همزمان miss می‌زنند و بدون این، همه loader را اجرا می‌کردند (thundering
 * herd روی DB). اولین miss صاحب یک promise درون‌حافظه‌ای است و بقیه به
 * همان نتیجه می‌پیوندند.
 */
export class VersionedCache {
  private readonly inflight = new Map<string, Promise<unknown>>()

  constructor(private readonly opts: VersionedCacheOptions) { }

  private async version(): Promise<number> {
    const v = await this.opts.redis.get(this.opts.versionKey)
    return v ? Number(v) || 0 : 0
  }

  /** مقدار null کش نمی‌شود — miss تازه می‌ماند تا پرسیده شود */
  async cached<T extends object>(key: string, loader: () => Promise<T>): Promise<T> {
    const ver = await this.version()
    const k = `${this.opts.prefix}:v${ver}:${key}`
    const hit = await this.opts.redis.getJson<T>(k)
    if (hit !== null) return hit
    return this.joinFlight(k, async () => {
      const value = await loader()
      await this.opts.redis.setJson(k, value, { ex: this.opts.ttlSeconds })
      return value
    })
  }

  /** نسخه‌ی null-پذیر — مقدار null کش نمی‌شود (مثل قبل) ولی پرواز مشترک می‌ماند */
  async cachedNullable<T extends object>(key: string, loader: () => Promise<T | null>): Promise<T | null> {
    const ver = await this.version()
    const k = `${this.opts.prefix}:v${ver}:${key}`
    const hit = await this.opts.redis.getJson<T>(k)
    if (hit !== null) return hit
    return this.joinFlight(k, async () => {
      const value = await loader()
      if (value !== null) {
        await this.opts.redis.setJson(k, value, { ex: this.opts.ttlSeconds })
      }
      return value
    })
  }

  private async joinFlight<T>(k: string, run: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(k) as Promise<T> | undefined
    if (existing) return existing
    const p = (async () => {
      try {
        return await run()
      } finally {
        this.inflight.delete(k)
      }
    })()
    this.inflight.set(k, p)
    return p
  }

  /** هر write — یک بار؛ همه‌ی کلیدهای آن نسخه در دفع بعد دور می‌ریزند */
  async invalidate(): Promise<void> {
    await this.opts.redis.incr(this.opts.versionKey)
  }
}