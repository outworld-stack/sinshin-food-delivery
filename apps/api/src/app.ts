// ═══════════════════════════════════════════════════════════════
// stage-55 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/app.ts
// وضعیت: جایگزینی کامل فایل موجود
// تغییر: سیم‌کشی redis به menuRoutes و notificationRoutes (سقف نرخ IP stage-55)
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// stage-52 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/app.ts
// تغییر: سیم‌کشی orderRoutes — notifications پاس داده می‌شود (پوش سفارش زنده).
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// phase-2 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/app.ts
// وضعیت: جایگزینی کامل فایل موجود (پایه: نسخه‌ی فاز-۱ با M3+L5)
// تغییر فاز-۲: مسیرهای نوتیفیکیشن + neshan در geo routes
// ═══════════════════════════════════════════════════════════════

//src/app.ts
import { Elysia, NotFoundError, ParseError, ValidationError } from 'elysia'

import type { AppConfig } from '#/infra/config/env'
import type { Database } from '#/infra/db/client'
import type { RedisService } from '#/infra/redis/redis'
import type { SseHub } from '#/infra/realtime/sse-hub'
import type { MetricsService } from '#/infra/monitor/metrics'
import type { JobRunRegistry } from '#/infra/monitor/job-registry'
import type { AuthService } from '#/domain/auth/auth.service'
import type { SessionService } from '#/domain/auth/session.service'
import type { DeviceService } from '#/domain/device/device.service'
import type { MenuService } from '#/domain/menu/menu.service'
import type { CartService } from '#/domain/cart/cart.service'
import type { AddressService } from '#/domain/address/address.service'
import type { DeliveryZoneService } from '#/domain/delivery/delivery-zone.service'
import type { SettingsService } from '#/domain/settings/settings.service'
import type { OrderService } from '#/domain/order/order.service'
import type { ProfileService } from '#/domain/order/profile.service'
import type { CheckoutIdempotency } from '#/domain/order/checkout-idempotency.service'
import type { PaymentService } from '#/domain/payment/payment.service'
import type { UploadService } from '#/infra/uploads/upload.service'
import type { Admin2Service } from '#/domain/admin2/admin2.service'
import type { LiveService } from '#/domain/live/live.service'
import type { CourierService } from '#/domain/courier/courier.service'
import type { ReviewService } from '#/domain/review/review.service'
import type { ReportService } from '#/domain/report/report.service'
import type { ReportQueryService } from '#/domain/report/report-query.service'
import type { AuditService } from '#/domain/audit/audit.service'
import type { ReportLinks } from '#/domain/report/report-links'
import type { CouponService } from '#/domain/coupon/coupon.service'
import type { ReconcileService } from '#/domain/reconcile/reconcile.service'
import type { TermsService } from '#/domain/terms/terms.service'
import type { ArticleService } from './domain/article/article.service'
import type { GalleryService } from './domain/gallery/gallery.service'
import type { GeoService } from '#/domain/geo/geo.service'
import type { NotificationService } from '#/domain/notification/notification.service'
import type { NeshanService } from '#/infra/maps/neshan.service'
import type { TranslationService } from '#/domain/translation/translation.service'

import { AppError } from '#/domain/shared/errors'
import { clientIp } from '#/domain/shared/net'
import { isTrustedCrawlerUserAgent } from '@sinshin/shared'
import { openapiPlugin } from '#/http/openapi'
import cors from '@elysiajs/cors'
import { healthRoutes } from '#/http/routes/health.routes'
import { AdminService } from '#/domain/admin/admin.service'
import { realtimeRoutes } from '#/http/routes/realtime.routes'
import { authRoutes } from '#/http/routes/auth.routes'
import { adminRoutes } from '#/http/routes/admin.routes'
import { menuRoutes } from '#/http/routes/menu.routes'
import { addressRoutes } from '#/http/routes/address.routes'
import { adminMenuRoutes } from '#/http/routes/admin-menu.routes'
import { adminSettingsRoutes } from '#/http/routes/admin-settings.routes'
import { orderRoutes } from '#/http/routes/order.routes'
import { paymentRoutes } from '#/http/routes/payment.routes'
import { uploadRoutes } from '#/http/routes/upload.routes'
import { admin2Routes } from '#/http/routes/admin2.routes'
import { liveRoutes } from '#/http/routes/live.routes'
import { courierRoutes } from '#/http/routes/courier.routes'
import { reviewRoutes } from '#/http/routes/review.routes'
import { reportRoutes } from '#/http/routes/report.routes'
import { reportPanelRoutes } from '#/http/routes/report-panel.routes'
import { adminReportRoutes } from '#/http/routes/admin-report.routes'
import { couponRoutes } from '#/http/routes/coupon.routes'
import { reconcileRoutes } from '#/http/routes/reconcile.routes'
import { termsRoutes } from '#/http/routes/terms.routes'
import { adminOrderRoutes } from '#/http/routes/admin-order.routes'
import { articlesRoutes } from './http/routes/articles.routes'
import { galleryRoutes } from './http/routes/gallery.routes'
import { aboutRoutes } from './http/routes/about.routes'
import { geoRoutes } from '#/http/routes/geo.routes'
import { notificationRoutes } from '#/http/routes/notification.routes'
import { adminTranslateRoutes } from '#/http/routes/admin-translate.routes'


