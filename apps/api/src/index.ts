// ═══════════════════════════════════════════════════════════════
// stage-52 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/index.ts
// تغییر: سیم‌کشی PaymentService — notifications پاس داده می‌شود (پوش سفارش زنده).
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// phase-2 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/index.ts
// وضعیت: جایگزینی کامل فایل موجود (پایه: نسخه‌ی فاز-۱)
// تغییر فاز-۲: سیم‌کشی neshan / docker-logs / notifications + job جدید
// ═══════════════════════════════════════════════════════════════

//src/index.ts
/**
 * ریشه‌ی ترکیب — تمام سیم‌کشی همین‌جاست.
 * امن در برابر بارگذاری دوباره: زیرساخت (استخر pg، ردیس) روی globalThis نگه داشته می‌شود.
 */
import { AppConfig } from '#/infra/config/env'
import { Database } from '#/infra/db/client'
import { RedisService } from '#/infra/redis/redis'
import { SseHub } from '#/infra/realtime/sse-hub'
import { SmsService } from '#/infra/sms/sms.service'
import { AdminService } from '#/domain/admin/admin.service'
import { TokenService } from '#/domain/auth/token.service'
import { OtpService } from '#/domain/auth/otp.service'
import { SessionService } from '#/domain/auth/session.service'
import { DeviceService } from '#/domain/device/device.service'
import { AuthService } from '#/domain/auth/auth.service'
import { SettingsService } from '#/domain/settings/settings.service'
import { MenuService } from '#/domain/menu/menu.service'
import { CartService } from '#/domain/cart/cart.service'
import { AddressService } from '#/domain/address/address.service'
import { DeliveryZoneService } from '#/domain/delivery/delivery-zone.service'
import { OrderService } from '#/domain/order/order.service'
import { ProfileService } from '#/domain/order/profile.service'
import { CheckoutIdempotency } from '#/domain/order/checkout-idempotency.service'
import { PaymentService } from '#/domain/payment/payment.service'
import { UploadService } from '#/infra/uploads/upload.service'
import { Admin2Service } from '#/domain/admin2/admin2.service'
import { LiveService } from '#/domain/live/live.service'
import { CourierService } from '#/domain/courier/courier.service'
import { ReviewService } from '#/domain/review/review.service'
import { ReportService } from '#/domain/report/report.service'
import { ReportQueryService } from '#/domain/report/report-query.service'
import { AuditService } from '#/domain/audit/audit.service'
import { ReportLinks } from '#/domain/report/report-links'
import { CouponService } from '#/domain/coupon/coupon.service'
import { ReconcileService } from '#/domain/reconcile/reconcile.service'
import { TermsService } from '#/domain/terms/terms.service'
import { CronScheduler } from '#/workers/scheduler'
import { CouponScanJob } from '#/workers/jobs/coupon-scan.job'
import { DailyReportJob } from '#/workers/jobs/daily-report.job'
import { WeeklyReportJob } from '#/workers/jobs/weekly-report.job'
import { ReconcileJob } from '#/workers/jobs/reconcile.job'
import { ArticleService } from '#/domain/article/article.service'
import { GalleryService } from '#/domain/gallery/gallery.service'
import { PaymentTimeoutJob } from '#/workers/jobs/payment-timeout.job'
import { RetentionJob } from '#/workers/jobs/retention.job'
import { HealthAlertJob } from '#/workers/jobs/health-alert.job'
import { GeoService } from '#/domain/geo/geo.service'
import { MetricsService } from '#/infra/monitor/metrics'
import { JobRunRegistry } from '#/infra/monitor/job-registry'
import { TranslationService } from '#/domain/translation/translation.service'
// فاز-۲ — نشان / لاگ داکر / نوتیفیکیشن
import { NeshanService } from '#/infra/maps/neshan.service'
import { DockerLogsService } from '#/infra/logs/docker-logs.service'
import { NotificationService } from '#/domain/notification/notification.service'
// فاز-۲ — یادآور کوپن حالا پوش است؛ همان مسیر فایل قبلی (محتوای جدید)
import { CouponNudgeJob } from '#/workers/jobs/coupon-nudge-sms.job'
import { AutoTranslateJob } from '#/workers/jobs/auto-translate.job'
import { buildApp } from '#/app'

const config = new AppConfig()

// ── زیرساخت — ذخیره‌شده؛ از بارگذاری دوباره جان سالم به در می‌برد ──
const g = globalThis as {
  __sinshin_infra?: { database: Database; redis: RedisService }
  __sinshin_monitor?: { metrics: MetricsService; jobRuns: JobRunRegistry }
  __sinshin_cron?: CronScheduler
  __sinshin_cron_registered?: boolean
  __sinshin_cron_started?: boolean
  __sinshin_signals?: boolean
  __sinshin_metrics_started?: boolean
}

