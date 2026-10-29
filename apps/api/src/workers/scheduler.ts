// src/workers/scheduler.ts
import type { JobRunRecorder } from '#/infra/monitor/job-registry'
import type { RedisService } from '#/infra/redis/redis'

export interface DailyJob {
  /** یکتا و پایدار — در کلید قفل و لاگ‌ها */
  name: string
  /** «HH:MM» به وقت Asia/Tehran */
  time: string
  /** اگر امروز از دست رفت، موقع boot اجرا شود */
  catchUp?: boolean
  /** Retry/catch up this period until success. Omit weekday for a daily job (0 = Sunday). */
  recovery?: { weekday?: 0 | 1 | 2 | 3 | 4 | 5 | 6 }
  run: () => Promise<void>
}

// ── phase-2: کارِ بازه‌ای — هر N ثانیه، بین رپلیکاها فقط یک‌بار ──
export interface IntervalJob {
  /** یکتا و پایدار — در کلید قفل و لاگ‌ها */
  name: string
  /** فاصله‌ی اجرا به ثانیه */
  everySeconds: number
  /**
   * round-19 — اجرا بدون قفل Redis (پیش‌فرض false).
   * فقط برای کارهایی که باید خرابیِ خودِ ردیس را ببینند: قفلِ مبتنی بر ردیس،
   * هنگام قطعی ردیس کار را متوقف می‌کند و دیده‌بان کور می‌شود. بدون قفل،
   * هر رپلیکا مستقل اجرا و هشدار می‌دهد (امروز تک‌رپلیکا = بدون تفاوت).
   */
  noLock?: boolean
  run: () => Promise<void>
}

const LOCK_TTL_SECONDS = 6 * 60 * 60
const TICK_MS = 30_000
const RETRY_SECONDS = 5 * 60

type BunCronFn = (
  schedule: string,
  fn: () => void,
  opts?: { name?: string },
) => { stop(): void; start(): void }

const tehranNow = (now: Date): { date: string; hm: string } => {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const parts = Object.fromEntries(
    fmt.formatToParts(now).map((p) => [p.type, p.value]),
  ) as Record<string, string>
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hm: `${parts.hour}:${parts.minute}`,
  }
}

/**
 * زمان‌بند روزانه + بازه‌ای — ساعت تهران.
 *  - Bun.cron به‌عنوان تایمر (TZ=Asia/Tehran در Docker)
 *  - قفل Redis با SET NX + کلید (نام کار، تاریخ/پنجره) → با N رپلیکا دقیقاً یک‌بار
 *  - catchUp: کارهای روزانه‌ی ازدست‌رفته موقع بوت اجرا می‌شوند
 *  - کارهای بازه‌ای مستقل از Bun.cron همیشه روشن‌اند
 *  - اگر Bun.cron نبود → تیک ۳۰ ثانیه‌ای
 */
export class CronScheduler {
  private readonly jobs: DailyJob[] = []
  private readonly running = new Set<string>()
  private bunJobs: Array<{ stop(): void }> = []
  private tickTimer: ReturnType<typeof setInterval> | null = null
  private recoveryTimer: ReturnType<typeof setInterval> | null = null
  private readonly recovering = new Set<string>()
  // phase-2
  private readonly intervalJobs: IntervalJob[] = []
  private intervalTimers: Array<ReturnType<typeof setInterval>> = []

  constructor(
    private readonly redis: RedisService,
    /** round-18 — ثبت آخرین اجرا برای /health/metrics */
    private readonly recorder: JobRunRecorder,
    private readonly now: () => Date = () => new Date(),
  ) { }

  register(job: DailyJob): void {
    this.jobs.push(job)
    this.recorder.define({ name: job.name, kind: 'daily', schedule: job.time })
    console.log(`[cron] registered "${job.name}" at ${job.time} Asia/Tehran`)
  }

  /** phase-2 — ثبت کارِ بازه‌ای؛ قبل از start() صدا شود */
  registerInterval(job: IntervalJob): void {
    this.intervalJobs.push(job)
    this.recorder.define({
      name: job.name,
      kind: 'interval',
      schedule: `every ${job.everySeconds}s${job.noLock ? ' (بدون قفل)' : ''}`,
    })
    console.log(
      `[cron] registered interval "${job.name}" every ${job.everySeconds}s${job.noLock ? ' [no-lock]' : ''}`,
    )
  }

