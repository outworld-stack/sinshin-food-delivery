// ═══════════════════════════════════════════════════════════════
// stage-55 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/domain/report/report.service.ts
// وضعیت: جایگزینی کامل فایل موجود
// تغییر: جمع درآمد تجمیعی گزارش‌های cron با ::bigint + Number — رارد C1 (سرریز int)
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// phase-2 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/domain/report/report.service.ts
// وضعیت: جایگزینی کامل فایل موجود (پایه: نسخه‌ی فاز-۱ با M22)
// تغییر فاز-۲:
//   • SMS.ir فقط TOKEN می‌گیرد (قالب daily-report / weekly-report)
//   • گزارش روزانه: لاگ داکر + سفارشات + کاربران جدید → بسته‌ی ZIP
//     قابل دانلود از /api/reports/download/:token
//   • گزارش هفتگی: همه‌ی سفارشات + همه‌ی کاربران هفته → ZIP
//   • بسته قبل از پیامک ذخیره و بررسی می‌شود؛ لاگ زنده داکر پاک نمی‌شود
// ═══════════════════════════════════════════════════════════════

//src/domain/report/report.service.ts
import { and, desc, eq, gte, lt, ne, sql } from 'drizzle-orm'

import type { Db, DbOrTx } from '#/infra/db/client'
import { orders, users, walletTransactions } from '#/infra/db/schema'
import type { AppConfig } from '#/infra/config/env'
import type { SmsService } from '#/infra/sms/sms.service'
import type { ReportLinks, ReportKind } from './report-links'
import type { ReportViewModel } from '#/http/templates/report'
import type { ReconcileService } from '#/domain/reconcile/reconcile.service'
import { faNum, faDate, ORDER_TABLE_HEAD, orderRow } from './format'
import type { DockerLogsService } from '#/infra/logs/docker-logs.service'
import { buildZip } from '#/infra/report/zip'
import { ReportArchiveStore, type ReportArchive, type ReportPublication } from '#/infra/report/report-archive'
import { Err } from '#/domain/shared/errors'

/** سقف دفاعی ردیف‌ها در CSV (فاز-۱/M22) */
const MAX_CSV_ROWS = 10_000

const USERS_TABLE_HEAD = [
  'شناسه', 'شماره', 'نام', 'نقش', 'تاریخ عضویت', 'آخرین ورود', 'وضعیت',
] as const

export class ReportService {
  private readonly archives: ReportArchiveStore
  constructor(
    private readonly deps: {
      db: Db
      config: AppConfig
      sms: SmsService
      links: ReportLinks
      reconcile: ReconcileService
      dockerLogs: DockerLogsService
    },
  ) {
    this.archives = new ReportArchiveStore(deps.config.uploadDir)
  }

  // ══ گزارش‌های cron — ViewModel (صفحه‌ی زنده) ══

  async dailyViewModel(range?: 'yesterday' | 'today'): Promise<ReportViewModel> {
    const range2 = range === 'today' ? 'today' : 'yesterday'
    const { from, to } = range2 === 'today' ? await this.todayRangeTehran() : await this.yesterdayRangeTehran()
    return this.buildViewModel('گزارش روزانه', from, to, null, range2)
  }

