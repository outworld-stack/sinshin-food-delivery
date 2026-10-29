//src/infra/redis/redis.ts
/**
 * Redis — کلاینت بومی Bun (RedisClient).
 * گاردِ زمانِ انتظار روی همه‌ی عملیات: قطعی ردیس = تنزل، نه بن‌بست.
 */
import { RedisClient } from 'bun'
import { CANCEL_OTP, CONSUME_OTP, ISSUE_OTP } from './otp-scripts'

const OP_TIMEOUT_MS = 2_500
// رارد M3 — نشانگر timeout برای تفکیک از null واقعی در Promise.race
const CB_TIMEOUT = Symbol('cb-timeout')

export class RedisService {
  private readonly client: RedisClient
  private subscriber: RedisClient | null = null
  private readonly subscribed = new Set<string>()
  /** round-16 — کانال→هندلر برای اشتراکِ دوباره‌ی دوره‌ای (گاردِ انحراف پس از قطعی ردیس) */
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
  // رارد M3 — قطع‌کننده‌ی مدارِ کش: پس از ۵ خطای پیاپی، ۳۰ ثانیه مسیر کش
  // دور زده می‌شود (fail-fast به‌جای ۲.۵s زمان انتظار به‌ازای هر عملیات).
  private consecutiveFailures = 0
  private cacheOpenUntil = 0
  private static readonly CB_THRESHOLD = 5
  private static readonly CB_COOLDOWN_MS = 30_000

  private cbIsOpen(): boolean {
    return Date.now() < this.cacheOpenUntil
  }

  private cbRecord(ok: boolean): void {
    if (ok) {
      this.consecutiveFailures = 0
      return
    }
    this.consecutiveFailures += 1
    if (this.consecutiveFailures >= RedisService.CB_THRESHOLD) {
      this.cacheOpenUntil = Date.now() + RedisService.CB_COOLDOWN_MS
      this.consecutiveFailures = 0
      console.warn('[redis] cache circuit opened for 30s (consecutive failures)')
    }
  }

