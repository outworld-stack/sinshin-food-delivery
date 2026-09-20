//src/http/routes/report-panel.routes.ts
import { Elysia, t } from 'elysia'
import { html } from '@elysia/html'
import { and, desc, eq, sql } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import {
  admin2Activities,
  courierDeliveries,
  courierTrips,
  couriers,
  orders,
  users,
} from '#/infra/db/schema'
import { asUserId, asCourierId } from '#/domain/shared/brand'
import type { ReportLinks } from '#/domain/report/report-links'
import { MiniReportPage } from '#/http/templates/mini-report'

export interface ReportPanelRoutesDeps {
  db: Db
  links: ReportLinks
}

const faNum = (n: number) => n.toLocaleString('fa-IR')
const faDate = (d: Date) =>
  new Intl.DateTimeFormat('fa-IR', { dateStyle: 'short', timeStyle: 'short' }).format(d)

export const reportPanelRoutes = (deps: ReportPanelRoutesDeps) =>
  new Elysia({ prefix: '/reports/panel', tags: ['Reports'] })
    .use(html())
    .get(
      '/:token',
      async ({ params }) => {
        const scope = deps.links.verifyPanel(params.token)
        if (!scope) {
          return new Response(
            JSON.stringify({ error: { code: 'FORBIDDEN', message: 'لینک گزارش نامعتبر است.' } }),
            { status: 403, headers: { 'content-type': 'application/json' } },
          )
        }

        switch (scope.page) {
          case 'my-orders':
            return await myOrdersReport(deps, scope.userId ?? '')
          case 'my-activities':
            return await myActivitiesReport(deps, scope.userId ?? '')
          case 'courier-deliveries':
            return await courierDeliveriesReport(deps, scope.filters)
          case 'user-orders':
            return await userOrdersReport(deps, scope.filters)
          default:
            return new Response('نوع گزارش نامعتبر است', { status: 404 })
        }
      },
      {
        params: t.Object({ token: t.String({ maxLength: 800 }) }),
        detail: { summary: 'Panel live-report page (scoped signed token)' },
      },
    )

// ══ renderer ها — در همین فایل ══

async function myOrdersReport(deps: ReportPanelRoutesDeps, adminUserId: string) {
  const rows = await deps.db
    .select({ o: orders })
    .from(orders)
    .where(and(eq(orders.confirmedBy, adminUserId), sql`${orders.status} <> 'CANCELED'`))
    .orderBy(desc(orders.createdAt))
    .limit(500)

  return MiniReportPage({
    title: 'سفارشات تاییدشده‌ی من',
    subtitle: 'ادمین سطح ۲ — سین‌شین',
    stats: [
      { label: 'تعداد', value: faNum(rows.length) },
      { label: 'مبلغ کل (تومان)', value: faNum(rows.reduce((s, r) => s + r.o.totalAmount, 0)) },
    ],
    tables: [
      {
        title: 'سفارشات',
        head: ['شناسه', 'نوع', 'وضعیت', 'مبلغ (تومان)', 'زمان'],
        rows: rows.map(({ o }) => [
          o.displayId,
          o.deliveryType,
          o.status,
          faNum(o.totalAmount),
          faDate(o.createdAt),
        ]),
      },
    ],
  })
}

async function myActivitiesReport(deps: ReportPanelRoutesDeps, adminUserId: string) {
  const rows = await deps.db
    .select()
    .from(admin2Activities)
    .where(eq(admin2Activities.adminUserId, asUserId(adminUserId)))
    .orderBy(desc(admin2Activities.createdAt))
    .limit(500)

  return MiniReportPage({
    title: 'فعالیت‌های من',
    subtitle: 'گزارش کامل فعالیت ادمین سطح ۲',
    tables: [
      {
        title: 'فعالیت‌ها',
        head: ['نوع', 'سفارش', 'جزئیات', 'زمان'],
        rows: rows.map((a) => [
          a.action,
          a.orderDisplayId ?? '-',
          JSON.stringify(a.metadata),
          faDate(a.createdAt),
        ]),
      },
    ],
  })
}

async function courierDeliveriesReport(
  deps: ReportPanelRoutesDeps,
  filters: Record<string, string>,
) {
  const courierId = filters.courierId
  const rows = await deps.db
    .select({ d: courierDeliveries, c: couriers })
    .from(courierDeliveries)
    .innerJoin(courierTrips, eq(courierTrips.id, courierDeliveries.tripId))
    .innerJoin(couriers, eq(couriers.id, courierTrips.courierId))
    .where(courierId ? eq(courierTrips.courierId, asCourierId(courierId)) : sql`true`)
    .orderBy(desc(courierDeliveries.deliveredAt))
    .limit(1000)

  return MiniReportPage({
    title: 'تحویل‌های پیک',
    subtitle: courierId ? `پیک انتخابی` : 'همه‌ی پیک‌ها',
    stats: [
      { label: 'تعداد تحویل', value: faNum(rows.length) },
      { label: 'مجموع مبالغ (تومان)', value: faNum(rows.reduce((s, r) => s + r.d.amount, 0)) },
    ],
    tables: [
      {
        title: 'تحویل‌ها',
        head: ['پیک', 'سفارش', 'آدرس', 'مبلغ (تومان)', 'زمان تحویل'],
        rows: rows.map(({ d, c }) => [
          c.name,
          d.orderId,
          d.addressSnapshot,
          faNum(d.amount),
          faDate(d.deliveredAt),
        ]),
      },
    ],
  })
}

async function userOrdersReport(deps: ReportPanelRoutesDeps, filters: Record<string, string>) {
  const phone = filters.phone ?? ''
  const target = phone
    ? (await deps.db.select().from(users).where(eq(users.phone, phone)))[0]
    : undefined
  if (!target) return new Response('کاربر پیدا نشد', { status: 404 })

  const rows = await deps.db
    .select()
    .from(orders)
    .where(eq(orders.userId, target.id))
    .orderBy(desc(orders.createdAt))
    .limit(500)

  return MiniReportPage({
    title: `سفارشات کاربر ${target.phone}`,
    subtitle: 'پنل ادمین — سین‌شین',
    tables: [
      {
        title: 'سفارشات',
        head: ['شناسه', 'نوع', 'وضعیت', 'مبلغ (تومان)', 'زمان'],
        rows: rows.map((o) => [
          o.displayId,
          o.deliveryType,
          o.status,
          faNum(o.totalAmount),
          faDate(o.createdAt),
        ]),
      },
    ],
  })
}