  async start(): Promise<void> {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (tz !== 'Asia/Tehran') {
      console.warn(
        `[cron] process timezone is "${tz}", expected Asia/Tehran (Docker sets TZ=Asia/Tehran)`,
      )
    }

    // ── جبران جایگاه‌های ازدست‌رفته‌ی امروز ──
    const { date, hm } = tehranNow(this.now())
    for (const job of this.jobs) {
      if (job.recovery) continue
      if (!job.catchUp || hm < job.time) continue
      if (await this.tryLock(`cron:lock:${job.name}:${date}`)) {
        console.log(`[cron] catch-up run for "${job.name}"`)
        void this.execute(job)
      }
    }

    // Reports must recover from downtime/Redis outages after the exact scheduled minute.
    // Keep this poll even when Bun.cron is available; completed periods are deduplicated in Redis.
    if (this.jobs.some((job) => job.recovery)) {
      this.pollRecovery()
      this.recoveryTimer = setInterval(() => this.pollRecovery(), TICK_MS)
    }

    // ── phase-2: کارهای بازه‌ای — مستقل از Bun.cron، همیشه روشن ──
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
          /* هیچ‌کاری نمی‌کند */
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
        /* هیچ‌کاری نمی‌کند */
      }
    }
    this.bunJobs = []
    if (this.tickTimer) clearInterval(this.tickTimer)
    this.tickTimer = null
    if (this.recoveryTimer) clearInterval(this.recoveryTimer)
    this.recoveryTimer = null
    // phase-2
    for (const t of this.intervalTimers) clearInterval(t)
    this.intervalTimers = []
  }

  private startTick(): void {
    if (this.tickTimer) return
    this.tickTimer = setInterval(() => {
      const { hm } = tehranNow(this.now())
      for (const job of this.jobs) {
        if (job.recovery) continue
        if (hm === job.time) void this.fire(job)
      }
    }, TICK_MS)
  }

  private async fire(job: DailyJob): Promise<void> {
    if (job.recovery) return this.fireRecoverable(job)
    const { date } = tehranNow(this.now())
    if (!(await this.tryLock(`cron:lock:${job.name}:${date}`))) return
    void this.execute(job)
  }

  private pollRecovery(): void {
    for (const job of this.jobs) {
      if (job.recovery) void this.fireRecoverable(job)
    }
  }

  private async fireRecoverable(job: DailyJob): Promise<void> {
    if (!job.recovery || this.recovering.has(job.name)) return
    const { date, hm } = tehranNow(this.now())
    let period = date
    const weekday = job.recovery.weekday
    if (weekday === undefined) {
      if (hm < job.time) return
    } else {
      // Work with calendar dates rather than process TZ or 24-hour offsets across DST.
      const calendar = new Date(`${date}T00:00:00Z`)
      const daysSince = (calendar.getUTCDay() - weekday + 7) % 7
      if (daysSince === 0 && hm < job.time) return
      calendar.setUTCDate(calendar.getUTCDate() - daysSince)
      period = calendar.toISOString().slice(0, 10)
    }

    const leaseKey = `cron:lock:${job.name}:${period}`
    const doneKey = `cron:done:${job.name}:${period}`
    const owner = crypto.randomUUID()
    this.recovering.add(job.name)
    try {
      if (await this.redis.claimScheduledJob(leaseKey, doneKey, owner, LOCK_TTL_SECONDS) !== true) return
      const success = await this.execute(job)
      const finished = await this.redis.finishScheduledJob({
        leaseKey, doneKey, owner, success,
        doneTtlSeconds: (weekday === undefined ? 2 : 8) * 24 * 60 * 60,
        retrySeconds: RETRY_SECONDS,
      })
      if (finished !== true) console.warn(`[cron] could not record completion of "${job.name}"`)
    } catch (error) {
      console.error(`[cron] recovery coordination failed for "${job.name}":`, error)
    } finally {
      this.recovering.delete(job.name)
    }
  }

  /** phase-2 — قفل به‌ازای هر پنجره: با N رپلیکا فقط یکی اجرا می‌شود */
  private async fireInterval(job: IntervalJob): Promise<void> {
    // round-19 — noLock: بدون قفل اجرا شود (موثق در تعریف IntervalJob)
    if (!job.noLock) {
      const window = Math.floor(Date.now() / 1000 / job.everySeconds)
      if (!(await this.tryLock(`cron:ilock:${job.name}:${window}`))) return
    }
    void this.execute(job)
  }

  /** SET ... NX — فقط اگر کسی قبل از ما نزد بود (null = ردیس پایین → قفل گرفته نشده) */
  private async tryLock(lockKey: string): Promise<boolean> {
    try {
      return (await this.redis.setNx(lockKey, '1', { ex: LOCK_TTL_SECONDS })) === true
    } catch {
      // ردیس پایین → شکست‌بسته؛ تیک بعدی دوباره می‌آید
      return false
    }
  }

  // phase-2: امضای عمومی‌تر — DailyJob و IntervalJob هر دو جا می‌شوند
  private async execute(job: { name: string; run: () => Promise<void> }): Promise<boolean> {
    if (this.running.has(job.name)) return false
    this.running.add(job.name)
    const t0 = performance.now()
    this.recorder.begin(job.name)
    try {
      await job.run()
      const durationMs = performance.now() - t0
      this.recorder.end(job.name, true, durationMs)
      console.log(`[cron] "${job.name}" finished in ${durationMs.toFixed(0)}ms`)
      return true
    } catch (err) {
      this.recorder.end(job.name, false, performance.now() - t0, err)
      console.error(`[cron] "${job.name}" FAILED:`, err)
      return false
    } finally {
      this.running.delete(job.name)
    }
  }
}
