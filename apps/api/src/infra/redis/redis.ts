//src/infra/redis/redis.ts
/**
 * Redis — کلاینت بومی Bun (RedisClient).
 * timeout-guard روی همه‌ی عملیات: قطعی ردیس = degrade، نه deadlock.
 */
import { RedisClient } from 'bun'

const OP_TIMEOUT_MS = 2_500

export class RedisService {
  private readonly client: RedisClient
  private subscriber: RedisClient | null = null
  private readonly subscribed = new Set<string>()
  /** round-16 — کانال→هندلر برای re-subscribe دوره‌ای (drift guard پس از قطعی ردیس) */
  private readonly subHandlers = new Map<string, (message: string) => void>()
  private resubTimer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly url: string) {
    this.client = new RedisClient(url)
  }

  private async t<T>(op: Promise<T>, fallback: T): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        op,
        new Promise<T>((resolve) => {
          timer = setTimeout(() => resolve(fallback), OP_TIMEOUT_MS)
        }),
      ])
    } catch {
      return fallback
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  async connect(): Promise<boolean> {
    const res = await this.t<string | null>(this.client.set('health:boot', '1'), null)
    return res === 'OK'
  }

  async ping(): Promise<boolean> {
    const res = await this.t<string | null>(this.client.set('health:ping', '1'), null)
    return res === 'OK'
  }

  // ── کش ──
  async get(key: string): Promise<string | null> {
    return this.t<string | null>(this.client.get(key), null)
  }

  async set(
    key: string,
    value: string,
    opts?: { ex?: number },
  ): Promise<string | null> {
    const op =
      opts?.ex !== undefined
        ? this.client.set(key, value, 'EX', opts.ex)
        : this.client.set(key, value)
    return this.t<string | null>(op, null)
  }

  /**
   * SET ... NX — برای قفل‌ها.
   * true = گرفته شد | false = کسی دیگر دارد | null = ردیس در دسترس نیست
   * (تفکیک null از false تا caller ها بتوانند fail-open انتخاب کنند)
   */
  async setNx(key: string, value: string, opts: { ex: number }): Promise<boolean | null> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const res = await Promise.race([
        this.client.send('SET', [key, value, 'EX', String(opts.ex), 'NX']),
        new Promise<undefined>((resolve) => {
          timer = setTimeout(() => resolve(undefined), OP_TIMEOUT_MS)
        }),
      ])
      if (res === undefined) return null // timeout — ردیس معلق
      return res === 'OK'
    } catch {
      return null // خطا — ردیس پایین
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.get(key)
    if (raw === null) return null
    try {
      return JSON.parse(raw) as T
    } catch {
      return null
    }
  }

  async setJson(key: string, value: unknown, opts?: { ex?: number }): Promise<void> {
    await this.set(key, JSON.stringify(value), opts)
  }

  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) return 0
    return this.t<number>(this.client.del(...keys), 0)
  }

  async exists(key: string): Promise<boolean> {
    const raw = await this.t<string | number | null>(this.client.send('EXISTS', [key]), null)
    return Number(raw) === 1
  }

  async incr(key: string): Promise<number> {
    const raw = await this.t<string | number | null>(this.client.send('INCR', [key]), null)
    const n = Number(raw)
    return Number.isFinite(n) ? n : 0
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    const raw = await this.t<string | number | null>(
      this.client.send('EXPIRE', [key, String(seconds)]),
      null,
    )
    return Number(raw) === 1
  }

  // ── pub/sub ──
  async publish(channel: string, message: string): Promise<number> {
    return this.t<number>(this.client.publish(channel, message), 0)
  }

  async subscribe(
    channel: string,
    handler: (message: string) => void,
  ): Promise<boolean> {
    this.subHandlers.set(channel, handler)
    if (this.subscribed.has(channel)) return true
    if (!this.subscriber) this.subscriber = new RedisClient(this.url)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        this.subscriber.subscribe(channel, handler),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('subscribe timeout')), OP_TIMEOUT_MS)
        }),
      ])
      this.subscribed.add(channel)
      this.startResubscribeLoop()
      return true
    } catch (err) {
      console.error(`[redis] subscribe(${channel}) failed:`, err)
      return false
    } finally {
      // round-16 — تایمر timeout پس از settle پاک شود (نشت تایمر)
      if (timer) clearTimeout(timer)
    }
  }

  /**
   * round-16 — drift guard: بعد از قطعی/ری‌کانکت ردیس، اتصال pub/sub ممکن است
   * بدون سابسکریپتون برگردد؛ SUBSCRIBE ایدمپوتنت است، پس هر ۶۰ ثانیه برای همهٔ
   * کانال‌های ثبت‌شده دوباره صادر می‌شود (خطا بی‌صدا — تیک بعدی دوباره می‌کوشد).
   */
  private startResubscribeLoop(): void {
    if (this.resubTimer) return
    this.resubTimer = setInterval(() => {
      const sub = this.subscriber
      if (!sub || this.subHandlers.size === 0) return
      for (const [channel, handler] of this.subHandlers) {
        try {
          void Promise.resolve(sub.subscribe(channel, handler)).catch(() => {})
        } catch {
          /* noop — تیک بعدی */
        }
      }
    }, 60_000)
  }

  unsubscribe(channel: string): void {
    try {
      this.subscriber?.unsubscribe(channel)
    } catch {
      /* noop */
    }
    this.subscribed.delete(channel)
    this.subHandlers.delete(channel)
  }

  async close(): Promise<void> {
    if (this.resubTimer) {
      clearInterval(this.resubTimer)
      this.resubTimer = null
    }
    try {
      this.client.close()
    } catch {
      /* noop */
    }
    try {
      this.subscriber?.close()
    } catch {
      /* noop */
    }
  }
}