export interface AppDeps {
  config: AppConfig
  db: Database
  redis: RedisService
  sseHub: SseHub
  metrics: MetricsService
  jobRuns: JobRunRegistry
  auth: AuthService
  admin: AdminService
  sessions: SessionService
  devices: DeviceService
  menu: MenuService
  cart: CartService
  addresses: AddressService
  zones: DeliveryZoneService
  settings: SettingsService
  orders: OrderService
  profile: ProfileService
  checkoutIdempotency: CheckoutIdempotency
  payments: PaymentService
  uploads: UploadService
  admin2: Admin2Service
  live: LiveService
  couriers: CourierService
  reviews: ReviewService
  reports: ReportService
  reportQueries: ReportQueryService
  audit: AuditService
  links: ReportLinks
  coupons: CouponService
  reconcile: ReconcileService
  termsService: TermsService
  articles: ArticleService
  gallery: GalleryService
  geo: GeoService
  translation: TranslationService
  notifications: NotificationService
  neshan: NeshanService
}

export const buildApp = (deps: AppDeps) => {
  // رارد M3 — پیش‌گرم‌کردن کلید دروازه‌ی ژئو در بوت + تازه‌سازی دوره‌ای:
  // اولین درخواستِ کاربر دیگر منتظر لودِ تنظیمات نمی‌ماند و DB هماهنگ می‌ماند.
  void deps.geo.iranOnlyEnabled().catch(() => {
    /* پیش‌گرم شکست خورد — مسیر lazy خودش می‌پاید */
  })
  const geoWarmTimer = setInterval(() => {
    void deps.geo.iranOnlyEnabled().catch(() => {})
  }, 60_000)
  geoWarmTimer.unref?.()

  // ── دروازه‌ی جغرافیایی «فقط ایران» — round-28 ──
  // یک پیاده‌سازی برای «کل» سطح حمله، سوار روی نمونه‌ی بیرونی: قبلاً فقط
  // نمونه‌ی /api گیت داشت → /uploads/:name و POST /api/uploads و /swagger
  // بیرون دروازه بودند. حالا هر مسیری که به این پروسه می‌رسد از همین
  // یک گیت رد می‌شود (DRY — نه دو هوک موازی با هم‌پوشانی).
  //
  // سئو-۱ — معافیت کرالر، آینه‌ی همان منطق دروازه‌ی SSR (geoGate.ts):
  // کرالرهایی که صفحه را رندر می‌کنند (مثل Googlebot WRS) درخواست‌های
  // /api را با IP خودشان (غیرایرانی) می‌فرستند؛ بدون این معافیت، محتوای
  // رندرشده‌شان ۴۰۳ می‌شد. اما معافیت فقط برای «خواندنِ محتوای قابل
  // ایندکس» (GET/HEAD) است — متدهای نوشتن (OTP/چک‌اوت/آپلود) و استریم
  // زنده‌ی SSE هیچ‌وقت معاف نیستند: جعل User-Agent دیگر سپر را دور نمی‌زند.
  // (تماس‌های SSR وب با API از IP خصوصی‌اند و از قبل عبور می‌کنند.)
  const geoGate = async (request: Request): Promise<Response | undefined> => {
    if (request.method === 'GET' || request.method === 'HEAD') {
      if (
        isTrustedCrawlerUserAgent(request.headers.get('user-agent')) &&
        !new URL(request.url).pathname.startsWith('/api/realtime')
      ) {
        return // محتوای عمومی — رندر کرالر آزاد
      }
    }
    const ip = clientIp(request.headers.get('x-forwarded-for'))
    if (ip && (await deps.geo.shouldBlock(ip))) {
      // phase-fix: 404 گیج‌کننده بود → 403 + پیام روشن برای کاربر ایرانیِ VPN-دار
      // round-37 — پیام با حالت واقعی دروازه هماهنگ می‌شود: در حالت
      // «ایران + عراق» کاربرِ کشور دیگری باید بداند چرا مسدود است.
      const mode = await deps.geo.accessMode()
      const message =
        mode === 'iran-iraq'
          ? 'دسترسی به این سرویس فقط از ایران و عراق امکان‌پذیر است. اگر داخل یکی از این دو کشور هستید، لطفاً VPN خود را خاموش کنید و صفحه را رفرش کنید.'
          : 'لطفاً اگر از ایران هستید، لطفاً VPN خودتان را خاموش کنید و صفحه را رفرش کنید.'
      return new Response(
        JSON.stringify({
          error: {
            code: 'GEO_BLOCKED',
            message,
            /** round-37 — حالت دروازه برای لایه‌های بالاتر (نگاشت خطای وب) */
            policy: mode,
          },
        }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      )
    }
    return
  }

  const api = new Elysia({ prefix: '/api' })
    .use(
      healthRoutes({
        db: deps.db,
        redis: deps.redis,
        uploads: deps.uploads,
        config: deps.config,
        startedAt: Date.now(),
        sessions: deps.sessions,
        metrics: deps.metrics,
        jobRuns: deps.jobRuns,
        sseHub: deps.sseHub,
      }),
    )
    .use(
      adminRoutes({
        sessions: deps.sessions,
        devices: deps.devices,
        admin: deps.admin,
        admin2: deps.admin2,
        audit: deps.audit,
      }),
    )
    .use(realtimeRoutes({ hub: deps.sseHub, sessions: deps.sessions, db: deps.db.db }))
    .use(
      authRoutes({
        config: deps.config,
        redis: deps.redis,
        auth: deps.auth,
        sessions: deps.sessions,
        devices: deps.devices,
        admin2: deps.admin2,
      }),
    )
    .use(articlesRoutes({ sessions: deps.sessions, articles: deps.articles }))
    .use(menuRoutes({ menu: deps.menu, cart: deps.cart, redis: deps.redis }))
    .use(addressRoutes({ sessions: deps.sessions, addresses: deps.addresses }))
    .use(
      adminMenuRoutes({
        sessions: deps.sessions,
        menu: deps.menu,
        admin2: deps.admin2,
        audit: deps.audit,
      }),
    )
    .use(
      adminSettingsRoutes({
        sessions: deps.sessions,
        zones: deps.zones,
        settings: deps.settings,
        admin2: deps.admin2,
        audit: deps.audit,
      }),
    )
    .use(adminOrderRoutes({ sessions: deps.sessions, orders: deps.orders, audit: deps.audit }))
    .use(admin2Routes({ sessions: deps.sessions, admin2: deps.admin2, settings: deps.settings }))
    .use(liveRoutes({ sessions: deps.sessions, admin2: deps.admin2, live: deps.live, orders: deps.orders }))
    .use(courierRoutes({ sessions: deps.sessions, admin2: deps.admin2, couriers: deps.couriers, redis: deps.redis }))
    .use(reviewRoutes({ sessions: deps.sessions, admin2: deps.admin2, reviews: deps.reviews }))
    .use(
      couponRoutes({
        sessions: deps.sessions,
        coupons: deps.coupons,
        audit: deps.audit,
      }),
    )
    .use(termsRoutes({ sessions: deps.sessions, termsService: deps.termsService }))
    .use(galleryRoutes({ sessions: deps.sessions, gallery: deps.gallery }))
    .use(aboutRoutes({ db: deps.db.db, sessions: deps.sessions }))
    .use(reportRoutes({ sessions: deps.sessions, reports: deps.reports, links: deps.links }))
    .use(reportPanelRoutes({ db: deps.db.db, links: deps.links }))
    .use(adminReportRoutes({ sessions: deps.sessions, reports: deps.reportQueries }))
    .use(
      orderRoutes({
        sessions: deps.sessions,
        orders: deps.orders,
        profile: deps.profile,
        settings: deps.settings,
        payments: deps.payments,
        redis: deps.redis,
        idempotency: deps.checkoutIdempotency,
        hub: deps.sseHub,
        // stage-52 — پوش «سفارش جدید صف زنده» به ادمین‌های سطح ۲
        notifications: deps.notifications,
      }),
    )
    .use(paymentRoutes({ payments: deps.payments }))
    .use(reconcileRoutes({ sessions: deps.sessions, reconcile: deps.reconcile }))
    .use(geoRoutes({ geo: deps.geo, sessions: deps.sessions, redis: deps.redis, neshan: deps.neshan }))
    // round-35 — preview/صف/وضعیت ترجمه (گارد پایه؛ قرارداد «دستی برنده» در سرویس)
    .use(
      adminTranslateRoutes({
        sessions: deps.sessions,
        admin2: deps.admin2,
        translation: deps.translation,
      }),
    )
    // فاز-۲ — نوتیفیکیشن‌ها (صندوق + اشتراک پوش + broadcast ادمین)
    // stage-48 — admin2 برای گارد مجوز‌های notificationsSend/notificationsRead
    .use(
      notificationRoutes({
        sessions: deps.sessions,
        notifications: deps.notifications,
        admin2: deps.admin2,
        // stage-55 — سقف نرخ IP روی ثبت اشتراک پوش
        redis: deps.redis,
      }),
    )

  // round-16 — سقف بدنهٔ درخواست در سطح سوکت (پیش از بافر شدن کامل در حافظه):
  // آپلودها ۲MB هستند؛ ۸MB سقف سخاوتمندانه برای multipart + JSON های بزرگ
  //
  // round-18 — سنجه‌های HTTP: ثبت شروع در onRequest و پایان/وضعیت در
  // onAfterResponse. دو نکته‌ای که با تست ران‌تایم تأیید شد:
  //  • set.status در onAfterResponse همیشه مقدارِ نرمال‌شده دارد (پیش‌فرض ۲۰۰)
  //  • پاسخِ مستقیمِ Response از onRequest (مثل geo-block) onAfterResponse
  //    را کاملاً رد می‌کند — چنین درخواست‌هایی فقط از نظر شمارش غایبند،
  //    نه هیچ شاخصی را خراب نمی‌کنند.
  // هر دو هوک غیر-پرتاب‌اند — مانیتورینگ مسیر سرو‌دهی را زمین نمی‌زند.
  return new Elysia({ serve: { maxRequestBodySize: 8 * 1024 * 1024 } })
    .onRequest(async ({ request }) => {
      // metrics اول (همه‌چیز شمرده شود)، بعد دروازه‌ی ژئو — پاسخ مستقیم از
      // onRequest روی onAfterResponse می‌پرد (مستند round-18)؛ ترتیب همین است.
      // return الزامی است: بدون آن Responseِ بلاک دور ریخته می‌شود و گیت
      // بی‌اثر می‌شود (اشکالی که تست زنده‌ی round-28 گرفت).
      deps.metrics.observeRequest(request)
      return await geoGate(request)
    })
    .onAfterResponse(({ request, set }) =>
      deps.metrics.observeResponse(request, Number(set.status ?? 200)),
    )
    // رارد L5 — defense-in-depth: سوئگر فقط dev مونت می‌شود (قبلاً در prod فقط
    // لبه‌ی Caddy می‌بستش؛ اجرای مستقیم پورت یعنی مستندات کامل رووت‌ها عمومی)
    .use(!deps.config.isProd ? openapiPlugin(deps.config) : new Elysia())
    .use(
      cors({
        origin: deps.config.isProd ? false : ['http://localhost:3001', 'http://localhost:3000'],
        credentials: true,
      }),
    )
    .use(uploadRoutes({ sessions: deps.sessions, uploads: deps.uploads }))
    .get('/', () => ({
      service: 'sinshin-foodpark-api',
      health: '/api/health',
      ...(deps.config.isProd ? {} : { env: deps.config.env, docs: '/swagger' }),
    }))
    .onError(({ error, set }) => {
      if (error instanceof AppError) {
        set.status = error.status
        return error.toJSON()
      }
      if (error instanceof NotFoundError) {
        set.status = 404
        return { error: { code: 'NOT_FOUND', message: 'مسیر یا موردی پیدا نشد.' } }
      }
      if (error instanceof ParseError) {
        set.status = 400
        return { error: { code: 'VALIDATION_ERROR', message: 'بدنه‌ی درخواست قابل خواندن نیست.' } }
      }
      if (error instanceof ValidationError) {
        set.status = 422
        return {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ورودی ارسالی معتبر نیست.',
            ...(deps.config.isProd ? {} : { details: error.message }),
          },
        }
      }
      console.error('[api] unhandled:', error)
      set.status = 500
      return { error: { code: 'INTERNAL_ERROR', message: 'خطای داخلی سرور رخ داده است.' } }
    })
    .use(api)
}

export type App = ReturnType<typeof buildApp>