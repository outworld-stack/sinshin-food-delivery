// ═══════════════════════════════════════════════════════════════
// phase-2 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/domain/report/report.service.ts
// وضعیت: جایگزینی کامل فایل موجود (پایه: نسخه‌ی فاز-۱ با M22)
// تغییر فاز-۲:
//   • SMS.ir فقط TOKEN می‌گیرد (قالب daily-report / weekly-report)
//   • گزارش روزانه: لاگ داکر + سفارشات + کاربران جدید → بسته‌ی ZIP
//     قابل دانلود از /api/reports/download/:token
//   • گزارش هفتگی: همه‌ی سفارشات + همه‌ی کاربران هفته → ZIP
//   • بعد از ارسال روزانه، لاگ داکر روی سرور پاک (truncate) می‌شود
// ═══════════════════════════════════════════════════════════════

//src/domain/report/report.service.ts
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import { orders, users, walletTransactions } from '#/infra/db/schema'
import type { AppConfig } from '#/infra/config/env'
import type { SmsService } from '#/infra/sms/sms.service'
import type { ReportLinks, ReportKind } from './report-links'
import type { ReportViewModel } from '#/http/templates/report'
import type { ReconcileService } from '#/domain/reconcile/reconcile.service'
import { faNum, faDate, ORDER_TABLE_HEAD, orderRow } from './format'
import type { DockerLogsService } from '#/infra/logs/docker-logs.service'
import { buildZip } from '#/infra/report/zip'

/** سقف دفاعی ردیف‌ها در CSV (فاز-۱/M22) */
const MAX_CSV_ROWS = 10_000

const USERS_TABLE_HEAD = [
  'شناسه', 'شماره', 'نام', 'نقش', 'تاریخ عضویت', 'آخرین ورود', 'وضعیت',
] as const

export class ReportService {
  constructor(
    private readonly deps: {
      db: Db
      config: AppConfig
      sms: SmsService
      links: ReportLinks
      reconcile: ReconcileService
      dockerLogs: DockerLogsService
    },
  ) { }

  // ══ گزارش‌های cron — ViewModel (صفحه‌ی زنده) ══

  async dailyViewModel(range?: 'yesterday' | 'today'): Promise<ReportViewModel> {
    const range2 = range === 'today' ? 'today' : 'yesterday'
    const { from, to } = range2 === 'today' ? await this.todayRangeTehran() : await this.yesterdayRangeTehran()
    return this.buildViewModel('گزارش روزانه', from, to, this.deps.links.reportToken('daily'), range2)
  }

