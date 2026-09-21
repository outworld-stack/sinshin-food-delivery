//src/app.ts
import { Elysia, NotFoundError, ParseError, ValidationError } from 'elysia'

import type { AppConfig } from '#/infra/config/env'
import type { Database } from '#/infra/db/client'
import type { RedisService } from '#/infra/redis/redis'
import type { SseHub } from '#/infra/realtime/sse-hub'
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


export interface AppDeps {
  config: AppConfig
  db: Database
  redis: RedisService
  sseHub: SseHub
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
}

export const buildApp = (deps: AppDeps) => {
  const api = new Elysia({ prefix: '/api' })
    .onRequest(async ({ request }) => {
      // سئو-۱ — معافیت کرالرها، آینه‌ی همان منطق دروازه‌ی SSR (geoGate.ts):
      // کرالرهایی که صفحه را رندر می‌کنند (مثل Googlebot WRS) درخواست‌های
      // /api را با IP خودشان (غیرایرانی) می‌فرستند؛ بدون این معافیت، محتوای
      // رندرشده‌شان ۴۰۳ می‌شد. سیاست «فقط ایران» برای کاربران واقعی تغییر نمی‌کند.
      // (تماس‌های SSR وب با API از IP خصوصی‌اند و از قبل عبور می‌کردند.)
      if (isTrustedCrawlerUserAgent(request.headers.get('user-agent'))) {
        return
      }
      const ip = clientIp(request.headers.get('x-forwarded-for'))
      if (ip && (await deps.geo.shouldBlock(ip))) {
        // phase-fix: 404 گیج‌کننده بود → 403 + پیام روشن برای کاربر ایرانیِ VPN-دار
        return new Response(
          JSON.stringify({
            error: {
              code: 'GEO_BLOCKED',
              message: 'لطفاً اگر از ایران هستید، لطفاً VPN خودتان را خاموش کنید و صفحه را رفرش کنید.',
            },
          }),
          { status: 403, headers: { 'content-type': 'application/json' } },
        )
      }
    })
    .use(
      healthRoutes({
        db: deps.db,
        redis: deps.redis,
        config: deps.config,
        startedAt: Date.now(),
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
    .use(menuRoutes({ menu: deps.menu, cart: deps.cart }))
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
    .use(adminOrderRoutes({ sessions: deps.sessions, orders: deps.orders }))
    .use(admin2Routes({ sessions: deps.sessions, admin2: deps.admin2, settings: deps.settings }))
    .use(liveRoutes({ sessions: deps.sessions, admin2: deps.admin2, live: deps.live }))
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
        redis: deps.redis
      }),
    )
    .use(paymentRoutes({ payments: deps.payments }))
    .use(reconcileRoutes({ sessions: deps.sessions, reconcile: deps.reconcile }))
    .use(geoRoutes({ geo: deps.geo, sessions: deps.sessions, redis: deps.redis }))

  return new Elysia()
    .use(openapiPlugin(deps.config))
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