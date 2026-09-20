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

  /** SET ... NX — برای قفل‌ها */
  async setNx(key: string, value: string, opts: { ex: number }): Promise<boolean> {
    try {
      const res = await this.client.send('SET', [
        key,
        value,
        'EX',
        String(opts.ex),
        'NX',
      ])
      return res === 'OK'
    } catch {
      return false
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
    try {
      return Number(await this.client.send('EXISTS', [key])) === 1
    } catch {
      return false
    }
  }

  async incr(key: string): Promise<number> {
    try {
      return Number(await this.client.send('INCR', [key]))
    } catch {
      return 0
    }
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    try {
      return Number(await this.client.send('EXPIRE', [key, String(seconds)])) === 1
    } catch {
      return false
    }
  }

  // ── pub/sub ──
  async publish(channel: string, message: string): Promise<number> {
    return this.t<number>(this.client.publish(channel, message), 0)
  }

  async subscribe(
    channel: string,
    handler: (message: string) => void,
  ): Promise<boolean> {
    if (this.subscribed.has(channel)) return true
    if (!this.subscriber) this.subscriber = new RedisClient(this.url)
    try {
      await Promise.race([
        this.subscriber.subscribe(channel, handler),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('subscribe timeout')), OP_TIMEOUT_MS),
        ),
      ])
      this.subscribed.add(channel)
      return true
    } catch (err) {
      console.error(`[redis] subscribe(${channel}) failed:`, err)
      return false
    }
  }

  unsubscribe(channel: string): void {
    try {
      this.subscriber?.unsubscribe(channel)
    } catch {
      /* noop */
    }
    this.subscribed.delete(channel)
  }

  async close(): Promise<void> {
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