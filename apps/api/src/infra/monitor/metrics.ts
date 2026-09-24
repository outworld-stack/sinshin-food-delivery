// src/infra/monitor/metrics.ts
/**
 * round-18 — سنجه‌های درون‌فرآیندی، بدون هیچ وابستگی خارجی.
 *
 * طراحی:
 *  • شمارنده‌های پنجره‌ای روی هیستوگرام دایره‌ایِ «ثانیه‌ای» — حافظهٔ O(1)،
 *    بدون فشار GC؛ یک نمونه برای درخواست‌ها و یکی برای خطاهای 5xx.
 *  • تاخیر پاسخ روی حلقهٔ محدود (۵۱۲ نمونه) — صدک‌ها فقط موقع snapshot.
 *  • تاخیر حلقهٔ رویداد: تاخیر خودِ تیکِ ۵ ثانیه‌ای نسبت به زمان انتظار —
 *    بلاک‌بودن حلقه (کوئری همگام سنگین، GC طولانی، …) دیر‌کردن تیک را
 *    مستقیم نشان می‌دهد.
 *  • نقطهٔ شروع هر درخواست در WeakMap — عمرش به عمر خودِ Request بسته است،
 *    نشتی حافظه ممکن نیست.
 *
 * همه‌ی متدها غیر-پرتاب‌اند: مانیتورینگ هرگز نباید مسیر سرو‌دهی را
 * زمین بزند (سخت‌ترین قرارداد این ریپو).
 */
import type { HttpMetricsDto, ProcessMetricsDto } from '@sinshin/shared'

const WINDOW_SECONDS = 300 // بزرگ‌ترین پنجره‌ی گزارش‌گیری (۵ دقیقه)
const LATENCY_CAPACITY = 512 // نمونه‌های تازگی تاخیر — ۵۱۲ پاسخ آخر
const LAG_SAMPLE_MS = 5_000
const LAG_SAMPLE_PRECISION = 10 // یک رقم اعشار

/** شمارنده‌ی پنجره‌ای — هیستوگرام دایره‌ای per-second، پرس‌وجوی چند پنجره‌ای */
class SlidingCounter {
  private readonly counts: Uint32Array
  /** مهرِ ثانیه‌ی هر خانه — برای تشخیص خانه‌های کهنه (Uint32 تا ۲۱۰۶) */
  private readonly stamps: Uint32Array
  private _total = 0

  constructor(private readonly maxSeconds: number) {
    this.counts = new Uint32Array(maxSeconds)
    this.stamps = new Uint32Array(maxSeconds)
  }

  hit(nowMs = Date.now()): void {
    const second = Math.floor(nowMs / 1000)
    const slot = second % this.maxSeconds
    if (this.stamps[slot] !== second) {
      this.stamps[slot] = second
      this.counts[slot] = 0
    }
    this.counts[slot] = (this.counts[slot] ?? 0) + 1
    this._total++
  }

  /** تعداد رویدادها در «lastSeconds» ثانیهٔ منتهی به اکنون */
  count(lastSeconds: number, nowMs = Date.now()): number {
    const second = Math.floor(nowMs / 1000)
    const span = Math.min(lastSeconds, this.maxSeconds)
    let sum = 0
    for (let k = 0; k < span; k++) {
      const slot = (second - k) % this.maxSeconds
      if (this.stamps[slot] === second - k) sum += this.counts[slot] ?? 0
    }
    return sum
  }

  get total(): number {
    return this._total
  }
}

/** حلقه‌ی محدود تاخیر — صدک‌ها فقط روی کپی مرتب‌شده در لحظه‌ی snapshot */
class LatencyRing {
  private readonly samples: Float64Array
  private index = 0
  private filled = 0

  constructor(private readonly capacity: number) {
    this.samples = new Float64Array(capacity)
  }

  push(ms: number): void {
    this.samples[this.index] = ms
    this.index = (this.index + 1) % this.capacity
    this.filled = Math.min(this.filled + 1, this.capacity)
  }

  snapshot(): { p50: number; p95: number; max: number } | null {
    if (this.filled === 0) return null
    const active = Array.from(
      this.filled === this.capacity ? this.samples : this.samples.subarray(0, this.filled),
    ).sort((a, b) => a - b)
    const at = (percentile: number): number =>
      active[Math.min(active.length - 1, Math.ceil(active.length * percentile) - 1)] ?? 0
    return { p50: at(0.5), p95: at(0.95), max: active[active.length - 1] ?? 0 }
  }
}

export class MetricsService {
  private readonly requests = new SlidingCounter(WINDOW_SECONDS)
  private readonly errors5xx = new SlidingCounter(WINDOW_SECONDS)
  private readonly latency = new LatencyRing(LATENCY_CAPACITY)
  private readonly startedAt = new WeakMap<Request, number>()
  private lagMs = 0
  private lagTimer: ReturnType<typeof setInterval> | null = null

  /** در onRequest — ثبت لحظهٔ شروع (در ابعاد حافظهٔ WeakMap) */
  observeRequest(request: Request): void {
    this.startedAt.set(request, performance.now())
  }

  /**
   * در onAfterResponse — پایان درخواست. اگر onRequest دیده نشده باشد
   * (هوک جاافتاده)، فقط شمرده می‌شود؛ نمونه‌ی تاخیر ثبت نمی‌شود.
   */
  observeResponse(request: Request, status: number): void {
    this.requests.hit()
    if (status >= 500) this.errors5xx.hit()
    const t0 = this.startedAt.get(request)
    if (t0 !== undefined) this.latency.push(performance.now() - t0)
  }

  start(): void {
    if (this.lagTimer) return
    // تکنیک استاندارد: تاخیر خودِ تیک. اگر حلقه بلاک باشد، تیک دیر
    // صادر می‌شود و فاصله تا «زیر انتظار» = مقدار بلاک. (توجه: تیک
    // طی بلاک اصلاً صادر نمی‌شود، پس صف‌شدن setImmediate چیزی نشان
    // نمی‌داد — این روش هر بلاکی را می‌گیرد.)
    let expectedAt = performance.now() + LAG_SAMPLE_MS
    this.lagTimer = setInterval(() => {
      const now = performance.now()
      const lag = now - expectedAt
      this.lagMs = lag > 0 ? Math.round(lag * LAG_SAMPLE_PRECISION) / LAG_SAMPLE_PRECISION : 0
      expectedAt = now + LAG_SAMPLE_MS
    }, LAG_SAMPLE_MS)
  }

  stop(): void {
    if (this.lagTimer) clearInterval(this.lagTimer)
    this.lagTimer = null
  }

  snapshot(): { process: ProcessMetricsDto; http: HttpMetricsDto } {
    const mem = process.memoryUsage()
    const mb = (bytes: number): number => Math.round((bytes / 1048576) * 10) / 10
    return {
      process: {
        rssMB: mb(mem.rss),
        heapUsedMB: mb(mem.heapUsed),
        heapTotalMB: mb(mem.heapTotal),
        externalMB: mb(mem.external),
        eventLoopLagMs: this.lagMs,
      },
      http: {
        totalRequests: this.requests.total,
        totalErrors: this.errors5xx.total,
        requestsLast1m: this.requests.count(60),
        requestsLast5m: this.requests.count(WINDOW_SECONDS),
        errorsLast1m: this.errors5xx.count(60),
        errorsLast5m: this.errors5xx.count(WINDOW_SECONDS),
        latencyMs: this.latency.snapshot(),
      },
    }
  }
}
