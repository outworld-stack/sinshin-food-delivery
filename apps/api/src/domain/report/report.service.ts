//src/domain/report/report.service.ts
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import { orders, users, walletTransactions } from '#/infra/db/schema'
import type { AppConfig } from '#/infra/config/env'
import type { SmsService } from '#/infra/sms/sms.service'
import type { ReportLinks } from './report-links'
import type { ReportViewModel } from '#/http/templates/report'
import type { ReconcileService } from '#/domain/reconcile/reconcile.service'


const faNum = (n: number) => n.toLocaleString('fa-IR')
const faDelivery = (t: string) =>
  t === 'DELIVERY' ? 'ارسال با پیک' : t === 'PICKUP' ? 'بیرون‌بر' : 'سرو در سالن'
const faStatus = (s: string) =>
  s === 'PAID' ? 'در انتظار تایید'
    : s === 'CONFIRMED' ? 'تایید شده'
      : s === 'ON_THE_WAY' ? 'در مسیر'
        : s === 'DELIVERED' ? 'تحویل شده'
          : s === 'CANCELED' ? 'پرداخت ناموفق'
            : 'در انتظار پرداخت'
const faDate = (d: Date) =>
  new Intl.DateTimeFormat('fa-IR', { dateStyle: 'short', timeStyle: 'short' }).format(d)

export class ReportService {
  constructor(
    private readonly deps: {
      db: Db
      config: AppConfig
      sms: SmsService
      links: ReportLinks
      reconcile: ReconcileService
    },
  ) { }

  // ══ گزارش‌های cron — ViewModel ══

  async dailyViewModel(range?: 'yesterday' | 'today'): Promise<ReportViewModel> {
    const range2 = range === 'today' ? 'today' : 'yesterday'
    const { from, to } = range2 === 'today' ? await this.todayRangeTehran() : await this.yesterdayRangeTehran()
    return this.buildViewModel('گزارش روزانه', from, to, this.deps.links.cronToken('daily'), range2)
  }

  async weeklyViewModel(): Promise<ReportViewModel> {
    const { from, to } = await this.lastWeekRangeTehran()
    return this.buildViewModel('گزارش هفتگی', from, to, this.deps.links.cronToken('weekly'), 'week')
  }
  private async buildViewModel(
    title: string,
    from: Date,
    to: Date,
    token: string,
    range: 'yesterday' | 'today' | 'week',
  ): Promise<ReportViewModel> {
    const [orderRows, walletRows] = await this.orderAndWalletRows(from, to)
    const agg = await this.summaryAggregate(from, to)
    // بخش مغایرت‌ها — فقط وقتی چیزی باز است
    const rec = await this.deps.reconcile.summary()
    const reconcileSection =
      rec.open > 0
        ? {
          head: ['چک', 'تعداد'],
          rows: Object.entries(rec.byCheck).map(([k, v]) => [k, String(v)]),
        }
        : null

    return {
      title,
      subtitle: this.rangeLabel(from, to),
      range,
      reconcile: reconcileSection,
      csvUrl: `/api/reports/csv/${token}`,
      stats: [
        { label: 'تعداد سفارش', value: faNum(agg.count) },
        { label: 'مبلغ کل (تومان)', value: faNum(agg.amount) },
        { label: 'میانگین سفارش (تومان)', value: faNum(agg.avg) },
      ],
      orders: {
        head: ['شناسه', 'نوع تحویل', 'وضعیت', 'مبلغ کل', 'پرداخت آنلاین', 'کیف پول', 'تخفیف', 'ارسال', 'بسته‌بندی', 'مشتری', 'زمان ثبت'],
        rows: orderRows.map(({ o, u }) => [
          o.displayId,
          faDelivery(o.deliveryType),
          faStatus(o.status),
          faNum(o.breakdown.totalAmount),
          faNum(o.breakdown.amountPaidOnline),
          faNum(o.breakdown.walletDeduction),
          faNum(o.breakdown.discount),
          faNum(o.breakdown.deliveryFee),
          faNum(o.breakdown.packagingFee),
          u.phone,
          faDate(o.createdAt),
        ]),
      },
      wallet: {
        head: ['نوع', 'مبلغ (تومان)', 'توضیح', 'زمان'],
        rows: walletRows.map(({ w }) => [
          w.type === 'DEPOSIT' ? 'واریز' : 'برداشت',
          faNum(w.amount),
          w.description,
          faDate(w.createdAt),
        ]),
      },
    }
  }

  // ══ CSV ══

