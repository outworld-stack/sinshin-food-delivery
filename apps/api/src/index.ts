//src/index.ts
/**
 * Composition root — all wiring lives here.
 * Hot-reload safe: infra (pg pool, redis) is stashed on globalThis.
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
import { PaymentService } from '#/domain/payment/payment.service'
import { UploadService } from '#/infra/uploads/upload.service'
import { Admin2Service } from '#/domain/admin2/admin2.service'
import { LiveService } from '#/domain/live/live.service'
import { CourierService } from '#/domain/courier/courier.service'
import { ReviewService } from '#/domain/review/review.service'
import { ReportService } from '#/domain/report/report.service'
import { ReportLinks } from '#/domain/report/report-links'
import { CouponService } from '#/domain/coupon/coupon.service'
import { ReconcileService } from '#/domain/reconcile/reconcile.service'
import { TermsService } from '#/domain/terms/terms.service'
import { CronScheduler } from '#/workers/scheduler'
import { CouponScanJob } from '#/workers/jobs/coupon-scan.job'
import { CouponNudgeSmsJob } from '#/workers/jobs/coupon-nudge-sms.job'
import { DailyReportJob } from '#/workers/jobs/daily-report.job'
import { WeeklyReportJob } from '#/workers/jobs/weekly-report.job'
import { ReconcileJob } from '#/workers/jobs/reconcile.job'
import { ArticleService } from '#/domain/article/article.service'
import { GalleryService } from '#/domain/gallery/gallery.service'
import { PaymentTimeoutJob } from '#/workers/jobs/payment-timeout.job'
import { GeoService } from '#/domain/geo/geo.service'
import { buildApp } from '#/app'

const config = new AppConfig()

// ── infra — stashed; survives hot reloads ──
const g = globalThis as {
  __sinshin_infra?: { database: Database; redis: RedisService }
  __sinshin_cron?: CronScheduler
  __sinshin_cron_registered?: boolean
  __sinshin_cron_started?: boolean
  __sinshin_signals?: boolean
}

const infra = (g.__sinshin_infra ??= {
  database: new Database(config.databaseUrl, {
    max: Number(Bun.env.DB_POOL_MAX ?? 10) || 10,
  }),
  redis: new RedisService(config.redisUrl),
})
const { database, redis } = infra
const db = database.db
const sseHub = new SseHub(redis)

// ── domain services — fresh code on every reload, same pool ──
const sms = new SmsService(config)
const tokens = new TokenService(config)
const otp = new OtpService({ redis, config, sms })
const sessions = new SessionService({ db, config, tokens })
const devices = new DeviceService({ db, config })
const settings = new SettingsService({ db })
const menu = new MenuService({ db, redis })
const cart = new CartService({ db, menu })
const addresses = new AddressService({ db })
const zones = new DeliveryZoneService({ db, settings })
const coupons = new CouponService({ db })
const termsService = new TermsService({ db })
const orders = new OrderService({ db, config, zones, settings, coupons })
const profile = new ProfileService({ db, config, orders })
const payments = new PaymentService({ db, config, orders })
const uploads = new UploadService(config.uploadDir)
const admin2 = new Admin2Service({ db, config, settings, hub: sseHub })
const live = new LiveService({ db, config, admin2, hub: sseHub })
const couriers = new CourierService({ db, config, redis, sms })
const admin = new AdminService({ db })
const reviews = new ReviewService({ db })
const links = new ReportLinks(config)
const reconcile = new ReconcileService({ db, config, orders })
const reports = new ReportService({ db, config, sms, links, reconcile })
const auth = new AuthService({ db, config, otp, sessions, devices, admin2 })
const articles = new ArticleService({ db })
const gallery = new GalleryService({ db })
const geo = new GeoService({ db, config, settings })

// ── cron — registered once ──
const scheduler = (g.__sinshin_cron ??= new CronScheduler(redis))
if (!g.__sinshin_cron_registered) {
  g.__sinshin_cron_registered = true
  scheduler.register(new CouponScanJob({ config, db, coupons }))
  scheduler.register(new CouponNudgeSmsJob({ config, db, sms }))
  scheduler.register(new DailyReportJob({ config, db, sms, reports }))
  scheduler.register(new WeeklyReportJob({ config, db, sms, reports }))
  scheduler.register(new ReconcileJob({ config, db, reconcile }))
  scheduler.registerInterval(new PaymentTimeoutJob({ payments }))
  // phase-fix: تازه‌سازی روزانه‌ی بازه‌های IP ایران (RIPE)
  scheduler.registerInterval({
    name: 'geo-refresh',
    everySeconds: 24 * 60 * 60,
    run: async () => {
      await geo.refresh()
    },
  })
}

// ── app ──
const app = buildApp({
  config,
  db: database,
  redis,
  sseHub,
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
  payments,
  uploads,
  admin2,
  live,
  couriers,
  reviews,
  reports,
  links,
  reconcile,
  coupons,
  termsService,
  admin,
  articles,
  gallery,
  geo,
})
app.listen({ port: config.port, hostname: config.host })

// phase-fix: لود بازه‌های IP ایران — fire-and-forget (fail-open تا آماده شود)
geo.warmup()

// ── probes ──
const [dbUp, redisUp] = await Promise.all([database.connect(), redis.connect()])
if (!dbUp) console.error('[boot] postgres unreachable — /api/health will report degraded')
if (!redisUp) console.error('[boot] redis unreachable — OTP/locks/SSE bridge are down')

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

// ── graceful shutdown — registered once ──
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
    try {
      app.stop()
    } catch {
      /* noop */
    }
    try {
      redis.close()
    } catch {
      /* noop */
    }
    // phase-5: قفل‌های pool در جریان تمام شوند — exit بعد از بستنِ واقعی
    try {
      await database.close()
    } catch {
      /* noop */
    }
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

/** for Eden — type-only export, zero runtime footprint */
export type App = typeof app