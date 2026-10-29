/** Real PostgreSQL report generation and HTTP downloads; all SMS/Docker traffic is injected locally. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { SQL } from 'bun'
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { Elysia } from 'elysia'
import { Database } from '../src/infra/db/client'
import type { DbOrTx } from '../src/infra/db/client'
import { AppConfig } from '../src/infra/config/env'
import { SmsService } from '../src/infra/sms/sms.service'
import { DockerLogsService, type DockerLogCollectResult } from '../src/infra/logs/docker-logs.service'
import { ReportArchiveStore } from '../src/infra/report/report-archive'
import { buildZip } from '../src/infra/report/zip'
import { ReportLinks } from '../src/domain/report/report-links'
import { ReportService } from '../src/domain/report/report.service'
import { ReconcileService } from '../src/domain/reconcile/reconcile.service'
import { AppError, Err } from '../src/domain/shared/errors'
import { reportRoutes } from '../src/http/routes/report.routes'
import { orders, users } from '../src/infra/db/schema'

const source = new URL(process.env.DATABASE_URL?.startsWith('postgres')
  ? process.env.DATABASE_URL : 'postgres://sinshin:sinshin_local@127.0.0.1:5432/sinshin')
assert(['localhost', '127.0.0.1', '[::1]'].includes(source.hostname), 'Tests require local PostgreSQL')
const scratch = `sinshin_e2e_reports_${process.pid}_${crypto.randomUUID().slice(0, 8)}`
const adminUrl = new URL(source)
adminUrl.pathname = '/postgres'
const admin = new SQL(adminUrl.toString(), { max: 1 })
const scratchUrl = new URL(source)
scratchUrl.pathname = `/${scratch}`
const artifacts = await mkdtemp(join(tmpdir(), 'sinshin-report-downloads-'))
const uploads = join(artifacts, 'private-test-uploads')
const downloads = join(artifacts, 'downloaded-files')
await mkdir(uploads)
await mkdir(downloads)
const savedNow = Date.now
const savedFetch = globalThis.fetch
const savedTimezone = process.env.TZ
process.env.TZ = 'UTC'
let clock = Date.parse('2026-10-23T21:35:00Z') // Saturday 01:05 Tehran.
Date.now = () => clock
globalThis.fetch = (() => { throw new Error('External network forbidden in report download tests') }) as unknown as typeof fetch
let database: Database | undefined
let created = false
let groups = 0
const passed = (label: string) => { groups++; console.log(`PASS ${label}`) }

async function within<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 30_000)
    })])
  } finally { clearTimeout(timer) }
}

// Independent reader for the standard ZIP STORE layout, including CRC and central-directory count.
function zipFiles(bytes: Uint8Array): Map<string, string> {
  const zip = Buffer.from(bytes)
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50, 'ZIP must end with a complete directory')
  const expectedCount = zip.readUInt16LE(zip.length - 12)
  const files = new Map<string, string>()
  let cursor = 0
  while (zip.readUInt32LE(cursor) === 0x04034b50) {
    assert.equal(zip.readUInt16LE(cursor + 8), 0, 'download uses standard uncompressed ZIP entries')
    const size = zip.readUInt32LE(cursor + 18)
    const nameLength = zip.readUInt16LE(cursor + 26)
    const extraLength = zip.readUInt16LE(cursor + 28)
    const name = zip.subarray(cursor + 30, cursor + 30 + nameLength).toString('utf8')
    const start = cursor + 30 + nameLength + extraLength
    const data = zip.subarray(start, start + size)
    assert.equal(data.length, size)
    let crc = 0xffffffff
    for (const byte of data) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
    assert.equal((crc ^ 0xffffffff) >>> 0, zip.readUInt32LE(cursor + 14), `CRC for ${name}`)
    files.set(name, data.toString('utf8'))
    cursor = start + size
  }
  assert.equal(files.size, expectedCount)
  assert.equal(zip.readUInt32LE(cursor), 0x02014b50)
  return files
}

try {
  await admin.unsafe(`create database "${scratch}"`)
  created = true
  database = new Database(scratchUrl.toString(), { max: 10 })
  const db = database.db
  await migrate(db, { migrationsFolder: import.meta.dir + '/../drizzle' })
  const configSource = {
    NODE_ENV: 'development', DATABASE_URL: scratchUrl.toString(),
    JWT_SECRET: 'report-download-test-secret-'.repeat(3), SITE_URL: 'https://sinshin.example',
    UPLOAD_DIR: uploads, SUPER_ADMIN_PHONES: '09150007000',
    SMS_PROVIDER: 'real', SMS_IR_API_KEY: 'test-transport-only',
    SMS_TEMPLATE_ID_DAILY: '101', SMS_TEMPLATE_ID_WEEKLY: '102',
    REPORT_TOKEN_TTL_HOURS: '48', DOCKER_LOGS_ENABLED: 'true', DOCKER_LOGS_TRUNCATE: 'true',
  }
  const config = new AppConfig(configSource)
  const links = new ReportLinks(config)
  const archiveStore = new ReportArchiveStore(uploads)
  const smsRequests: Array<{ templateId: number; parameters: Array<{ name: string; value: string }> }> = []
  let rejectSms = false
  const smsFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(url), 'https://api.sms.ir/v1/send/verify')
    const body = JSON.parse(String(init?.body)) as typeof smsRequests[number]
    const token = body.parameters.find((parameter) => parameter.name === 'TOKEN')?.value
    assert(token && token.length <= 25, 'provider receives the complete short token')
    assert(links.verifyReportDetails(token), 'SMS value validates without reconstruction')
    const saved = await archiveStore.read(token)
    assert(saved && saved.bytes.length > 22, 'a verified downloadable archive exists BEFORE SMS is sent')
    smsRequests.push(body)
    return Response.json(rejectSms ? { status: 0, message: 'simulated rejection' } : { status: 1, data: { messageId: 1 } })
  }) as typeof fetch
  const sms = new SmsService(config, smsFetch)
  const sourceLogs = join(uploads, 'source-log.txt')
  await writeFile(sourceLogs, 'خط آزمایشی داکر\nSynthetic log entry\n')
  let logMode: 'good' | 'failed' | 'unreadable' = 'good'
  let markerWrites = 0
  let truncateCalls = 0
  let logUntilOffset = 0
  const dockerLogs = {
    collectAndArchive: async (): Promise<DockerLogCollectResult> => ({
      collected: logMode !== 'failed', containers: logMode === 'failed' ? 0 : 1,
      skipped: logMode === 'failed' ? ['socket-unavailable'] : [],
      since: new Date(clock - 86400_000), until: new Date(clock + logUntilOffset),
      archivePath: logMode === 'failed' ? null : sourceLogs, bytes: 80,
    }),
    readArchive: (path: string) => logMode === 'unreadable' ? null : readFileSync(path, 'utf8'),
    archivePathFor: () => sourceLogs,
    completeCollection: () => { markerWrites++ },
    truncateAll: async () => { truncateCalls++; return { done: true, truncated: [], note: '' } },
  } as unknown as DockerLogsService
  const reconcile = { summary: async () => ({ open: 0, byCheck: {} }) } as never
  const makeService = (customConfig = config) => new ReportService({ db, config: customConfig, sms, links, reconcile, dockerLogs })
  let reports = makeService()
  const sessions = {
    authenticate: async (token: string) => {
      if (!['main', 'level2', 'customer'].includes(token)) throw Err.unauthorized()
      return { user: { id: crypto.randomUUID(), role: token === 'main' ? 'admin' : token === 'level2' ? 'admin2' : 'user' }, ctx: {} }
    },
  } as never
  const makeApp = () => new Elysia({ prefix: '/api' })
    .onError(({ error, set }) => {
      if (error instanceof AppError) { set.status = error.status; return error.toJSON() }
    })
    .use(reportRoutes({ sessions, reports, links })).compile()
  let app = makeApp()
  const request = (path: string, method = 'GET', session?: string) => within(app.handle(new Request(`http://localhost/api/reports${path}`, {
    method, headers: session ? { authorization: `Bearer ${session}` } : {},
  })), `${method} ${path.split('/')[1]}`)
  const [buyer] = await db.insert(users).values({
    phone: '09990007001', name: 'نام فارسی، "آزمایش"', createdAt: new Date('2026-10-23T08:00:00Z'),
  }).returning()
  assert(buyer)
  await db.insert(users).values({
    phone: '09990007002', name: '=1+1', createdAt: new Date('2026-10-23T08:00:00Z'),
  })
  const breakdown = { foodTotal: 1000, totalAmount: 1000, amountPaidOnline: 1000, walletDeduction: 0, discount: 0, deliveryFee: 0, packagingFee: 0 }
  await db.insert(orders).values([
    { userId: buyer.id, displayId: 'ord-daily-test', status: 'PAID', paymentStatus: 'SUCCESS', deliveryType: 'DINE_IN', totalAmount: 1000, breakdown, createdAt: new Date('2026-10-23T10:00:00Z') },
    { userId: buyer.id, displayId: 'ord-weekly-test', status: 'PAID', paymentStatus: 'SUCCESS', deliveryType: 'PICKUP', totalAmount: 1000, breakdown, createdAt: new Date('2026-10-18T10:00:00Z') },
    { userId: buyer.id, displayId: 'ord-outside-test', status: 'PAID', paymentStatus: 'SUCCESS', deliveryType: 'DINE_IN', totalAmount: 1000, breakdown, createdAt: new Date('2026-10-24T10:00:00Z') },
    { userId: buyer.id, displayId: 'ord-pre-week-start', status: 'PAID', paymentStatus: 'SUCCESS', deliveryType: 'DINE_IN', totalAmount: 1000, breakdown, createdAt: new Date('2026-10-16T20:29:59.999Z') },
    { userId: buyer.id, displayId: 'ord-at-week-start', status: 'PAID', paymentStatus: 'SUCCESS', deliveryType: 'DINE_IN', totalAmount: 1000, breakdown, createdAt: new Date('2026-10-16T20:30:00Z') },
    { userId: buyer.id, displayId: 'ord-before-week-end', status: 'PAID', paymentStatus: 'SUCCESS', deliveryType: 'DINE_IN', totalAmount: 1000, breakdown, createdAt: new Date('2026-10-23T20:29:59.999Z') },
    { userId: buyer.id, displayId: 'ord-at-week-end', status: 'PAID', paymentStatus: 'SUCCESS', deliveryType: 'DINE_IN', totalAmount: 1000, breakdown, createdAt: new Date('2026-10-23T20:30:00Z') },
  ])

  for (const [session, status] of [[undefined, 401], ['level2', 403], ['customer', 403]] as const) {
    const denied = await request('/send/daily', 'POST', session)
    assert.equal(denied.status, status)
  }
  assert.equal(smsRequests.length, 0, 'only main admin may trigger report SMS')
  const sent = await request('/send/daily', 'POST', 'main')
  assert.equal(sent.status, 200, await sent.clone().text())
  const daily = await sent.json() as { success: boolean; token: string; smsSent: number }
  assert.equal(daily.success, true)
  assert.equal(daily.smsSent, 1)
  assert.equal(smsRequests[0]!.parameters[0]!.value, daily.token)
  assert.equal(markerWrites, 1)
  assert.equal(truncateCalls, 0, 'report jobs must not truncate live Docker logs')
  const dailyResponse = await request(`/download/${daily.token}`)
  assert.equal(dailyResponse.status, 200)
  assert.equal(dailyResponse.headers.get('content-type'), 'application/zip')
  assert.match(dailyResponse.headers.get('content-disposition')!, /attachment; filename="sinshin-daily-report-2026-10-23.zip"/)
  assert.match(dailyResponse.headers.get('cache-control')!, /no-store/)
  const dailyBytes = new Uint8Array(await dailyResponse.arrayBuffer())
  assert.equal(Number(dailyResponse.headers.get('content-length')), dailyBytes.length)
  const dailyFiles = zipFiles(dailyBytes)
  assert.deepEqual([...dailyFiles.keys()].sort(), ['docker-logs.txt', 'new-users.csv', 'orders.csv', 'summary.txt'])
  assert.match(dailyFiles.get('orders.csv')!, /ord-daily-test/)
  assert(!dailyFiles.get('orders.csv')!.includes('ord-weekly-test'))
  assert(!dailyFiles.get('orders.csv')!.includes('ord-outside-test'))
  assert.match(dailyFiles.get('new-users.csv')!, /نام فارسی، ""آزمایش""/)
  assert.match(dailyFiles.get('new-users.csv')!, /"'=1\+1"/, 'user names cannot become spreadsheet formulas')
  assert.match(dailyFiles.get('docker-logs.txt')!, /خط آزمایشی داکر/)
  const datesTehran = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'full', timeZone: 'Asia/Tehran' })
  const dailyDate = datesTehran.format(new Date('2026-10-23T12:00:00Z'))
  const storedDaily = (await archiveStore.read(daily.token))!
  assert.equal(storedDaily.from, '2026-10-22T20:30:00.000Z')
  assert.equal(storedDaily.to, '2026-10-23T20:30:00.000Z')
  assert(dailyFiles.get('summary.txt')!.includes(`بازه: ${dailyDate} تا ${dailyDate}`), 'daily dates stay on Friday on a UTC server')
  const loopback = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: (incoming) => app.handle(incoming) })
  try {
    const downloadUrl = new URL(`/api/reports/download/${daily.token}`, loopback.url)
    assert.equal(downloadUrl.hostname, '127.0.0.1', 'the only real HTTP request stays on loopback')
    const response = await within(savedFetch(downloadUrl, { redirect: 'error' }), 'loopback HTTP ZIP response')
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'application/zip')
    assert.equal(response.headers.get('content-disposition'), dailyResponse.headers.get('content-disposition'))
    const downloadedBytes = new Uint8Array(await within(response.arrayBuffer(), 'loopback HTTP ZIP body'))
    assert.equal(Number(response.headers.get('content-length')), downloadedBytes.length)
    assert.deepEqual(downloadedBytes, dailyBytes, 'Bun HTTP adapter preserves the complete ZIP response bytes')
    await writeFile(join(downloads, 'daily.zip'), downloadedBytes)
    assert.deepEqual(new Uint8Array(await readFile(join(downloads, 'daily.zip'))), dailyBytes)
    assert.deepEqual(zipFiles(downloadedBytes), dailyFiles)
  } finally { await loopback.stop(true) }
  assert.equal(await (await request(`/csv/${daily.token}`)).text(), dailyFiles.get('orders.csv'))
  const view = await (await request(`/view/${daily.token}`)).text()
  assert(view.includes(`/api/reports/download/${daily.token}`))
  assert.equal((await reports.snapshotViewModel(daily.token))!.subtitle, `${dailyDate} — سین‌شین فودپارک`)
  const manifestPath = join(uploads, '.reports', 'bundles', createHash('sha256').update(daily.token).digest('hex'), 'manifest.json')
  const originalManifest = await readFile(manifestPath, 'utf8')
  const smsBeforeInvalidManifest = smsRequests.length
  try {
    await writeFile(manifestPath, JSON.stringify({ ...JSON.parse(originalManifest), kind: 'weekly' }))
    await assert.rejects(within(reports.runDailyFlow(), 'existing archive metadata validation'), /token metadata mismatch/)
    assert.equal(smsRequests.length, smsBeforeInvalidManifest, 'invalid reused archive cannot be sent again')
    assert.equal(markerWrites, 1)
  } finally { await writeFile(manifestPath, originalManifest) }
  for (const live of [await reports.dailyViewModel('today'), await reports.weeklyViewModel()]) {
    assert.equal(live.csvUrl, '', 'legacy live views cannot mint an unpublished download link')
    assert.equal(live.downloadUrl, undefined)
  }
  passed('main-admin SMS contains a complete token for a previously persisted ZIP; HTTP attachment saves and extracts Persian CSV/log content')

  const originalLogs = await readFile(sourceLogs, 'utf8')
  try {
    await writeFile(sourceLogs, 'Newer log lines absent from the original snapshot\n')
    logUntilOffset = 60_000
    const repeated = await within(reports.runDailyFlow(), 'same-second repeat publication')
    assert.equal(repeated.token, daily.token)
    assert.equal(markerWrites, 1, 'reusing a snapshot cannot advance the marker for unsaved newer logs')
    assert.deepEqual((await reports.downloadSnapshot(repeated.token))!.bytes, dailyBytes)
  } finally {
    logUntilOffset = 0
    await writeFile(sourceLogs, originalLogs)
  }
  let arrived = 0
  let releaseReaders!: () => void
  const readersReady = new Promise<void>((resolve) => { releaseReaders = resolve })
  class RacingStore extends ReportArchiveStore {
    private firstRead = true
    override async read(token: string) {
      const waitForOtherWriter = this.firstRead
      this.firstRead = false
      const found = await super.read(token)
      if (waitForOtherWriter) {
        if (++arrived === 2) releaseReaders()
        await readersReady
      }
      return found
    }
  }
  const savedDaily = (await archiveStore.read(daily.token))!
  const racingStores = [new RacingStore(join(uploads, 'race')), new RacingStore(join(uploads, 'race'))]
  const candidates = ['first captured logs', 'second captured logs'].map((logs) => ({
    ...savedDaily, bytes: buildZip([{ name: 'docker-logs.txt', data: logs }]),
  }))
  const publications = await within(Promise.all(racingStores.map((store, index) => store.publish(daily.token, candidates[index]!))), 'simultaneous archive publication')
  assert.equal(publications.filter((result) => result.created).length, 1, 'only the successful rename owns the saved log capture')
  const winner = publications.find((result) => result.created)!
  for (const result of publications) assert.deepEqual(result.archive.bytes, winner.archive.bytes)
  assert.equal((await racingStores[0]!.publish(daily.token, candidates[1]!)).created, false)
  passed('same-second repeats preserve the saved log marker; simultaneous archive publication identifies exactly one winning capture')

  const weekly = await within(reports.runWeeklyFlow(), 'weekly generation')
  const weeklyResponse = await request(`/download/${weekly.token}`)
  assert.equal(weeklyResponse.status, 200)
  const weeklyBytes = new Uint8Array(await weeklyResponse.arrayBuffer())
  const weeklyFiles = zipFiles(weeklyBytes)
  assert.deepEqual([...weeklyFiles.keys()].sort(), ['orders.csv', 'summary.txt', 'users.csv'])
  assert.match(weeklyFiles.get('orders.csv')!, /ord-daily-test/)
  assert.match(weeklyFiles.get('orders.csv')!, /ord-weekly-test/)
  assert(!weeklyFiles.get('orders.csv')!.includes('ord-outside-test'))
  assert(weeklyFiles.get('orders.csv')!.includes('ord-at-week-start'), 'Saturday Tehran midnight belongs to the new week')
  assert(weeklyFiles.get('orders.csv')!.includes('ord-before-week-end'), 'last millisecond of Friday belongs to the previous week')
  assert(!weeklyFiles.get('orders.csv')!.includes('ord-pre-week-start'))
  assert(!weeklyFiles.get('orders.csv')!.includes('ord-at-week-end'), 'the next Saturday midnight is excluded')
  const weeklyStartDate = datesTehran.format(new Date('2026-10-17T12:00:00Z'))
  const storedWeekly = (await archiveStore.read(weekly.token))!
  assert.equal(storedWeekly.from, '2026-10-16T20:30:00.000Z', 'weekly begins at Tehran midnight')
  assert.equal(storedWeekly.to, '2026-10-23T20:30:00.000Z', 'weekly ends at Tehran midnight')
  assert(weeklyFiles.get('summary.txt')!.includes(`بازه: ${weeklyStartDate} تا ${dailyDate}`), 'weekly display ends on Friday, excluding the next Saturday')
  assert.equal((await reports.snapshotViewModel(weekly.token))!.subtitle, `${weeklyStartDate} تا ${dailyDate} — سین‌شین فودپارک`)
  await writeFile(join(downloads, 'weekly.zip'), weeklyBytes)
  clock += 86400_000
  await db.execute(sql`update orders set total_amount = 999999 where display_id = 'ord-daily-test'`)
  reports = makeService()
  app = makeApp()
  assert.deepEqual(new Uint8Array(await (await request(`/download/${daily.token}?range=today`)).arrayBuffer()), dailyBytes)
  assert.deepEqual(new Uint8Array(await (await request(`/download/${weekly.token}`)).arrayBuffer()), weeklyBytes)
  assert.equal(await (await request(`/csv/${daily.token}?range=today`)).text(), dailyFiles.get('orders.csv'))
  passed('weekly periods are Saturday–Friday; restart, day rollover, query parameters and DB edits cannot change saved downloads')

  assert.equal((await request('/download/not-a-token')).status, 403)
  assert.equal((await request(`/download/${daily.token.slice(0, -1)}`)).status, 403)
  assert.equal((await request(`/download/${links.reportToken('daily')}`)).status, 404, 'valid but unpublished token cannot synthesize another report')
  const archiveDir = join(uploads, '.reports', 'bundles', createHash('sha256').update(daily.token).digest('hex'))
  await writeFile(join(archiveDir, 'report.zip'), 'truncated')
  const corrupt = await request(`/download/${daily.token}`)
  assert.equal(corrupt.status, 503, 'corrupt ZIP must not return an empty successful download')
  assert.match(await corrupt.text(), /فایل گزارش/)
  clock += 86400_000 + 1000
  assert.equal((await request(`/download/${weekly.token}`)).status, 403)
  passed('invalid, truncated, unpublished, corrupted and expired links fail with meaningful HTTP responses')

  clock += 1000
  const markerBeforeFailure = markerWrites
  rejectSms = true
  await assert.rejects(within(reports.runDailyFlow(), 'SMS rejection'), (error: unknown) => error instanceof AppError && error.status === 503)
  assert.equal(markerWrites, markerBeforeFailure)
  rejectSms = false
  const smsBeforeStorageFailure = smsRequests.length
  const blockedUploads = join(artifacts, 'blocked-upload-path')
  await writeFile(blockedUploads, 'This is deliberately a file, not a writable directory.')
  clock += 1000
  await assert.rejects(within(makeService(new AppConfig({ ...configSource, UPLOAD_DIR: blockedUploads })).runDailyFlow(), 'storage rejection'))
  assert.equal(smsRequests.length, smsBeforeStorageFailure)
  assert.equal(markerWrites, markerBeforeFailure)
  clock += 1000
  logMode = 'failed'
  const withoutLogs = await within(reports.runDailyFlow(), 'failed log capture')
  const noLogFiles = zipFiles((await reports.downloadSnapshot(withoutLogs.token))!.bytes)
  assert.match(noLogFiles.get('docker-logs.txt')!, /ذخیره نشده/)
  assert(noLogFiles.get('orders.csv')!.startsWith('\uFEFFشناسه'))
  assert.equal(markerWrites, markerBeforeFailure)
  clock += 1000
  logMode = 'unreadable'
  await within(reports.runDailyFlow(), 'unreadable captured log')
  assert.equal(markerWrites, markerBeforeFailure)
  assert.equal(truncateCalls, 0)
  passed('storage/SMS failures cannot claim delivery or advance log markers; log failures yield explicit notes and preserve source logs')

  clock = Date.parse('2026-10-30T21:35:00Z') // Next Saturday; bulk fixtures belong to this report week.
  logMode = 'good'
  await db.execute(sql`
    insert into users (phone, name, created_at)
    select '091' || lpad(g::text, 8, '0'), 'کاربر آزمایشی ' || g::text, '2026-10-29T10:00:00Z'::timestamptz
    from generate_series(1, 10001) g
  `)
  await db.execute(sql`
    insert into orders (display_id, user_id, status, payment_status, delivery_type, total_amount, breakdown, created_at)
    select 'ord-bulk-' || right(phone, 8), id, 'PAID', 'SUCCESS', 'DINE_IN', 1000,
      '{"foodTotal":1000,"totalAmount":1000,"amountPaidOnline":1000,"walletDeduction":0,"discount":0,"deliveryFee":0,"packagingFee":0}'::jsonb,
      '2026-10-29T12:00:00Z'::timestamptz
    from users where phone like '091%'
  `)
  const bulk = await within(reports.runWeeklyFlow(), 'over-10000-row archive')
  const bulkBytes = (await reports.downloadSnapshot(bulk.token))!.bytes
  const bulkFiles = zipFiles(bulkBytes)
  assert.equal((bulkFiles.get('orders.csv')!.match(/ord-bulk-/g) ?? []).length, 10001)
  assert.equal((bulkFiles.get('users.csv')!.match(/کاربر آزمایشی/g) ?? []).length, 10001)
  await writeFile(join(downloads, 'weekly-10001.zip'), bulkBytes)
  passed('downloadable weekly exports include all 10,001 orders and users instead of silently truncating at 10,000')

  clock = Date.parse('2026-11-06T21:35:00Z') // A fresh week containing only the concurrent-update fixture.
  await db.insert(orders).values({
    userId: buyer.id, displayId: 'ord-refund-race', status: 'PAID', paymentStatus: 'SUCCESS',
    deliveryType: 'DINE_IN', totalAmount: 1000, breakdown, createdAt: new Date('2026-11-04T10:00:00Z'),
  })
  // Commit a refund through another connection after export rows have been read,
  // before the report view fetches its aggregate. The saved forms must agree.
  const reads = reports as unknown as {
    orderAndWalletRows(from: Date, to: Date, readDb?: DbOrTx): Promise<unknown>
  }
  const readRows = reads.orderAndWalletRows.bind(reports)
  let concurrentRefund: Promise<unknown> | undefined
  reads.orderAndWalletRows = async (...args) => {
    const rows = await readRows(...args)
    concurrentRefund ??= db.execute(sql`
      update orders set status = 'CANCELED', payment_status = 'REFUNDED'
      where display_id = 'ord-refund-race'
    `).then(result => result)
    await concurrentRefund
    return rows
  }
  try {
    const consistent = await within(reports.runWeeklyFlow(), 'concurrent refund during report generation')
    const snapshot = (await archiveStore.read(consistent.token))!
    const files = zipFiles(snapshot.bytes)
    assert.match(files.get('orders.csv')!, /"ord-refund-race","سرو در سالن","در انتظار تایید"/)
    assert.equal(snapshot.viewModel.orders.rows.length, 1)
    assert.equal(snapshot.viewModel.orders.rows[0]![2], 'در انتظار تایید')
    assert.equal(snapshot.viewModel.stats[0]!.value, (1).toLocaleString('fa-IR'))
    assert.equal(snapshot.viewModel.stats[1]!.value, (1000).toLocaleString('fa-IR'))
    assert(files.get('summary.txt')!.includes(`تعداد سفارش پرداخت‌شده: ${(1).toLocaleString('fa-IR')}`))
    const state = await db.execute(sql`select status from orders where display_id = 'ord-refund-race'`)
    assert.equal(state[0]!.status, 'CANCELED', 'the concurrent refund committed without blocking the report')
  } finally {
    reads.orderAndWalletRows = readRows
  }
  passed('concurrent refunds cannot persist inconsistent CSV, summary and report-view totals')

  clock += 1000
  await db.execute(sql`
    insert into reconcile_findings (check_id, severity, entity_type, entity_id)
    values ('R1', 'warning', 'order', 'ord-refund-race')
  `)
  const singleConnection = new Database(scratchUrl.toString(), { max: 1 })
  try {
    const singleReports = new ReportService({
      db: singleConnection.db, config, sms, links, dockerLogs,
      reconcile: new ReconcileService({ db: singleConnection.db, config, orders: undefined as never }),
    })
    const singleReport = await within(singleReports.runWeeklyFlow(), 'report and reconciliation with one database connection')
    const saved = await archiveStore.read(singleReport.token)
    assert(saved, 'the report completes without waiting for a second pool connection')
    assert.deepEqual(saved.viewModel.reconcile?.rows, [['R1', '1']], 'real reconciliation results belong to the saved snapshot')
  } finally {
    await singleConnection.close()
  }
  passed('report reconciliation shares the snapshot transaction and completes with a single database connection')
  console.log(`Report download safety: ${groups} groups passed`)
  console.log(`Synthetic saved ZIP artifacts: ${downloads}`)
} finally {
  Date.now = savedNow
  globalThis.fetch = savedFetch
  if (savedTimezone === undefined) delete process.env.TZ
  else process.env.TZ = savedTimezone
  await database?.close()
  if (created) await admin.unsafe(`drop database if exists "${scratch}" with (force)`)
  await admin.close({ timeout: 5 })
  const absoluteUploads = resolve(uploads)
  assert(absoluteUploads.startsWith(resolve(artifacts) + sep), 'only remove this test upload directory')
  await rm(absoluteUploads, { recursive: true, force: true })
}