const infra = (g.__sinshin_infra ??= {
  database: new Database(config.databaseUrl, {
    // رارد ۴۵ — سقف اتصال‌ها از کلاس کانفیگ (DB_POOL_MAX)؛ قبلاً مستقیم Bun.env
    max: config.dbPoolMax,
  }),
  redis: new RedisService(config.redisUrl),
})
const { database, redis } = infra
const db = database.db

// round-18 — مانیتورینگ: همان نمونه بین بارگذاری‌های دوباره (شمارنده‌ها و تاریخچه‌ی
// کارها از دست نمی‌روند؛ تایمر نمونه‌ی قبلی هم سرگردان نمی‌شود)
let monitor = g.__sinshin_monitor
if (!monitor) {
  monitor = { metrics: new MetricsService(), jobRuns: new JobRunRegistry() }
  g.__sinshin_monitor = monitor
}
const sseHub = new SseHub(redis)

// ── سرویس‌های دامنه — کد تازه در هر بارگذاری دوباره، همان استخر ──
const sms = new SmsService(config)
const tokens = new TokenService(config)
const otp = new OtpService({ redis, config, sms })
const sessions = new SessionService({ db, config, tokens })
const devices = new DeviceService({ db, config })
const settings = new SettingsService({ db, config }) // round-13 — config برای مختصات env رستوران
// round-28 — سبد: دسته‌ای از loadPricingBases مشترک؛ دیگر به menu نیاز ندارد
const cart = new CartService({ db })
const addresses = new AddressService({ db })
const zones = new DeliveryZoneService({ db, settings })
const coupons = new CouponService({ db })
const termsService = new TermsService({ db })
// فاز-۲ — نشان (کلید service فقط سمت سرور) + لاگ داکر (سوکت compose) +
// نوتیفیکیشن (صندوق + پوش) — قبل از مصرف‌کننده‌ها (orders/reports/retention)
const neshan = new NeshanService(config)
const dockerLogs = new DockerLogsService(config)
const notifications = new NotificationService({ db, config, hub: sseHub })
// stage-48 — منو: پخش نوتیفیکیشن تخفیف + SSE عمومی menu:live
// (بعد از notifications ساخته می‌شود تا هر دو سرویس را بگیرد)
const menu = new MenuService({ db, redis, notifications, hub: sseHub })
const orders = new OrderService({ db, config, zones, settings, coupons, notifications })
const profile = new ProfileService({ db, config, orders, devices })
// round-20 — تکرارناپذیری چک‌اوت مقیم DB (مستقل از ردیس — مسیر پول)
const checkoutIdempotency = new CheckoutIdempotency({ db })
// stage-52 — payments هم notifications گرفت: پرداخت موفق = سفارش وارد صف
// زنده ⇒ علاوه بر SSE پنل‌ها، Web Push به ادمین‌های سطح ۲ می‌رود.
const payments = new PaymentService({ db, config, orders, notifications, hub: sseHub })
const uploads = new UploadService(config.uploadDir)
const admin2 = new Admin2Service({ db, config, settings, hub: sseHub })
const live = new LiveService({ db, config, admin2, hub: sseHub })
const couriers = new CourierService({ db, config, redis, sms })
const admin = new AdminService({ db })
const reviews = new ReviewService({ db })
const links = new ReportLinks(config)
const reconcile = new ReconcileService({ db, config, orders })
const reports = new ReportService({ db, config, sms, links, reconcile, dockerLogs })
// stage-10: باکس گزارشات داشبورد + لاگ ممیزی ادمین اصلی
const audit = new AuditService({ db })
const reportQueries = new ReportQueryService({ db, audit })
const auth = new AuthService({ db, config, otp, sessions, devices, admin2 })
const articles = new ArticleService({ db, redis })
const gallery = new GalleryService({ db })
const geo = new GeoService({ db, config, settings })
// round-35 — صف ترجمه‌ی خودکار (مترجم آفلاین؛ برای باطل‌کردن کش منو به menu وصل است)
const translation = new TranslationService({ db, config, menu, articles })

// ── زمان‌بند — فقط یک‌بار ثبت می‌شود ──
const scheduler = (g.__sinshin_cron ??= new CronScheduler(redis, monitor.jobRuns))
if (!g.__sinshin_cron_registered) {
  g.__sinshin_cron_registered = true
  scheduler.register(new CouponScanJob({ config, db, coupons }))
  // فاز-۲ — یادآور کوپن حالا پوش نوتیفیکیشن است (به‌جای پیامک)
  scheduler.register(new CouponNudgeJob({ config, db, notifications }))
  scheduler.register(new DailyReportJob({ config, db, sms, reports }))
  scheduler.register(new WeeklyReportJob({ config, db, sms, reports }))
  scheduler.register(new ReconcileJob({ config, db, reconcile }))
  // round-16 — پاک‌سازی دوره‌ای جدول‌های لاگی/سشن (۱۸۰/۹۰ روز، حذف سقف‌دار)
  scheduler.register(new RetentionJob({ db, notifications }))
  scheduler.registerInterval(new PaymentTimeoutJob({ payments }))
  // round-19 — دیده‌بان سلامت: پیامک قطعی/برگشت db/redis/uploads (بدون قفل — موثق در کار)
  scheduler.registerInterval(
    new HealthAlertJob({ config, db: database, redis, uploads, sms }),
  )
  // phase-fix: تازه‌سازی روزانه‌ی بازه‌های IP ایران (RIPE)
  scheduler.registerInterval({
    name: 'geo-refresh',
    everySeconds: 24 * 60 * 60,
    run: async () => {
      await geo.refresh()
    },
  })
  // round-35 — کارگر صف ترجمه (تصرف اتمیک؛ مترجم پایین = صف در انتظار می‌ماند)
  scheduler.registerInterval(new AutoTranslateJob({ translation }))
}

