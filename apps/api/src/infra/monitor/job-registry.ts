// src/infra/monitor/job-registry.ts
/**
 * round-18 — ثبت آخرین اجرای هر job زمان‌بندی‌شده.
 * CronScheduler در begin/end اجرا را اعلام می‌کند؛ این رجیستری فقط
 * تاریخچه‌ی «آخرین وضعیت» را نگه می‌دارد (نه صف، نه تکرار — حافظهٔ O(jobs)).
 */
import type { JobRunDto } from '@sinshin/shared'

/** قرارداد ثبت — scheduler فقط همین را می‌بیند (تفکیک از پیاده‌سازی) */
export interface JobRunRecorder {
  define(job: { name: string; kind: 'daily' | 'interval'; schedule: string }): void
  begin(name: string): void
  end(name: string, ok: boolean, durationMs: number, error?: unknown): void
}

const ERROR_MAX_CHARS = 300

/** خطا → یک خط خوانا و کوتاه برای پاسخ metrics */
function describeError(err: unknown): string {
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  return text.length > ERROR_MAX_CHARS ? `${text.slice(0, ERROR_MAX_CHARS)}…` : text
}

interface JobRunState {
  kind: 'daily' | 'interval'
  schedule: string
  lastStartedAt: string | null
  lastDurationMs: number | null
  lastOk: boolean | null
  lastError: string | null
  runningNow: boolean
  runCount: number
  failureCount: number
}

export class JobRunRegistry implements JobRunRecorder {
  private readonly jobs = new Map<string, JobRunState>()

  define(job: { name: string; kind: 'daily' | 'interval'; schedule: string }): void {
    const existing = this.jobs.get(job.name)
    if (existing) {
      // register دوباره (مثلاً پس از hot-reload) — فقط تعریف به‌روز شود
      existing.kind = job.kind
      existing.schedule = job.schedule
      return
    }
    this.jobs.set(job.name, {
      kind: job.kind,
      schedule: job.schedule,
      lastStartedAt: null,
      lastDurationMs: null,
      lastOk: null,
      lastError: null,
      runningNow: false,
      runCount: 0,
      failureCount: 0,
    })
  }

  begin(name: string): void {
    const job = this.entry(name)
    job.runningNow = true
    job.lastStartedAt = new Date().toISOString()
    job.lastOk = null
    job.lastError = null
  }

  end(name: string, ok: boolean, durationMs: number, error?: unknown): void {
    const job = this.entry(name)
    job.runningNow = false
    job.lastDurationMs = Math.round(durationMs)
    job.lastOk = ok
    job.lastError = ok ? null : describeError(error)
    job.runCount++
    if (!ok) job.failureCount++
  }

  /** مرتب بر اساس نام — خروجی پایدار برای پاسخ metrics */
  snapshot(): JobRunDto[] {
    return [...this.jobs.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, j]) => ({ name, ...j }))
  }

  /** شروعِ بدون define — ورودی دفاعی با مقادیر خنثی */
  private entry(name: string): JobRunState {
    let job = this.jobs.get(name)
    if (!job) {
      job = {
        kind: 'daily',
        schedule: '',
        lastStartedAt: null,
        lastDurationMs: null,
        lastOk: null,
        lastError: null,
        runningNow: false,
        runCount: 0,
        failureCount: 0,
      }
      this.jobs.set(name, job)
    }
    return job
  }
}