  async weeklyViewModel(): Promise<ReportViewModel> {
    const { from, to } = await this.lastWeekRangeTehran()
    return this.buildViewModel('گزارش هفتگی', from, to, this.deps.links.reportToken('weekly'), 'week')
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
        head: ORDER_TABLE_HEAD,
        rows: orderRows.map(({ o, u }) => orderRow(o, u, { num: faNum, date: faDate })),
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

  // ══ خروجی CSV (سفارش‌ها — مثل قبل) ══

  async csvBody(range: 'yesterday' | 'today' | 'week'): Promise<string> {
    const { from, to } = await this.rangeOf(range)
    const [allRows] = await this.orderAndWalletRows(from, to)
    if (allRows.length > MAX_CSV_ROWS) {
      console.warn(`[reports] csv capped: ${allRows.length} → ${MAX_CSV_ROWS} rows`)
    }
    const orderRows = allRows.slice(0, MAX_CSV_ROWS)

    const lines = [ORDER_TABLE_HEAD.join(',')]
    for (const { o, u } of orderRows) {
      const cells = orderRow(o, u, { num: String, date: (d) => d.toISOString() })
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
      lines.push(cells.join(','))
    }
    return '\uFEFF' + lines.join('\r\n')
  }

  // ══ فاز-۲ — بسته‌ی ZIP قابل دانلود ══

  /**
   * بسته‌ی روزانه: لاگ‌های داکر (آرشیوِ زمانِ job) + سفارشات امروز/دیروز
   * + کاربران جدید. داده‌های DB موقع باز شدنِ لینک تازه می‌شوند؛ فایل لاگ
   * همان آرشیوِ زمان ارسال پیامک است (لاگ روی سرور پس از ارسال پاک شده).
   */
  async dailyBundle(range?: 'yesterday' | 'today'): Promise<Uint8Array> {
    const range2 = range === 'today' ? 'today' : 'yesterday'
    const { from, to } = range2 === 'today' ? await this.todayRangeTehran() : await this.yesterdayRangeTehran()
    const [ordersCsv, newUsersCsv, agg] = await Promise.all([
      this.ordersCsv(from, to),
      this.usersCsv(from, to),
      this.summaryAggregate(from, to),
    ])

    const entries = [
      { name: 'summary.txt', data: this.summaryText('گزارش روزانه سین‌شین', from, to, agg, range2) },
      { name: 'orders.csv', data: ordersCsv },
      { name: 'new-users.csv', data: newUsersCsv },
    ]

    // لاگ داکر — از آرشیوِ امروز (زمان ارسال پیامک ساخته شده)
    const logs = this.deps.dockerLogs.readArchive(this.deps.dockerLogs.todayArchivePath())
    if (logs !== null) {
      entries.push({ name: 'docker-logs.txt', data: logs })
    } else {
      entries.push({
        name: 'docker-logs.txt',
        data:
          'لاگ داکر برای این بازه در آرشیو نیست.\n' +
          'علت‌های محتمل: DOCKER_LOGS_ENABLED خاموش است، سوکت داکر در دسترس نیست، ' +
          'یا لینک بعد از ۳ روز (پاک‌سازی آرشیو) باز شده است.\n' +
          'بقیه‌ی فایل‌های بسته کامل و معتبرند.',
      })
    }

    return buildZip(entries)
  }

  /** بسته‌ی هفتگی: همه‌ی سفارشات + همه‌ی کاربران هفته‌ی قبل */
  async weeklyBundle(): Promise<Uint8Array> {
    const { from, to } = await this.lastWeekRangeTehran()
    const [ordersCsv, usersCsv, agg] = await Promise.all([
      this.ordersCsv(from, to),
      this.usersCsv(from, to),
      this.summaryAggregate(from, to),
    ])
    return buildZip([
      { name: 'summary.txt', data: this.summaryText('گزارش هفتگی سین‌شین', from, to, agg, 'week') },
      { name: 'orders.csv', data: ordersCsv },
      { name: 'users.csv', data: usersCsv },
    ])
  }

  // ══ فاز-۲ — جریان‌های زمان‌بند (job + trigger دستی ادمین) ══

  /**
   * جریان روزانه — ترتیب مهم است:
   *  ۱) لاگ داکر از «آخرین جمع‌آوری» تا الان جمع و آرشیو می‌شود
   *  ۲) لاگ کانتینرها روی سرور truncate می‌شود (پاک‌سازی — بعد از آرشیو)
   *  ۳) توکن امضاشده + پیامک به همه‌ی ادمین‌های اصلی (فقط TOKEN —
   *     SMS.ir خودش لینک را از قالب می‌سازد)
   * اگر مرحله ۱/۲ شکست بخورد پیامک «همچنان» می‌رود (بسته بدون لاگ) —
   * گزارشِ مالی هرگز قربانی لاگ داکر نمی‌شود.
   */
  async runDailyFlow(): Promise<{ token: string; smsOk: number; logs: string }> {
    const collect = await this.deps.dockerLogs.collectAndArchive()
    const logsNote =
      collect.collected
        ? `لاگ ${collect.containers} کانتینر آرشیو شد (${(collect.bytes / 1024).toFixed(0)}KB)` +
          (collect.skipped.length > 0 ? ` — skip: ${collect.skipped.join(' , ')}` : '')
        : `لاگ داکر جمع نشد (${collect.skipped.join(' , ')})`
    if (collect.collected) {
      const trunc = await this.deps.dockerLogs.truncateAll()
      console.log(`[report:daily] docker logs: ${logsNote} | truncate: ${trunc.note} (${trunc.truncated.length})`)
    } else {
      console.warn(`[report:daily] docker logs: ${logsNote}`)
    }

    const token = this.deps.links.reportToken('daily')
    const smsOk = await this.smsTokenToAdmins('daily', token)
    console.log(
      `[report:daily] SMS sent to ${smsOk}/${this.deps.config.superAdminPhones.length} admin(s); token TTL ${this.deps.config.reports.tokenTtlHours}h`,
    )
    return { token, smsOk, logs: logsNote }
  }

  /** جریان هفتگی — توکن + پیامک (لاگ/پاک‌سازی ندارد) */
  async runWeeklyFlow(): Promise<{ token: string; smsOk: number }> {
    const token = this.deps.links.reportToken('weekly')
    const smsOk = await this.smsTokenToAdmins('weekly', token)
    console.log(
      `[report:weekly] SMS sent to ${smsOk}/${this.deps.config.superAdminPhones.length} admin(s)`,
    )
    return { token, smsOk }
  }

  /** پیامک TOKEN به همه‌ی ادمین‌های اصلی — فاز-۲: بدون URL (قالب می‌سازدش) */
  private async smsTokenToAdmins(kind: ReportKind, token: string): Promise<number> {
    let ok = 0
    for (const phone of this.deps.config.superAdminPhones) {
      const sent = await this.deps.sms.sendReportToken(phone, kind, token)
      if (sent) ok++
    }
    return ok
  }

  // ══ داخلی ══

  private async rangeOf(range: 'yesterday' | 'today' | 'week'): Promise<{ from: Date; to: Date }> {
    if (range === 'week') return this.lastWeekRangeTehran()
    if (range === 'today') return this.todayRangeTehran()
    return this.yesterdayRangeTehran()
  }

  /** CSV سفارشات بازه — همان قالب csvBody (سقف M22) */
  private async ordersCsv(from: Date, to: Date): Promise<string> {
    const [allRows] = await this.orderAndWalletRows(from, to)
    if (allRows.length > MAX_CSV_ROWS) {
      console.warn(`[reports] zip csv capped: ${allRows.length} → ${MAX_CSV_ROWS} rows`)
    }
    const rows = allRows.slice(0, MAX_CSV_ROWS)
    const lines = [ORDER_TABLE_HEAD.join(',')]
    for (const { o, u } of rows) {
      const cells = orderRow(o, u, { num: String, date: (d) => d.toISOString() })
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
      lines.push(cells.join(','))
    }
    return '\uFEFF' + lines.join('\r\n')
  }

  /** CSV کاربران بازه — ثبت‌نام‌های جدید (روزانه) یا همه‌ی کاربران هفته (هفتگی) */
  private async usersCsv(from: Date, to: Date): Promise<string> {
    const rows = await this.deps.db
      .select()
      .from(users)
      .where(and(gte(users.createdAt, from), lte(users.createdAt, to)))
      .orderBy(desc(users.createdAt))
      .limit(MAX_CSV_ROWS)

    const lines = [USERS_TABLE_HEAD.join(',')]
    for (const u of rows) {
      const cells = [
        u.id,
        u.phone,
        u.name ?? '',
        u.role,
        u.createdAt.toISOString(),
        u.lastLoginAt ? u.lastLoginAt.toISOString() : '',
        u.bannedAt ? 'مسدود' : u.suspendedAt ? 'معلق' : 'فعال',
      ]
      lines.push(cells.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    }
    return '\uFEFF' + lines.join('\r\n')
  }

  /** خلاصه‌ی متنی داخل ZIP — خوانا بدون اکسل */
  private summaryText(
    title: string,
    from: Date,
    to: Date,
    agg: { count: number; amount: number; avg: number },
    range: 'yesterday' | 'today' | 'week',
  ): string {
    const fromFa = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'full' }).format(from)
    const toFa = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'full' }).format(to)
    return [
      `${title}`,
      `بازه: ${fromFa} تا ${toFa}`,
      `تولید: ${new Date().toISOString()}`,
      '',
      `تعداد سفارش: ${faNum(agg.count)}`,
      `مبلغ کل (تومان): ${faNum(agg.amount)}`,
      `میانگین سفارش (تومان): ${faNum(agg.avg)}`,
      '',
      'فایل‌های این بسته:',
      range === 'week'
        ? '  • orders.csv — سفارشات هفته' + '\n  • users.csv — کاربران هفته'
        : '  • orders.csv — سفارشات روز' + '\n  • new-users.csv — کاربران جدید روز' + '\n  • docker-logs.txt — لاگ داکر سرور',
      '',
      'این بسته با یک توکن امضاشده‌ی منقضی‌شونده ساخته شده؛ بعد از انقضا دیگر در دسترس نیست.',
    ].join('\n')
  }

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