// ── تورِ ایمنیِ سطح پروسه — round-16: باید «قبل از listen» ثبت شوند تا │
// خطای بوت (مثلاً پر بودن پورت) از لایهٔ زنده‌نگه‌داری رد نشود و پروسه بی‌صدا نمیرد ──
if (!g.__sinshin_signals) {
  g.__sinshin_signals = true
  // لاگ می‌ماند، پروسه زنده می‌ماند (restart خودش فقط برای خطاهای مهلک)
  process.on('unhandledRejection', (reason) => {
    console.error('[api] unhandledRejection (kept alive):', reason)
  })
  process.on('uncaughtException', (err) => {
    console.error('[api] uncaughtException (kept alive):', err)
  })
  const shutdown = async (signal: string) => {
    console.log(`[api] ${signal} received — shutting down`)
    scheduler.stop()
    monitor.metrics.stop()
    try {
      app.stop()
    } catch {
      /* هیچ‌کاری نمی‌کند */
    }
    try {
      redis.close()
    } catch {
      /* هیچ‌کاری نمی‌کند */
    }
    // phase-5: قفل‌های استخر در جریان تمام شوند — خروج بعد از بستنِ واقعی
    try {
      await database.close()
    } catch {
      /* هیچ‌کاری نمی‌کند */
    }
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

// ── اپلیکیشن ──
const app = buildApp({
  config,
  db: database,
  redis,
  sseHub,
  metrics: monitor.metrics,
  jobRuns: monitor.jobRuns,
  auth,
  sessions,
  devices,
  menu,
  cart,
  addresses,
  zones,
  settings,
  orders,
  profile,
  checkoutIdempotency,
  payments,
  uploads,
  admin2,
  live,
  couriers,
  reviews,
  reports,
  reportQueries,
  audit,
  links,
  reconcile,
  coupons,
  termsService,
  admin,
  articles,
  gallery,
  geo,
  translation,
  notifications,
  neshan,
})

// round-16 — گارد بوت: اگر پورت گرفته شده باشد/ bind شکست بخورد، با پیام
// شفاف exit می‌کنیم تا compose ری‌استارت بزند و لاگ عملیات قابل تشخیص باشد
// (پروسهٔ زندهٔ بی‌سرور بدتر از ری‌استارت شفاف است).
try {
  app.listen({ port: config.port, hostname: config.host })
} catch (err) {
  console.error(
    `[boot] listen failed on ${config.host}:${config.port} — port already in use or bind error:`,
    err,
  )
  process.exit(1)
}

// phase-fix: بارگذاری بازه‌های IP ایران — شلیک و رها (شکست‌باز تا آماده شود)
geo.warmup()

// ── کاوشگرها ──
const [dbUp, redisUp] = await Promise.all([database.connect(), redis.connect()])
if (!dbUp) console.error('[boot] postgres unreachable — /api/health will report 503 (replica out of rotation)')
if (!redisUp) {
  // round-20 — ردیس سخت نیست: سایت سرو می‌کند، فقط OTP/قفل‌ها/پل SSE می‌لنگند
  console.error('[boot] redis unreachable — OTP login/locks/SSE bridge degraded (site keeps serving, /api/health stays 200)')
}

// round-18 — نمونه‌گیر تاخیر حلقهٔ رویداد (تکرارناپذیر بین بارگذاری‌های دوباره)
if (!g.__sinshin_metrics_started) {
  g.__sinshin_metrics_started = true
  monitor.metrics.start()
}

if (!g.__sinshin_cron_started) {
  g.__sinshin_cron_started = true
  await scheduler.start()
}

console.log(
  `[api] ${config.env} │ http://${config.host}:${config.port} │ health: /api/health │ docs: /swagger`,
)
console.log(
  `[api] sms: ${sms.describe()} │ otp: cooldown ${config.otp.cooldownSeconds}s / ${config.otp.maxAttempts} attempts`,
)

/** برای Eden — صادراتِ فقط-تایپی؛ بدون هیچ ردپایی در زمان اجرا */
export type App = typeof app