  async get(key: string): Promise<string | null> {
    if (this.cbIsOpen()) return null // رارد M3 — مدار باز
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const res = await Promise.race([
        this.client.get(key),
        new Promise<symbol>((resolve) => {
          timer = setTimeout(() => resolve(CB_TIMEOUT), OP_TIMEOUT_MS)
        }),
      ])
      // null واقعی (کلید ناموجود) = موفقیت؛ فقط timeout/error خطا شمرده می‌شود
      this.cbRecord(res !== CB_TIMEOUT)
      return res === CB_TIMEOUT || res === null ? null : (res as string)
    } catch {
      this.cbRecord(false)
      return null
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  async set(
    key: string,
    value: string,
    opts?: { ex?: number },
  ): Promise<string | null> {
    if (this.cbIsOpen()) return null // رارد M3 — مدار باز
    const op =
      opts?.ex !== undefined
        ? this.client.set(key, value, 'EX', opts.ex)
        : this.client.set(key, value)
    const res = await this.t<string | null>(op, null)
    this.cbRecord(res === 'OK') // رارد M3 — set هم در شمارش مدار
    return res
  }

  /**
   * SET ... NX — برای قفل‌ها.
   * true = گرفته شد | false = کسی دیگر دارد | null = ردیس در دسترس نیست
   * (تفکیک null از false تا فراخوان‌ها بتوانند شکست‌باز را انتخاب کنند)
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
      if (res === undefined) return null // زمان انتظار — ردیس معلق
      return res === 'OK'
    } catch {
      return null // خطا — ردیس پایین
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  /** Atomically reserve an unfinished scheduled period across API replicas. */
  async claimScheduledJob(leaseKey: string, doneKey: string, owner: string, ttlSeconds: number): Promise<boolean | null> {
    const script = `
      if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
      if redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2], 'NX') then return 1 end
      return 0
    `
    const result = await this.t<number | null>(this.client.send('EVAL', [
      script, '2', leaseKey, doneKey, owner, String(ttlSeconds),
    ]), null)
    return result === null ? null : result === 1
  }

  /** Only the owning execution can mark success or replace its lease with a retry delay. */
  async finishScheduledJob(input: {
    leaseKey: string; doneKey: string; owner: string; success: boolean
    doneTtlSeconds: number; retrySeconds: number
  }): Promise<boolean | null> {
    const script = `
      if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
      if ARGV[2] == '1' then
        redis.call('SET', KEYS[2], '1', 'EX', ARGV[3])
        redis.call('DEL', KEYS[1])
      else
        redis.call('SET', KEYS[1], 'retry', 'EX', ARGV[4])
      end
      return 1
    `
    const result = await this.t<number | null>(this.client.send('EVAL', [
      script, '2', input.leaseKey, input.doneKey, input.owner, input.success ? '1' : '0',
      String(input.doneTtlSeconds), String(input.retrySeconds),
    ]), null)
    return result === null ? null : result === 1
  }

  /**
   * رارد H4 — شمارش اعضای متمایز (ضد SMS-bombing): SADD + EXPIRE فقط بار اول.
   * true = عضو جدید | false = از قبل بود | null = ردیس پایین (fail-open)
   */
  async sAdd(key: string, member: string, ttlSeconds: number): Promise<boolean | null> {
    const added = await this.t<number | null>(this.client.send('SADD', [key, member]), null)
    if (added === null) return null
    if (added === 1) await this.t(this.client.send('EXPIRE', [key, String(ttlSeconds)]), 0)
    return added === 1
  }

  async sCard(key: string): Promise<number | null> {
    return this.t<number | null>(this.client.send('SCARD', [key]), null)
  }

  /** Admit an existing member or reserve a new slot in a fixed-window set.
   * Rejected members are never stored, so retrying cannot bypass the limit.
   * null preserves the caller's existing Redis-unavailable policy.
   */
  async sAddWithinLimit(
    key: string, member: string, limit: number, ttlSeconds: number,
  ): Promise<boolean | null> {
    const script = `
      if redis.call('SISMEMBER', KEYS[1], ARGV[1]) == 1 then return 1 end
      local count = redis.call('SCARD', KEYS[1])
      if count >= tonumber(ARGV[2]) then return 0 end
      redis.call('SADD', KEYS[1], ARGV[1])
      if count == 0 then redis.call('EXPIRE', KEYS[1], ARGV[3]) end
      return 1
    `
    const result = await this.t<number | null>(this.client.send('EVAL', [
      script, '1', key, member, String(limit), String(ttlSeconds),
    ]), null)
    return result === null ? null : result === 1
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

  async issueOtp(p: {
    keys: string[]
    value: string
    ttlSeconds: number
    cooldownSeconds: number
    maxPerHour: number
    maxPerDay?: number
  }): Promise<[string, number] | null> {
    return this.t(this.client.send('EVAL', [ISSUE_OTP, String(p.keys.length), ...p.keys,
      p.value, String(p.ttlSeconds), String(p.cooldownSeconds), String(p.maxPerHour),
      String(p.maxPerDay ?? Number.MAX_SAFE_INTEGER)]), null)
  }

  async consumeOtp(p: {
    keys: string[]
    hash: string
    maxAttempts: number
    ttlSeconds: number
    failureCap?: number
    failureWindowSeconds?: number
  }): Promise<[string, number, number] | null> {
    return this.t(this.client.send('EVAL', [CONSUME_OTP, String(p.keys.length), ...p.keys,
      p.hash, String(p.maxAttempts), String(p.ttlSeconds), String(p.failureCap ?? 0),
      String(p.failureWindowSeconds ?? 0)]), null)
  }

  async cancelOtp(keys: [string, string, string], value: string): Promise<void> {
    await this.t(this.client.send('EVAL', [CANCEL_OTP, '3', ...keys, value]), null)
  }

  // ── انتشار/اشتراک ──
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
      // round-28 — مسیر شکست هم پاک کند: وگرنه کانال‌هایی که در قطعی ردیس
      // subscribe شان شکست خورده برای همیشه در subHandlers می‌مانند و
      // حلقه‌ی اشتراکِ دوباره هر ۶۰ ثانیه برایشان تلاش می‌کند (نشتی بی‌سقف).
      // گاردِ «همان هندلر» برای هم‌زمانی با subscribe دوباره‌ی موازی.
      if (this.subHandlers.get(channel) === handler) this.subHandlers.delete(channel)
      console.error(`[redis] subscribe(${channel}) failed:`, err)
      return false
    } finally {
      // round-16 — تایمرِ زمان انتظار پس از تسویه پاک شود (نشت تایمر)
      if (timer) clearTimeout(timer)
    }
  }

  /**
   * round-16 — گاردِ انحراف: بعد از قطعی/ری‌کانکت ردیس، اتصال pub/sub ممکن است
   * بدون سابسکریپتون برگردد؛ SUBSCRIBE تکرارناپذیر است، پس هر ۶۰ ثانیه برای همهٔ
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
          /* هیچ‌کاری نمی‌کند — تیک بعدی */
        }
      }
    }, 60_000)
  }

  unsubscribe(channel: string): void {
    try {
      this.subscriber?.unsubscribe(channel)
    } catch {
      /* هیچ‌کاری نمی‌کند */
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
      /* هیچ‌کاری نمی‌کند */
    }
    try {
      this.subscriber?.close()
    } catch {
      /* هیچ‌کاری نمی‌کند */
    }
  }
}
