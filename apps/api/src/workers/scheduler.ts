// src/workers/scheduler.ts
import type { RedisService } from '#/infra/redis/redis'

export interface DailyJob {
  /** یکتا و پایدار — در کلید قفل و لاگ‌ها */
  name: string
  /** «HH:MM» به وقت Asia/Tehran */
  time: string
  /** اگر امروز از دست رفت، موقع boot اجرا شود */
  catchUp?: boolean
  run: () => Promise<void>
}

// ── phase-2: job بازه‌ای — هر N ثانیه، بین رپلیکاها فقط یک‌بار ──
export interface IntervalJob {
  /** یکتا و پایدار — در کلید قفل و لاگ‌ها */
  name: string
  /** فاصله‌ی اجرا به ثانیه */
  everySeconds: number
  run: () => Promise<void>
}

const LOCK_TTL_SECONDS = 6 * 60 * 60
const TICK_MS = 30_000

type BunCronFn = (
  schedule: string,
  fn: () => void,
  opts?: { name?: string },
) => { stop(): void; start(): void }

const tehranNow = (): { date: string; hm: string } => {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date()).map((p) => [p.type, p.value]),
  ) as Record<string, string>
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hm: `${parts.hour}:${parts.minute}`,
  }
}

/**
 * زمان‌بند روزانه + بازه‌ای — ساعت تهران.
 *  - Bun.cron به‌عنوان تایمر (TZ=Asia/Tehran در Docker)
 *  - قفل Redis با SET NX + کلید (job، تاریخ/پنجره) → با N رپلیکا دقیقاً یک‌بار
 *  - catchUp: job های روزانه‌ی ازدست‌رفته موقع boot اجرا می‌شوند
 *  - interval ها مستقل از Bun.cron همیشه روشن‌اند
 *  - اگر Bun.cron نبود → تیک ۳۰ ثانیه‌ای
 */
export class CronScheduler {
  private readonly jobs: DailyJob[] = []
  private readonly running = new Set<string>()
  private bunJobs: Array<{ stop(): void }> = []
  private tickTimer: ReturnType<typeof setInterval> | null = null
  // phase-2
  private readonly intervalJobs: IntervalJob[] = []
  private intervalTimers: Array<ReturnType<typeof setInterval>> = []

  constructor(private readonly redis: RedisService) { }

  register(job: DailyJob): void {
    this.jobs.push(job)
    console.log(`[cron] registered "${job.name}" at ${job.time} Asia/Tehran`)
  }

  /** phase-2 — ثبت job بازه‌ای؛ قبل از start() صدا شود */
  registerInterval(job: IntervalJob): void {
    this.intervalJobs.push(job)
    console.log(`[cron] registered interval "${job.name}" every ${job.everySeconds}s`)
  }

  async start(): Promise<void> {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (tz !== 'Asia/Tehran') {
      console.warn(
        `[cron] process timezone is "${tz}", expected Asia/Tehran (Docker sets TZ=Asia/Tehran)`,
      )
    }

    // ── جبران slot های ازدست‌رفته‌ی امروز ──
    const { date, hm } = tehranNow()
    for (const job of this.jobs) {
      if (!job.catchUp || hm < job.time) continue
      if (await this.tryLock(`cron:lock:${job.name}:${date}`)) {
        console.log(`[cron] catch-up run for "${job.name}"`)
        void this.execute(job)
      }
    }

    // ── phase-2: job های بازه‌ای — مستقل از Bun.cron، همیشه روشن ──
    for (const job of this.intervalJobs) {
      this.intervalTimers.push(
        setInterval(() => void this.fireInterval(job), job.everySeconds * 1000),
      )
    }
    if (this.intervalJobs.length > 0) {
      console.log(`[cron] ${this.intervalJobs.length} interval job(s) running`)
    }

    // ── زمان‌بندی روزانه ──
    const bunCron = (Bun as unknown as { cron?: BunCronFn }).cron
    if (typeof bunCron === 'function') {
      let ok = true
      for (const job of this.jobs) {
        const [h, m] = job.time.split(':').map(Number)
        if (!Number.isFinite(h) || !Number.isFinite(m)) {
          ok = false
          break
        }
        try {
          this.bunJobs.push(
            bunCron(`${m} ${h} * * *`, () => void this.fire(job), { name: job.name }),
          )
        } catch {
          ok = false
          break
        }
      }
      if (ok) {
        console.log(`[cron] ${this.jobs.length} job(s) scheduled via Bun.cron`)
        return
      }
      for (const j of this.bunJobs) {
        try {
          j.stop()
        } catch {
          /* noop */
        }
      }
      this.bunJobs = []
    }

    console.warn('[cron] Bun.cron unavailable — falling back to 30s tick')
    this.startTick()
  }

  stop(): void {
    for (const j of this.bunJobs) {
      try {
        j.stop()
      } catch {
        /* noop */
      }
    }
    this.bunJobs = []
    if (this.tickTimer) clearInterval(this.tickTimer)
    this.tickTimer = null
    // phase-2
    for (const t of this.intervalTimers) clearInterval(t)
    this.intervalTimers = []
  }

  private startTick(): void {
    if (this.tickTimer) return
    this.tickTimer = setInterval(() => {
      const { hm } = tehranNow()
      for (const job of this.jobs) {
        if (hm === job.time) void this.fire(job)
      }
    }, TICK_MS)
  }

  private async fire(job: DailyJob): Promise<void> {
    const { date } = tehranNow()
    if (!(await this.tryLock(`cron:lock:${job.name}:${date}`))) return
    void this.execute(job)
  }

  /** phase-2 — قفل per-window: با N رپلیکا فقط یکی اجرا می‌شود */
  private async fireInterval(job: IntervalJob): Promise<void> {
    const window = Math.floor(Date.now() / 1000 / job.everySeconds)
    if (!(await this.tryLock(`cron:ilock:${job.name}:${window}`))) return
    void this.execute(job)
  }

  /** SET ... NX — فقط اگر کسی قبل از ما نزد بود (null = ردیس پایین → قفل گرفته نشده) */
  private async tryLock(lockKey: string): Promise<boolean> {
    try {
      return (await this.redis.setNx(lockKey, '1', { ex: LOCK_TTL_SECONDS })) === true
    } catch {
      // ردیس پایین → fail-closed؛ تیک بعدی دوباره می‌آید
      return false
    }
  }

  // phase-2: امضای عمومی‌تر — DailyJob و IntervalJob هر دو جا می‌شوند
  private async execute(job: { name: string; run: () => Promise<void> }): Promise<void> {
    if (this.running.has(job.name)) return
    this.running.add(job.name)
    const t0 = performance.now()
    try {
      await job.run()
      console.log(`[cron] "${job.name}" finished in ${(performance.now() - t0).toFixed(0)}ms`)
    } catch (err) {
      console.error(`[cron] "${job.name}" FAILED:`, err)
    } finally {
      this.running.delete(job.name)
    }
  }
}