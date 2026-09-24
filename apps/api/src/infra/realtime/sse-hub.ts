/**
 * SSE hub — fan-out محلی + پل Redis pub/sub بین رپلیکاها.
 *
 * امروز (یک رپلیکای api): publish() همان‌جا fan-out می‌کند.
 * فردا (پشت LB، N رپلیکا): هر رپلیکا پیام را هم به Redis می‌فرستد؛
 * هر رپلیکایی که مشترکِ محلی دارد از Redis دریافت و به مشتریانِ خودش می‌رساند.
 * تحویل تکراری ندارد: هر پیام Redis با src (شناسه‌ی همین نمونه) می‌آید.
 *
 * کانال‌ها: demo:* (تست) | orders:new | orders:{displayId|uuid}
 *
 * phase-1: refcount — آخرین مشترکِ محلیِ یک کانال، اشتراک Redis را هم می‌بندد.
 * قبلاً اشتراک Redis برای همیشه باز می‌ماند؛ با کانال‌های orders:{id}
 * (یکی به‌ازای هر سفارش) این یعنی نشتیِ بی‌سقف.
 */
import type { RedisService } from '#/infra/redis/redis'

export interface SsePayload {
  event: string
  data: unknown
}

export type SseSubscriber = (payload: SsePayload) => void

const INSTANCE_ID = crypto.randomUUID()

export class SseHub {
  private readonly channels = new Map<string, Set<SseSubscriber>>()
  private readonly relayed = new Set<string>()

  constructor(private readonly redis: RedisService) {}

  /** تابع لغو اشتراک برمی‌گرداند */
  subscribe(channel: string, subscriber: SseSubscriber): () => void {
    let set = this.channels.get(channel)
    const firstLocal = !set
    if (!set) {
      set = new Set()
      this.channels.set(channel, set)
    }
    set.add(subscriber)

    // اولین مشترکِ محلی → اشتراک Redis برای این کانال
    if (firstLocal && !this.relayed.has(channel)) {
      this.relayed.add(channel)
      void this.redis.subscribe(`sse:${channel}`, (raw) => {
        try {
          const msg = JSON.parse(raw) as SsePayload & { src?: string }
          if (msg.src === INSTANCE_ID) return // خودمان local رساندیم
          this.fanout(channel, { event: msg.event, data: msg.data })
        } catch (err) {
          console.error('[sse] پیام خراب از redis:', err)
        }
      }).then((ok) => {
        if (!ok) {
          this.relayed.delete(channel) // مشترک بعدی دوباره تلاش می‌کند
          return
        }
        // race-guard: اگر در فاصله‌ی resolve شدن subscribe، آخرین مشترک محلی رفته باشد
        if (!this.channels.has(channel)) {
          this.relayed.delete(channel)
          this.redis.unsubscribe(`sse:${channel}`)
        }
      })
    }

    // ── phase-1: refcount ──
    return () => {
      const s = this.channels.get(channel)
      s?.delete(subscriber)
      if (s && s.size === 0) {
        this.channels.delete(channel)
        if (this.relayed.has(channel)) {
          this.relayed.delete(channel)
          this.redis.unsubscribe(`sse:${channel}`)
        }
      }
    }
  }

  publish(channel: string, payload: SsePayload): void {
    // ۱) فوری برای مشترکان همین رپلیکا
    this.fanout(channel, payload)
    // ۲) پل برای بقیه‌ی رپلیکاها — fire-and-forget
    void this.redis.publish(
      `sse:${channel}`,
      JSON.stringify({ src: INSTANCE_ID, event: payload.event, data: payload.data }),
    )
  }

  subscriberCount(channel: string): number {
    return this.channels.get(channel)?.size ?? 0
  }

  /** round-18 — برای /health/metrics: حجم پره‌های فعال محلی */
  stats(): { channels: number; subscribers: number } {
    let subscribers = 0
    for (const set of this.channels.values()) subscribers += set.size
    return { channels: this.channels.size, subscribers }
  }

  private fanout(channel: string, payload: SsePayload): void {
    const set = this.channels.get(channel)
    if (!set) return
    for (const subscriber of set) {
      try {
        subscriber(payload)
      } catch (err) {
        console.error('[sse] subscriber خطا داد:', err)
      }
    }
  }
}