  async weeklyViewModel(): Promise<ReportViewModel> {
    const { from, to } = await this.lastWeekRangeTehran()
    return this.buildViewModel('گزارش هفتگی', from, to, null, 'week')
  }
  private async buildViewModel(
    title: string,
    from: Date,
    to: Date,
    token: string | null,
    range: 'yesterday' | 'today' | 'week',
    db: DbOrTx = this.deps.db,
  ): Promise<ReportViewModel> {
    const [orderRows, walletRows] = await this.orderAndWalletRows(from, to, db)
    const agg = await this.summaryAggregate(from, to, db)
    // بخش مغایرت‌ها — فقط وقتی چیزی باز است
    const rec = await this.deps.reconcile.summary(db).catch(() => {
      console.warn('[reports] reconciliation summary unavailable; financial report remains available')
      return { open: 0, byCheck: {} }
    })
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
      csvUrl: token ? `/api/reports/csv/${token}` : '',
      downloadUrl: token ? `/api/reports/download/${token}` : undefined,
      stats: [
        { label: 'تعداد سفارش پرداخت‌شده', value: faNum(agg.count) },
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

  /** Legacy live builder; SMS download routes use the persisted snapshot methods below. */
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

  /** Publish and verify the exact download before sending its SMS or advancing the log marker. */
  async runDailyFlow(): Promise<{ token: string; smsOk: number; logs: string }> {
    this.requireRecipients()
    const token = this.deps.links.reportToken('daily')
    const collect = await this.deps.dockerLogs.collectAndArchive()
    const logsNote =
      collect.collected
        ? `لاگ ${collect.containers} کانتینر آرشیو شد (${(collect.bytes / 1024).toFixed(0)}KB)` +
          (collect.skipped.length > 0 ? ` — skip: ${collect.skipped.join(' , ')}` : '')
        : `لاگ داکر جمع نشد (${collect.skipped.join(' , ')})`
    const logText = collect.archivePath ? this.deps.dockerLogs.readArchive(collect.archivePath) : null
    const publication = await this.createSnapshot(token, { logText })
    const smsOk = await this.smsTokenToAdmins('daily', token)
    // Docker's log rotation handles retention; truncating live files here would lose later log lines.
    if (publication.created && collect.collected && collect.archivePath && logText !== null && collect.skipped.length === 0) {
      this.deps.dockerLogs.completeCollection(collect)
      console.log(`[report:daily] docker logs: ${logsNote}`)
    } else {
      console.warn(`[report:daily] docker logs: ${logsNote}`)
    }

    console.log(
      `[report:daily] SMS sent to ${smsOk}/${this.deps.config.superAdminPhones.length} admin(s); token TTL ${this.deps.config.reports.tokenTtlHours}h`,
    )
    return { token, smsOk, logs: logsNote }
  }

  /** The weekly file is saved before the link leaves this server. */
  async runWeeklyFlow(): Promise<{ token: string; smsOk: number }> {
    this.requireRecipients()
    const token = this.deps.links.reportToken('weekly')
    await this.createSnapshot(token)
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
    if (ok === 0) throw Err.serviceUnavailable('فایل گزارش ذخیره شد، اما ارسال پیامک ناموفق بود؛ دوباره تلاش کنید.')
    if (ok < this.deps.config.superAdminPhones.length) {
      console.warn(`[reports] partial SMS delivery: ${ok}/${this.deps.config.superAdminPhones.length} admin(s)`)
    }
    return ok
  }

  private requireRecipients(): void {
    if (this.deps.config.superAdminPhones.length === 0) {
      throw Err.serviceUnavailable('شماره ادمین اصلی برای ارسال گزارش تنظیم نشده است.')
    }
  }

  async downloadSnapshot(token: string): Promise<{ bytes: Uint8Array; kind: ReportKind; filename: string } | null> {
    const snapshot = await this.snapshot(token)
    return snapshot ? { bytes: snapshot.bytes, kind: snapshot.kind, filename: snapshot.filename } : null
  }

  async snapshotCsv(token: string): Promise<string | null> {
    return (await this.snapshot(token))?.ordersCsv ?? null
  }

  async snapshotViewModel(token: string): Promise<ReportViewModel | null> {
    return (await this.snapshot(token))?.viewModel ?? null
  }

  private async snapshot(token: string): Promise<ReportArchive | null> {
    const details = this.deps.links.verifyReportDetails(token)
    if (!details) return null
    try {
      const archive = await this.archives.read(token)
      if (archive) {
        this.assertTokenMetadata(archive, details)
        return archive
      }
      // Old full-length links predate persisted files; preserve their original period on first access.
      return token.startsWith('r.') ? (await this.createSnapshot(token)).archive : null
    } catch (error) {
      console.error('[reports] archive could not be read:', error instanceof Error ? error.message : 'unknown error')
      throw Err.serviceUnavailable('فایل گزارش قابل خواندن نیست؛ گزارش را دوباره از پنل دریافت کنید.')
    }
  }

  private assertTokenMetadata(archive: ReportArchive, details: { kind: ReportKind; issuedAt: number; expiresAt: number }): void {
    if (archive.kind !== details.kind || archive.issuedAt !== details.issuedAt || archive.expiresAt !== details.expiresAt) {
      throw new Error('Report archive token metadata mismatch')
    }
  }

  private async createSnapshot(token: string, collected?: { logText: string | null }): Promise<ReportPublication> {
    const details = this.deps.links.verifyReportDetails(token)
    if (!details) throw new Error('Cannot generate a report for an invalid token')
    const existing = await this.archives.read(token)
    if (existing) {
      this.assertTokenMetadata(existing, details)
      return { archive: existing, created: false }
    }
    const anchor = new Date(details.issuedAt * 1000)
    const range = details.kind === 'weekly' ? 'week' : 'yesterday'
    const { from, to } = await this.rangeOf(range, anchor)
    // Payments/refunds can change past orders while an export is being generated.
    // Every saved representation must observe the same database snapshot.
    const [ordersCsv, usersCsv, agg, viewModel] = await this.deps.db.transaction(
      async (tx) => [
        await this.ordersCsv(from, to, false, tx),
        await this.usersCsv(from, to, false, tx),
        await this.summaryAggregate(from, to, tx),
        await this.buildViewModel(details.kind === 'weekly' ? 'گزارش هفتگی' : 'گزارش روزانه', from, to, token, range, tx),
      ] as const,
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    )
    const entries = [
      { name: 'summary.txt', data: this.summaryText(details.kind === 'weekly' ? 'گزارش هفتگی سین‌شین' : 'گزارش روزانه سین‌شین', from, to, agg, range) },
      { name: 'orders.csv', data: ordersCsv },
      { name: details.kind === 'weekly' ? 'users.csv' : 'new-users.csv', data: usersCsv },
    ]
    if (details.kind === 'daily') {
      const logs = collected ? collected.logText : this.deps.dockerLogs.readArchive(this.deps.dockerLogs.archivePathFor(anchor))
      entries.push({
        name: 'docker-logs.txt',
        data: logs ?? 'لاگ داکر برای این گزارش ذخیره نشده است. جمع‌آوری لاگ خاموش یا ناموفق بوده؛ فایل‌های سفارشات و کاربران در همین بسته موجودند.\n',
      })
    }
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(from)
    const publication = await this.archives.publish(token, {
      ...details, from: from.toISOString(), to: to.toISOString(),
      filename: `sinshin-${details.kind}-report-${date}.zip`,
      bytes: buildZip(entries), ordersCsv, viewModel,
    })
    this.assertTokenMetadata(publication.archive, details)
    await this.archives.pruneExpired()
    return publication
  }

  // ══ داخلی ══

  private async rangeOf(range: 'yesterday' | 'today' | 'week', anchor = new Date()): Promise<{ from: Date; to: Date }> {
    if (range === 'week') return this.lastWeekRangeTehran(anchor)
    if (range === 'today') return this.todayRangeTehran(anchor)
    return this.yesterdayRangeTehran(anchor)
  }

  /** CSV سفارشات بازه — همان قالب csvBody (سقف M22) */
  private async ordersCsv(from: Date, to: Date, capped = true, db: DbOrTx = this.deps.db): Promise<string> {
    const [allRows] = await this.orderAndWalletRows(from, to, db)
    if (capped && allRows.length > MAX_CSV_ROWS) {
      console.warn(`[reports] zip csv capped: ${allRows.length} → ${MAX_CSV_ROWS} rows`)
    }
    const rows = capped ? allRows.slice(0, MAX_CSV_ROWS) : allRows
    const lines = [ORDER_TABLE_HEAD.join(',')]
    for (const { o, u } of rows) {
      const cells = orderRow(o, u, { num: String, date: (d) => d.toISOString() })
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
      lines.push(cells.join(','))
    }
    return '\uFEFF' + lines.join('\r\n')
  }

  /** CSV کاربران بازه — ثبت‌نام‌های جدید (روزانه) یا همه‌ی کاربران هفته (هفتگی) */
  private async usersCsv(from: Date, to: Date, capped = true, db: DbOrTx = this.deps.db): Promise<string> {
    const query = db
      .select()
      .from(users)
      .where(and(gte(users.createdAt, from), lt(users.createdAt, to)))
      .orderBy(desc(users.createdAt))
    const rows = capped ? await query.limit(MAX_CSV_ROWS) : await query

    const lines = [USERS_TABLE_HEAD.join(',')]
    for (const u of rows) {
      const cells = [
        u.id,
        u.phone,
        // Keep user-provided names as text when the downloaded CSV is opened in a spreadsheet.
        (u.name ?? '').replace(/^(\s*[=+\-@]|[\t\r\n])/, "'$1"),
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
    const dates = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'full', timeZone: 'Asia/Tehran' })
    const fromFa = dates.format(from)
    const toFa = dates.format(new Date(Math.max(from.getTime(), to.getTime() - 1)))
    return [
      `${title}`,
      `بازه: ${fromFa} تا ${toFa}`,
      `تولید: ${new Date().toISOString()}`,
      '',
      `تعداد سفارش پرداخت‌شده: ${faNum(agg.count)}`,
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

  private async orderAndWalletRows(from: Date, to: Date, db: DbOrTx = this.deps.db) {
    const orderQuery = db
        .select({ o: orders, u: users })
        .from(orders)
        .innerJoin(users, eq(users.id, orders.userId))
        // stage-98 — ردیفِ CSV: سفارشِ در-انتظارِ پرداخت «سفارش» نیست و در
        // گزارشِ مالی نمی‌آید (لغو‌شده‌ها = بازپرداختِ واقعی، می‌مانند؛
        // انقضای پنجره هم CANCELED می‌شود و با ردیفِ بازگشتِ کیف‌پولش می‌آید).
        .where(and(gte(orders.createdAt, from), lt(orders.createdAt, to), ne(orders.status, 'PENDING_PAYMENT')))
        .orderBy(desc(orders.createdAt))
    const walletQuery = db
        .select({ w: walletTransactions })
        .from(walletTransactions)
        .where(
          and(
            gte(walletTransactions.createdAt, from),
            lt(walletTransactions.createdAt, to),
          ),
        )
    // A transaction owns one connection; complete each query before starting the next.
    return db === this.deps.db ? Promise.all([orderQuery, walletQuery]) : [await orderQuery, await walletQuery] as const
  }

  private async summaryAggregate(from: Date, to: Date, db: DbOrTx = this.deps.db) {
    const r = await db
      .select({
        count: sql<number>`count(*)::int`,
        // رارد C1 — سرریز int برای درآمد تجمعی: ::bigint (بدون سقف)؛
        // Number() چون Bun.sql مقدار bigint را string برمی‌گرداند.
        amount: sql<number>`coalesce(sum(${orders.totalAmount}), 0)::bigint`,
      })
      .from(orders)
      .where(
        and(
          gte(orders.createdAt, from),
          lt(orders.createdAt, to),
          sql`${orders.status} <> 'CANCELED'`,
          eq(orders.paymentStatus, 'SUCCESS'),
        ),
      )
    const count = r[0]?.count ?? 0
    const amount = Number(r[0]?.amount ?? 0)
    return { count, amount, avg: count > 0 ? Math.round(amount / count) : 0 }
  }

  // ── بازه‌ها — تهران ──

  /** دیروز تهران */
  private async yesterdayRangeTehran(anchor = new Date()): Promise<{ from: Date; to: Date }> {
    const r = await this.deps.db.execute(sql`
      select (date_trunc('day', ${anchor.toISOString()}::timestamptz at time zone 'Asia/Tehran') - interval '1 day') at time zone 'Asia/Tehran' as from,
             date_trunc('day', ${anchor.toISOString()}::timestamptz at time zone 'Asia/Tehran') at time zone 'Asia/Tehran' as to
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
  private async lastWeekRangeTehran(anchor = new Date()): Promise<{ from: Date; to: Date }> {
    const r = await this.deps.db.execute(sql`
      select (d::date - off - 7)::timestamp at time zone 'Asia/Tehran' as from,
             (d::date - off)::timestamp at time zone 'Asia/Tehran' as to
      from (
        select date_trunc('day', ${anchor.toISOString()}::timestamptz at time zone 'Asia/Tehran') as d,
               (extract(dow from date_trunc('day', ${anchor.toISOString()}::timestamptz at time zone 'Asia/Tehran'))::int + 1) % 7 as off
      ) w
    `)
    const row = (r as unknown as Array<{ from: Date; to: Date }>)[0]
    if (!row) throw new Error('[report] range query failed')
    return { from: new Date(row.from), to: new Date(row.to) }
  }

  private async todayRangeTehran(anchor = new Date()): Promise<{ from: Date; to: Date }> {
    const r = await this.deps.db.execute(sql`
      select date_trunc('day', ${anchor.toISOString()}::timestamptz at time zone 'Asia/Tehran') at time zone 'Asia/Tehran' as from,
             ${anchor.toISOString()}::timestamptz as to
    `)
    const row = (r as unknown as Array<{ from: Date; to: Date }>)[0]
    if (!row) throw new Error('[report] range query failed')
    return { from: new Date(row.from), to: new Date(row.to) }
  }

  private rangeLabel(from: Date, to: Date): string {
    const dates = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'full', timeZone: 'Asia/Tehran' })
    const first = dates.format(from)
    const last = dates.format(new Date(Math.max(from.getTime(), to.getTime() - 1)))
    return `${first === last ? first : `${first} تا ${last}`} — سین‌شین فودپارک`
  }
}
