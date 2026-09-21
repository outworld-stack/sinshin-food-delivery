//src/http/routes/admin-report.routes.ts
import { Elysia, t } from 'elysia'

import type { SessionService } from '#/domain/auth/session.service'
import type { ReportQueryService } from '#/domain/report/report-query.service'
import { requireAdmin } from '#/http/hooks/require-auth'

const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

export interface AdminReportRoutesDeps {
  sessions: SessionService
  reports: ReportQueryService
}

/**
 * stage-10 — باکس گزارشات داشبورد ادمین اصلی.
 * یک اندپوینت با type — همان قرارداد ReportResultDto (عنوان/آمار/جدول).
 * تاریخ‌ها ISO میلادی‌اند؛ فرانت شمسی را خودش تبدیل می‌کند.
 */
export const adminReportRoutes = (deps: AdminReportRoutesDeps) =>
  new Elysia({ prefix: '/admin/reports', tags: ['Admin / Reports'] })
    .use(requireAdmin(deps.sessions))
    .post(
      '/query',
      ({ body }) =>
        deps.reports.query({
          type: body.type,
          from: body.from ?? null,
          to: body.to ?? null,
          status: body.status ?? null,
          deliveryType: body.deliveryType ?? null,
          adminUserId: body.adminUserId ?? null,
          courierId: body.courierId ?? null,
          phone: body.phone ?? null,
        }),
      {
        body: t.Object({
          type: t.Union([
            t.Literal('orders'),
            t.Literal('admin2'),
            t.Literal('couriers'),
            t.Literal('coupons'),
            t.Literal('users'),
            t.Literal('user'),
            t.Literal('audit'),
          ]),
          from: t.Optional(t.Nullable(t.String({ maxLength: 40 }))),
          to: t.Optional(t.Nullable(t.String({ maxLength: 40 }))),
          status: t.Optional(t.Nullable(t.String({ maxLength: 20 }))),
          deliveryType: t.Optional(
            t.Nullable(t.Union([t.Literal('all'), t.Literal('DELIVERY'), t.Literal('PICKUP'), t.Literal('DINE_IN')])),
          ),
          adminUserId: t.Optional(t.Nullable(t.String({ pattern: UUID_PATTERN }))),
          courierId: t.Optional(t.Nullable(t.String({ pattern: UUID_PATTERN }))),
          phone: t.Optional(t.Nullable(t.String({ maxLength: 11 }))),
        }),
        detail: {
          summary: 'Dashboard reports box — one endpoint, seven report types',
          description:
            'Main admin only. Orders (status/deliveryType filters), level-2 admin activities, courier deliveries, coupon details, users, single user (phone), audit-log. Dates are gregorian ISO; frontend converts from Jalali.',
        },
      },
    )