  async csvBody(range: 'yesterday' | 'today' | 'week'): Promise<string> {
    let from: Date, to: Date
    if (range === 'week') {
      ; ({ from, to } = await this.lastWeekRangeTehran())
    } else if (range === 'today') {
      ; ({ from, to } = await this.todayRangeTehran())
    } else {
      ; ({ from, to } = await this.yesterdayRangeTehran())
    }
    const [orderRows] = await this.orderAndWalletRows(from, to)

    const lines = [
      'شناسه,نوع تحویل,وضعیت,مبلغ کل,پرداخت آنلاین,کیف پول,تخفیف,ارسال,بسته‌بندی,مشتری,زمان ثبت',
    ]
    for (const { o, u } of orderRows) {
      const cells = [
        o.displayId,
        faDelivery(o.deliveryType),
        faStatus(o.status),
        o.breakdown.totalAmount,
        o.breakdown.amountPaidOnline,
        o.breakdown.walletDeduction,
        o.breakdown.discount,
        o.breakdown.deliveryFee,
        o.breakdown.packagingFee,
        u.phone,
        o.createdAt.toISOString(),
      ].map((c) => `"${String(c).replace(/"/g, '""')}"`)
      lines.push(cells.join(','))
    }
    return '\uFEFF' + lines.join('\r\n')
  }

  // ══ پیامک ══

  async smsReportLink(kind: 'daily' | 'weekly'): Promise<void> {
    const token = this.deps.links.cronToken(kind)
    const url = this.deps.links.url(`/api/reports/view/${token}`)
    const label = kind === 'daily' ? 'روزانه' : 'هفتگی'
    for (const phone of this.deps.config.superAdminPhones) {
      await this.deps.sms.send(phone, `گزارش ${label} سین‌شین: ${url}`)
    }
    console.log(
      `[report] ${kind} report SMS sent to ${this.deps.config.superAdminPhones.length} admin(s)`,
    )
  }

  // ══ داخلی ══

  private async orderAndWalletRows(from: Date, to: Date) {
    return Promise.all([
      this.deps.db
        .select({ o: orders, u: users })
        .from(orders)
        .innerJoin(users, eq(users.id, orders.userId))
        .where(and(gte(orders.createdAt, from), lte(orders.createdAt, to)))
        .orderBy(desc(orders.createdAt)),
      this.deps.db
        .select({ w: walletTransactions })
        .from(walletTransactions)
        .where(
          and(
            gte(walletTransactions.createdAt, from),
            lte(walletTransactions.createdAt, to),
          ),
        ),
    ])
  }

  private async summaryAggregate(from: Date, to: Date) {
    const r = await this.deps.db
      .select({
        count: sql<number>`count(*)::int`,
        amount: sql<number>`coalesce(sum(${orders.totalAmount}), 0)::int`,
      })
      .from(orders)
      .where(
        and(
          gte(orders.createdAt, from),
          lte(orders.createdAt, to),
          sql`${orders.status} <> 'CANCELED'`,
        ),
      )
    const count = r[0]?.count ?? 0
    const amount = r[0]?.amount ?? 0
    return { count, amount, avg: count > 0 ? Math.round(amount / count) : 0 }
  }

  // ── بازه‌ها — تهران ──

  /** دیروز تهران */
  private async yesterdayRangeTehran(): Promise<{ from: Date; to: Date }> {
    const r = await this.deps.db.execute(sql`
      select (date_trunc('day', now() at time zone 'Asia/Tehran') - interval '1 day') at time zone 'Asia/Tehran' as from,
             date_trunc('day', now() at time zone 'Asia/Tehran') at time zone 'Asia/Tehran' as to
    `)
    const row = (r as unknown as Array<{ from: Date; to: Date }>)[0]
    if (!row) throw new Error('[report] range query failed')
    return { from: new Date(row.from), to: new Date(row.to) }
  }


  /** هفته‌ی قبل — شنبه تا جمعه تهران
   *  phase-5: date_trunc('week') در PG «دوشنبه‌محور» است → قبلاً بازه‌ی
   *  سه‌شنبه‌تا‌سه‌شنبه می‌داد! محاسبه‌ی درست: شنبه‌ی جاریِ ایرانی = d − ((dow+1)%7)
   *  (dow در PG: یکشنبه=۰ … شنبه=۶) → هفته‌ی قبل = [شنبه‌جاری − ۷ ، شنبه‌جاری)
   */
  private async lastWeekRangeTehran(): Promise<{ from: Date; to: Date }> {
    const r = await this.deps.db.execute(sql`
      select (d::date - off - 7) at time zone 'Asia/Tehran' as from,
             (d::date - off) at time zone 'Asia/Tehran' as to
      from (
        select date_trunc('day', now() at time zone 'Asia/Tehran') as d,
               (extract(dow from date_trunc('day', now() at time zone 'Asia/Tehran'))::int + 1) % 7 as off
      ) w
    `)
    const row = (r as unknown as Array<{ from: Date; to: Date }>)[0]
    if (!row) throw new Error('[report] range query failed')
    return { from: new Date(row.from), to: new Date(row.to) }
  }

  private async todayRangeTehran(): Promise<{ from: Date; to: Date }> {
    const r = await this.deps.db.execute(sql`
      select date_trunc('day', now() at time zone 'Asia/Tehran') at time zone 'Asia/Tehran' as from,
             now() as to
    `)
    const row = (r as unknown as Array<{ from: Date; to: Date }>)[0]
    if (!row) throw new Error('[report] range query failed')
    return { from: new Date(row.from), to: new Date(row.to) }
  }

  private rangeLabel(from: Date, _to: Date): string {
    const f = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'full' }).format(from)
    return `${f} — سین‌شین فودپارک`
  }
}