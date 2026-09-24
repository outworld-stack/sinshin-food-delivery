//src/workers/jobs/health-alert.job.ts
import type { AppConfig } from '#/infra/config/env'
import type { Database } from '#/infra/db/client'
import type { RedisService } from '#/infra/redis/redis'
import type { UploadService } from '#/infra/uploads/upload.service'
import type { SmsService } from '#/infra/sms/sms.service'
import { probe } from '#/infra/health/probes'
import type { IntervalJob } from '#/workers/scheduler'

/** همان چیزهایی که /api/health گزارش می‌کند — نه بیشتر، نه کمتر */
const CHECKS = [
  { key: 'database', label: 'پایگاه‌داده (Postgres)' },
  { key: 'redis', label: 'Redis' },
  { key: 'uploads', label: 'پوشهٔ آپلود' },
] as const

type CheckKey = (typeof CHECKS)[number]['key']

/**
 * ضد-لرزش: خرابی باید این‌قدر پروبِ پیاپی طول بکشد تا «قطعی» اعلام شود.
 * لرزشِ یک‌پروبی (ری‌استارت چندثانیه‌ای ردیس و…) هرگز پیامک نمی‌شود.
 * با فاصلهٔ پیش‌فرض ۶۰ ثانیه = حداکثر ~۲ دقیقه تأخیر در اعلام — برای یک
 * رستوران به‌سر، سودِ ضد-اسپم از این تأخیر خیلی بیشتر است.
 */
const CONFIRM_CYCLES = 2

interface CheckState {
  consecutiveDown: number
  firstDownAt: number
  confirmed: boolean
  lastAlertAt: number
}

/** نمونهٔ تازهٔ مستقل — هرگز شیء مشترک را مستقیم در states نگذاریم (آلودگی بین چک‌ها) */
const freshState = (): CheckState => ({
  consecutiveDown: 0,
  firstDownAt: 0,
  confirmed: false,
  lastAlertAt: 0,
})

const tehranHm = (): string =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tehran',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date())

const formatDuration = (ms: number): string => {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return 'کمتر از یک دقیقه'
  if (minutes < 60) return `${minutes} دقیقه`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} ساعت` : `${hours} ساعت و ${rest} دقیقه`
}

/**
 * round-19 — دیده‌بان سلامت: قطعیِ تأییدشدهٔ db/redis/uploads را پیامک می‌دهد؛
 * برگشت را هم (با مدت قطعی) خبر می‌دهد. قطعیِ پایدار هر repeatMinutes یادآوری
 * می‌شود تا قطعیِ شبانه بی‌خبر نماند.
 *
 *  • noLock: قفلِ بین-رپلیکایی ردیس اینجا عمداً کنار است — وگرنه هنگام قطعیِ
 *    خودِ ردیس، دیده‌بانِ ردیس کور می‌شود. (با N رپلیکا هر نمونه مستقل
 *    هشدار می‌دهد؛ امروز تک‌رپلیکا = بدون تفاوت.)
 *  • حالت درون‌حافظه‌ای است: ری‌استارتِ وسط قطعی = تأیید و اعلام دوباره —
 *    یک پیامک اضافه که خودش خبرِ ری‌استارت است؛ پذیرفته و آگاهانه.
 *  • غیر-پرتاب: probe و sms.send هر دو خطا را قورت می‌دهند.
 */
export class HealthAlertJob implements IntervalJob {
  readonly name = 'health-alert'
  readonly everySeconds: number
  readonly noLock = true

  private readonly states = new Map<CheckKey, CheckState>()

  constructor(
    private readonly deps: {
      config: AppConfig
      db: Database
      redis: RedisService
      uploads: UploadService
      sms: SmsService
    },
  ) {
    this.everySeconds = deps.config.healthAlert.everySeconds
  }

  async run(): Promise<void> {
    const p = await probe(this.deps.db, this.deps.redis)
    const up: Record<CheckKey, boolean> = {
      database: p.dbUp,
      redis: p.redisUp,
      uploads: this.deps.uploads.storageReady,
    }
    for (const { key, label } of CHECKS) {
      this.observe(key, label, up[key])
    }
  }

  private observe(key: CheckKey, label: string, up: boolean): void {
    const st = this.states.get(key) ?? freshState()
    const now = Date.now()

    if (!up) {
      if (st.consecutiveDown === 0) st.firstDownAt = now
      st.consecutiveDown++
      if (!st.confirmed && st.consecutiveDown >= CONFIRM_CYCLES) {
        st.confirmed = true
        st.lastAlertAt = now
        this.alert(`🚨 سین‌شین: ${label} از ساعت ${tehranHm()} قطع است.`)
      } else if (
        st.confirmed &&
        now - st.lastAlertAt >= this.deps.config.healthAlert.repeatMinutes * 60_000
      ) {
        st.lastAlertAt = now
        this.alert(`🚨 سین‌شین: ${label} همچنان قطع است (از ساعت ${tehranHm()}).`)
      }
      this.states.set(key, st)
      return
    }

    // بالاست — اگر قطعیِ اعلام‌شده‌ای داشتیم، خبرِ برگشت
    if (st.confirmed) {
      this.alert(`✅ سین‌شین: ${label} برگشت — ${formatDuration(now - st.firstDownAt)} قطع بود.`)
    }
    this.states.set(key, freshState())
  }

  /**
   * ارسال به همهٔ گیرنده‌ها به‌موازات (سهم هر پیامک حداکثر ۱۰s — سقف خود سرویس).
   * بدون گیرنده، متن در لاگ می‌ماند تا در docker logs دیده شود. غیر-پرتاب.
   */
  private alert(message: string): void {
    const phones = this.deps.config.healthAlert.phones
    if (phones.length === 0) {
      console.error(`[health-alert] گیرنده‌ای تنظیم نشده — فقط لاگ: ${message}`)
      return
    }
    void Promise.all(phones.map((phone) => this.deps.sms.send(phone, message))).then((results) => {
      const sent = results.filter(Boolean).length
      console.log(`[health-alert] پیامک به ${sent}/${phones.length} گیرنده: ${message}`)
    })
  }
}
