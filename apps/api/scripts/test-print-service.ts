/** stage-88 + stage-89 — تست یکپارچه‌ی «پل چاپِ سرور» روی PostgreSQL واقعی + چاپگرِ فیکِ TCP.
 *
 * پوشش استیج-۸۸ (اصلی):
 *  ۱) کدگذار ESC/POS بایت‌به‌بایت: GS v 0 (xL/xH بایت، yL/yH dot)،
 *     قطعه‌بندیِ ≤۹۶۰dot + LF بینِ قطعه‌ها، دنبالهٔ برش GS V 42 0،
 *     تفسیرِ DLE EOT 1/4
 *  ۲) PrinterService روی DB موقتی: CRUD + یکتاییِ (host,port) + تخصیصِ
 *     فاکتورها (خطای id مجهول) + پاک‌شدنِ تخصیص با حذف
 *  ۳) چاپِ واقعی روی سوکت: چاپگرِ فیکِ ESC/POS در همین پروسه — dispatch:
 *     ESC @ → GS v 0 → برش؛ کاغذِ تمام = خطا قبل از ارسالِ رستری
 *  ۴) تشخیص: اسکنِ CIDR روی 127.0.0.1 — پورتِ باز پیدا می‌شود
 *
 * پوشش استیج-۸۹ (بازبینیِ کارفرما — P1..P5):
 *  P1) networkReport: حالتِ استقرار + راهنمایِ فارسی + hint در خطایِ چاپ به
 *      مقصدِ دور (IP خصوصیِ بیرونِ زیرشبکه‌های سرور)
 *  P2) سیاستِ مقصد: IP عمومی/link-local(metadata)/CGNAT رد؛ hostname فقط با
 *      IP نهاییِ مجاز؛ پورت فقط 9100؛ اسکنِ loopback در «حالتِ تولید» بسته
 *  P3) ریاضیاتِ CIDR: 192.168.1.128/25 = نیمهٔ بالایی (129..254)؛ اکتتِ چهارم
 *      هم اعتبارسنجی؛ زیرشبکه‌های پیش‌فرض از ماسکِ واقعیِ کارت‌ها
 *  P4) اسکن فقط پورتِ 9100 — listener فیک روی 631 «پیدا نمی‌شود»
 *  P5) وضعیت = TCP «و» بیتِ دستگاه: چاپگرِ خود-آفلاین در لیست آفلاین دیده
 *      می‌شود و چاپ/تست رد می‌شود (سوکت باز است ولی دستگاه گفته آفلاین)
 *
 * فقط دیتابیس/سوکتِ local — بدون درگاه/نوتیف/درخواستِ خارجی.
 *   DATABASE_URL=postgres://... bun scripts/test-print-service.ts
 *   (یا: bun run db:test:print)
 */
import assert from 'node:assert/strict'
import net from 'node:net'
import { SQL } from 'bun'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { Database } from '../src/infra/db/client'
import { AppConfig } from '../src/infra/config/env'
import { SettingsService } from '../src/domain/settings/settings.service'
import { PrinterService } from '../src/domain/print/print.service'
import {
  buildRasterJob,
  buildTestJob,
  cmdRaster,
  parseStatusPaper,
  parseStatusPrinter,
  RASTER_FRAGMENT_DOTS,
} from '../src/domain/print/escpos'
import {
  cidrHosts,
  cidrParse,
  classifyIpv4,
  ipInCidr,
  parseIpv4,
  prefixFromNetmask,
  scanCidrAllowed,
  serverSubnets,
} from '../src/domain/print/printNet'

const source = new URL(process.env.DATABASE_URL?.startsWith('postgres')
  ? process.env.DATABASE_URL : 'postgres://sinshin:sinshin_local@127.0.0.1:5432/sinshin')
assert(['localhost', '127.0.0.1', '[::1]'].includes(source.hostname), 'Tests require local PostgreSQL')
const scratch = `sinshin_e2e_print_${process.pid}_${crypto.randomUUID().slice(0, 8).replaceAll('-', '')}`
const adminUrl = new URL(source)
adminUrl.pathname = '/postgres'
const admin = new SQL(adminUrl.toString(), { max: 1 })
const scratchUrl = new URL(source)
scratchUrl.pathname = `/${scratch}`

// ── چاپگرِ فیکِ ESC/POS — سوکتِ واقعی، بایت‌های واقعی ──
interface FakePrinter {
  port: number
  received: () => Buffer
  paperEnd: (on: boolean) => void
  /** stage-89 (P5) — دستگاه بیتِ آفلاین را خودش اعلام می‌کند */
  offline: (on: boolean) => void
  close: () => Promise<void>
}
async function startFakePrinter(preferredPort: number): Promise<FakePrinter> {
  const chunks: Buffer[] = []
  let paperEnd = false
  let offline = false
  const server = net.createServer((socket) => {
    socket.on('data', (d: Buffer) => {
      chunks.push(d)
      // پروتکلِ DLE EOT — همان‌طور که چاپگرِ واقعی: هر درخواست یک بایت پاسخ
      for (let i = 0; i + 2 < d.length; i++) {
        if (d[i] === 0x10 && d[i + 1] === 0x04 && d[i + 2] === 0x01) {
          // 0x12 = آنلاینِ سالم · 0x1a = خود-گزارشِ آفلاین (بیت 3)
          socket.write(Buffer.from([offline ? 0x1a : 0x12]))
        }
        if (d[i] === 0x10 && d[i + 1] === 0x04 && d[i + 2] === 0x04) {
          // bits 5,6 (0x60) = کاغذِ تمام · در حالتِ نرمال فقط بیت‌های ثابت
          socket.write(Buffer.from([paperEnd ? 0x72 : 0x12]))
        }
      }
    })
  })
  // پورتِ ترجیحی (9100 برای تستِ discover)؛ اگر گرفته بود، اِفِمِرال
  await new Promise<void>((resolve) => {
    server.once('error', () => resolve()) // listen بعداً با port 0 تلاش می‌شود
    server.listen(preferredPort, '127.0.0.1', () => resolve())
  })
  const gotPreferred = (server.address() as net.AddressInfo | null)?.port === preferredPort
  if (!gotPreferred) {
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve())
    })
  }
  const port = (server.address() as net.AddressInfo).port
  return {
    port,
    received: () => Buffer.concat(chunks),
    paperEnd: (on: boolean) => { paperEnd = on },
    offline: (on: boolean) => { offline = on },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

/** listener فیکِ «پورتِ 631» — پروتکلِ IPP؛ فقط برای اثباتِ «پیدا نمی‌شود» (P4) */
async function startIppDecoy(): Promise<{ port: number; close: () => Promise<void> } | null> {
  const server = net.createServer((socket) => {
    socket.on('data', () => {
      // IPP جواب نمی‌دهد — فقط پورت باز
    })
  })
  const ok = await new Promise<boolean>((resolve) => {
    server.once('error', () => resolve(false))
    server.listen(631, '127.0.0.1', () => resolve(true))
  })
  if (!ok) return null
  const port = (server.address() as net.AddressInfo).port
  return {
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

// ── بیت‌مپِ 1bpp ساختگی: نوارهای افقی مشکی/سفید ──
function fakeBitmap(widthDots: number, heightDots: number): Buffer {
  const bytesPerRow = Math.ceil(widthDots / 8)
  const out = Buffer.alloc(bytesPerRow * heightDots)
  for (let y = 0; y < heightDots; y++) {
    if (y % 8 < 4) out.fill(0xff, y * bytesPerRow, (y + 1) * bytesPerRow)
  }
  return out
}

let database: Database | undefined
let fake: FakePrinter | undefined
let decoy: { port: number; close: () => Promise<void> } | null = null
let count = 0
function passed(name: string) {
  count++
  console.log(`PASS ${name}`)
}

function isValidation(e: unknown): boolean {
  const status = (e as { status?: number } | null)?.status
  return status === 422 || status === 404
}

try {
  // ══ ۱) ریاضیات و سیاستِ شبکه (stage-89 — P3/P2؛ خالص، بدون DB) ══
  {
    // P3 — نیمهٔ بالایی: 192.168.1.128/25 باید 129..254 باشد نه 1..126
    const upper = cidrHosts('192.168.1.128/25', 512)
    assert.strictEqual(upper.length, 126, `count=${upper.length}`)
    assert.strictEqual(upper[0], '192.168.1.129')
    assert.strictEqual(upper[upper.length - 1], '192.168.1.254')
    passed('P3: 192.168.1.128/25 → نیمهٔ بالایی (129..254) — اکتتِ چهارم دیگر نادیده نیست')

    const full = cidrHosts('192.168.1.0/24', 512)
    assert.strictEqual(full.length, 254)
    assert.strictEqual(full[0], '192.168.1.1')
    assert.strictEqual(full[full.length - 1], '192.168.1.254')
    passed('P3: 192.168.1.0/24 → ۲۵۴ میزبانِ قابل‌اسکن (1..254)')

    const info = cidrParse('10.1.2.3/8')
    assert.ok(info)
    assert.strictEqual(info.network, parseIpv4('10.0.0.0'))
    assert.strictEqual(info.broadcast, parseIpv4('10.255.255.255'))
    assert.ok(ipInCidr(parseIpv4('10.200.1.1') as number, info as NonNullable<typeof info>))
    passed('P3: cidrParse با ماسکِ کاملِ ۳۲ بیتی (network/broadcast)')

    assert.deepStrictEqual(cidrHosts('192.168.1.999/24', 512), [])
    assert.deepStrictEqual(cidrHosts('300.1.1.0/24', 512), [])
    assert.deepStrictEqual(cidrHosts('192.168.1.0/33', 512), [])
    passed('P3: اکتت‌های نامعتبر و پیشوندِ بی‌ربط رد می‌شوند (هر ۴ اکتت)')

    assert.strictEqual(prefixFromNetmask('255.255.255.0'), 24)
    assert.strictEqual(prefixFromNetmask('255.255.255.128'), 25)
    assert.strictEqual(prefixFromNetmask('255.255.0.0'), 16)
    assert.strictEqual(prefixFromNetmask('255.0.0.0'), 8)
    passed('P3: پیشوند از ماسکِ نقطه‌دارِ واقعی')

    for (const s of serverSubnets()) {
      const si = cidrParse(s.cidr)
      assert.ok(si, `cidr نامعتبر: ${s.cidr}`)
      const ipNum = parseIpv4(s.ip)
      assert.ok(ipNum !== null && ipInCidr(ipNum, si as NonNullable<typeof si>), `${s.ip} در ${s.cidr} نیست`)
      assert.strictEqual(si?.network, parseIpv4(s.cidr.split('/')[0] as string), `${s.cidr} شبکه‌تراز نیست`)
    }
    passed(`P3: ${serverSubnets().length} زیرشبکهٔ پیش‌فرض از «ماسکِ واقعیِ» کارت‌ها — شبکه‌تراز (نه فرضِ /24)`)

    assert.strictEqual(classifyIpv4(parseIpv4('127.0.0.1') as number), 'loopback')
    assert.strictEqual(classifyIpv4(parseIpv4('169.254.169.254') as number), 'linklocal')
    assert.strictEqual(classifyIpv4(parseIpv4('10.0.0.5') as number), 'privatelan')
    assert.strictEqual(classifyIpv4(parseIpv4('172.16.0.1') as number), 'privatelan')
    assert.strictEqual(classifyIpv4(parseIpv4('172.31.255.255') as number), 'privatelan')
    assert.strictEqual(classifyIpv4(parseIpv4('192.168.1.1') as number), 'privatelan')
    assert.strictEqual(classifyIpv4(parseIpv4('100.64.0.1') as number), 'cgnat')
    assert.strictEqual(classifyIpv4(parseIpv4('8.8.8.8') as number), 'public')
    assert.strictEqual(scanCidrAllowed('169.254.0.0/16', {}), null)
    assert.strictEqual(scanCidrAllowed('8.8.8.0/24', {}), null)
    assert.strictEqual(scanCidrAllowed('100.64.0.0/16', {}), null)
    assert.ok(scanCidrAllowed('10.0.0.0/24', {}))
    assert.strictEqual(scanCidrAllowed('127.0.0.0/29', {}), null)
    assert.ok(scanCidrAllowed('127.0.0.0/29', { allowLoopback: true }))
    passed('P2: دستهٔ IPها + سیاستِ اسکن (metadata/عمومی/CGNAT مسدود · RFC1918 مجاز)')
  }

  // ══ ۲) کدگذار ESC/POS — بایت‌به‌بایت (بدون DB) ══
  {
    const img = cmdRaster(576, 8, fakeBitmap(576, 8))
    assert.deepStrictEqual([...img.slice(0, 8)], [0x1d, 0x76, 0x30, 0x00, 72, 0, 8, 0])
    passed('GS v 0: xL/xH=بایتِ ردیف (72,0) · yL/yH=dot (8,0) — LE')
    assert.strictEqual(img.length, 8 + 72 * 8)
    passed('GS v 0: طولِ داده = bytesPerRow×height')

    const big = buildRasterJob(576, 2 * RASTER_FRAGMENT_DOTS + 120, fakeBitmap(576, 2 * RASTER_FRAGMENT_DOTS + 120), { autoCut: true })
    let frags = 0
    for (let i = 0; i + 8 <= big.length; i++) {
      if (big[i] === 0x1d && big[i + 1] === 0x76) {
        frags++
        const yh = big[i + 7] as number
        const yl = big[i + 6] as number
        const h = yl + yh * 256
        assert.ok(h <= RASTER_FRAGMENT_DOTS, `قطعهٔ ${h}dot از سقف 960 بزرگ‌تر است`)
        i += 8 + 72 * h - 1 // پرش از دادهٔ همین قطعه
      }
    }
    assert.strictEqual(frags, 3, `قطعه‌بندی 960/960/120 → ${frags}`)
    passed('قطعه‌بندیِ تصویر: ۳ قطعه (960/960/120) + سقف رعایت شد')

    const tail = big.subarray(big.length - 10)
    assert.deepStrictEqual(
      [...tail],
      [0x0a, 0x1b, 0x64, 0x02, 0x1d, 0x56, 0x42, 0x00, 0x1b, 0x40],
      `دنبالهٔ ${[...tail]}`,
    )
    passed('پایانِ کار: LF + ESC d 2 (فید) + GS V 66 0 (برشِ جزئی) + ESC @')

    assert.strictEqual(big[0], 0x1b)
    assert.strictEqual(big[1], 0x40)
    passed('شروعِ کار: ESC @')

    const noCut = buildRasterJob(576, 16, fakeBitmap(576, 16), { autoCut: false })
    let cutFound = false
    for (let i = 0; i + 3 <= noCut.length; i++) {
      if (noCut[i] === 0x1d && noCut[i + 1] === 0x56) cutFound = true
    }
    assert.ok(!cutFound)
    passed('autoCut=false → بدونِ GS V (چاپگرِ بدونِ برش)')

    assert.strictEqual(parseStatusPrinter(0x12).offline, false)
    assert.strictEqual(parseStatusPrinter(0x1a).offline, true)
    assert.strictEqual(parseStatusPaper(0x72).paperEnd, true)
    assert.strictEqual(parseStatusPaper(0x12).paperEnd, false)
    assert.strictEqual(parseStatusPaper(0x1e).paperNearEnd, true)
    passed('DLE EOT 1/4: آفلاین · کاغذِ تمام · رو‌به‌اتمام')

    const test = buildTestJob({ name: 'Kitchen', host: '127.0.0.1', widthDots: 576, autoCut: true })
    assert.strictEqual(test[0], 0x1b)
    assert.strictEqual(test[1], 0x40)
    const ascii = Buffer.from(test).toString('latin1')
    assert.ok(ascii.includes('SINSHIN PRINT TEST'))
    assert.ok(ascii.includes('Kitchen'))
    passed('صفحهٔ تستِ اسکی: ESC @ + متنِ PC437')
  }

  // ══ ۳) سرویس روی DB موقتی + چاپگرِ فیک ══
  await admin.unsafe(`create database "${scratch}"`)
  database = new Database(scratchUrl.toString(), { max: 8 })
  const db = database.db
  await migrate(db, { migrationsFolder: import.meta.dir + '/../drizzle' })
  const config = new AppConfig({
    NODE_ENV: 'development', DATABASE_URL: scratchUrl.toString(), GATEWAY_MODE: 'direct',
    JWT_SECRET: 'print-test-'.repeat(3), SITE_URL: 'https://sinshin.example',
  })
  const settings = new SettingsService({ db, config })
  // پرچم‌های dev/test — چاپگرِ فیک روی loopback است (در «حالتِ تولید» بسته)
  process.env.PRINT_ALLOW_LOOPBACK = '1'
  const print = new PrinterService({ db, settings })

  fake = await startFakePrinter(9100)
  const fp: FakePrinter = fake
  // پورتِ فیک اگر اِفِمِرال شد (9100 گرفته بود) — فقط dev/test پورتِ آزاد می‌پذیرد
  if (fp.port !== 9100) process.env.PRINT_ALLOW_ANY_PORT = '1'
  console.log(`— چاپگرِ فیک روی 127.0.0.1:${fp.port}`)

  // P1 — گزارشِ توپولوژی وقتی چاپگری نیست
  {
    const report = await print.networkReport()
    assert.strictEqual(report.deploymentMode, 'empty')
    assert.ok(report.guidance.length > 0)
    assert.strictEqual(report.printers.length, 0)
    passed('P1: گزارشِ شبکه — حالتِ empty + راهنما، قبل از ثبتِ چاپگر')
  }

  // ثبت
  const added = await print.add({ name: 'چاپگر آشپزخانه', host: '127.0.0.1', port: fp.port, widthDots: 576 })
  assert.ok(added.id.length > 10)
  assert.strictEqual(added.status, 'unknown')
  passed('افزودن چاپگر (پیش‌فرض ۹۱۰۰/۸۰mm)')

  await assert.rejects(
    () => print.add({ name: 'کپی', host: '127.0.0.1', port: fp.port }),
    (e: unknown) => isValidation(e) || (e as { status?: number }).status === 409,
  )
  passed('تکراریِ (host,port) رد می‌شود')

  await assert.rejects(
    () => print.add({ name: 'بد', host: 'http://evil/x', port: 9100 }),
    isValidation,
  )
  passed('host نامعتبر (URL/رشتهٔ آزاد) رد می‌شود')

  // P2 — سیاستِ مقصد در ثبت
  await assert.rejects(
    () => print.add({ name: 'عمومی', host: '8.8.8.8', port: 9100 }),
    (e: unknown) => isValidation(e) && (e as Error).message.includes('عمومی'),
  )
  passed('P2: آدرسِ عمومی (8.8.8.8) برای چاپگر رد می‌شود')

  await assert.rejects(
    () => print.add({ name: 'متادیتا', host: '169.254.169.254', port: 9100 }),
    (e: unknown) => isValidation(e) && (e as Error).message.includes('169.254'),
  )
  passed('P2: link-local/metadata (169.254.169.254) مسدود')

  await assert.rejects(
    () => print.add({ name: 'سی‌جی‌نت', host: '100.64.10.7', port: 9100 }),
    isValidation,
  )
  passed('P2: بازهٔ CGNAT مسدود')

  await assert.rejects(
    () => print.add({ name: 'پورت اشتباه', host: '192.168.1.87', port: 631 }),
    (e: unknown) => isValidation(e) && (e as Error).message.includes('9100'),
  )
  passed('P2: پورتِ غیر 9100 (631 = IPP) رد — تنها انتقالِ پیاده‌شده RAW است')

  await assert.rejects(
    () => print.add({ name: 'بی‌نام', host: 'nonexistent-printer.invalid', port: 9100 }),
    (e: unknown) => isValidation(e) && (e as Error).message.includes('حل نمی‌شود'),
  )
  passed('P2: hostnameِ حل‌نشدنی رد — IP نهاییِ مجاز باید اثبات شود')

  // لیست + probe — چاپگرِ فیک باید آنلاین باشد
  const listed = await print.list()
  assert.strictEqual(listed.length, 1)
  assert.strictEqual(listed[0]?.status, 'online')
  assert.strictEqual(listed[0]?.statusDetail, null)
  passed('لیست + probe زنده: آنلاین + بدونِ مشکلِ کاغذ')

  // تخصیص
  const a1 = await print.assignment()
  assert.strictEqual(a1.sales, null)
  assert.strictEqual(a1.kitchen, null)
  await print.setAssignment({ sales: added.id, kitchen: added.id })
  const a2 = await print.assignment()
  assert.strictEqual(a2.sales, added.id)
  assert.strictEqual(a2.kitchen, added.id)
  passed('تخصیصِ هر نوع فاکتور → چاپگر (ذخیره در settings)')

  await assert.rejects(
    () => print.setAssignment({ sales: '00000000-0000-0000-0000-000000000001', kitchen: null }),
    isValidation,
  )
  passed('تخصیص به چاپگرِ ناموجود رد می‌شود')

  // چاپِ واقعی — سیم = probe (DLE EOT) + بایت‌های کار
  const bmp = fakeBitmap(576, 256)
  const res = await print.dispatch({
    printerId: added.id,
    widthPx: 576,
    heightPx: 256,
    rows: bmp.toString('base64'),
  })
  assert.ok(res.bytes > 8 + 72 * 256)
  const wireAll = fake.received()
  // probe اول: DLE EOT 1 + 4
  assert.ok(
    wireAll.subarray(0, 6).equals(Buffer.from([0x10, 0x04, 0x01, 0x10, 0x04, 0x04])),
    'probe پیش از کار در سیم نیست',
  )
  const jobStart = wireAll.indexOf(Buffer.from([0x1b, 0x40, 0x1d, 0x76]))
  assert.ok(jobStart >= 0, 'شروعِ کار (ESC @ + GS v 0) پیدا نشد')
  const job = wireAll.subarray(jobStart)
  // 256 dot → yL/yH little-endian = 00 01
  assert.ok(
    job.includes(Buffer.from([0x1d, 0x76, 0x30, 0x00, 72, 0, 0x00, 0x01])),
    'هدرِ GS v 0 در کار نیست',
  )
  assert.ok(
    job.subarray(job.length - 6).equals(Buffer.from([0x1d, 0x56, 0x42, 0x00, 0x1b, 0x40])),
    'پایانِ کار: برش + init نیست',
  )
  passed(`چاپ روی سوکت: ${res.bytes} بایت — ESC @ + GS v 0(576×256) + برش`)

  // عرضِ ناهمخوان
  await assert.rejects(
    () => print.dispatch({ printerId: added.id, widthPx: 384, heightPx: 16, rows: fakeBitmap(384, 16).toString('base64') }),
    isValidation,
  )
  passed('عرضِ رسید ≠ کاغذِ چاپگر → خطای صریح')

  // دادهٔ ناقص
  await assert.rejects(
    () => print.dispatch({ printerId: added.id, widthPx: 576, heightPx: 64, rows: Buffer.alloc(10).toString('base64') }),
    isValidation,
  )
  passed('دادهٔ تصویرِ ناقص رد می‌شود')

  // کاغذِ تمام — خطا قبل از ارسالِ رستری؛ بایتِ تازه‌ی سیم فقط DLE EOT است
  const wireBefore = fake.received().length
  fake.paperEnd(true)
  await assert.rejects(
    () => print.dispatch({ printerId: added.id, widthPx: 576, heightPx: 16, rows: fakeBitmap(576, 16).toString('base64') }),
    (e: unknown) => e instanceof Error && e.message.includes('کاغذ'),
  )
  const wireAfterPaperEnd = fake.received().subarray(wireBefore)
  assert.ok(!wireAfterPaperEnd.includes(Buffer.from([0x1d, 0x76, 0x30])), 'رستر نباید فرستاده شود')
  fake.paperEnd(false)
  passed('کاغذِ تمام: خطای صریحِ فارسی قبل از ارسال — رستر نفرستاده شد')

  // صفحهٔ تستِ اسکی — همان سوکت؛ متنِ PC437 + init پایانی
  const t = await print.test(added.id)
  assert.ok(t.bytes > 60)
  const twire = fake.received()
  assert.ok(twire.toString('latin1').includes('SINSHIN PRINT TEST'))
  assert.ok(twire.subarray(twire.length - 2).equals(Buffer.from([0x1b, 0x40])))
  passed('صفحهٔ تستِ اسکی از همان مسیرِ سوکت')

  // P5 — دستگاهِ خود-آفلاین: سوکت باز است ولی دستگاه گفته آفلاین
  {
    fake.offline(true)
    const wireBeforeOffline = fake.received().length
    await assert.rejects(
      () => print.dispatch({ printerId: added.id, widthPx: 576, heightPx: 16, rows: fakeBitmap(576, 16).toString('base64') }),
      (e: unknown) => e instanceof Error && e.message.includes('آفلاین'),
    )
    await assert.rejects(
      () => print.test(added.id),
      (e: unknown) => e instanceof Error && e.message.includes('آفلاین'),
    )
    const wireAfterOffline = fake.received().subarray(wireBeforeOffline)
    assert.ok(!wireAfterOffline.includes(Buffer.from([0x1d, 0x76, 0x30])), 'رسید/تستِ خود-آفلاین نباید فرستاده شود')
    // کشِ probe را با update خالی می‌کنیم (همان رفتارِ خودِ سرویس) → لیست باید
    // وضعیتِ «ترکیبی» را ببیند: TCP وصل ولی دستگاه آفلاین گفته ⇒ آفلاین
    await print.update(added.id, { name: 'چاپگر آشپزخانه (تست وضعیت)' })
    const listedOffline = await print.list()
    assert.strictEqual(listedOffline[0]?.status, 'offline', 'سوکت باز + خود-گزارشِ آفلاین ⇒ نباید سبز باشد')
    assert.ok(listedOffline[0]?.statusDetail?.includes('آفلاین'))
    fake.offline(false)
    await print.update(added.id, { name: 'چاپگر آشپزخانه' })
    const listedBack = await print.list()
    assert.strictEqual(listedBack[0]?.status, 'online')
    passed('P5: دستگاهِ خود-آفلاین = آفلاینِ سبزنما ممنوع — چاپ/تست رد + لیست آفلاین + برگشت')
  }

  // ویرایش
  const upd = await print.update(added.id, { name: 'چاپگر فروش' })
  assert.strictEqual(upd.name, 'چاپگر فروش')
  await assert.rejects(
    () => print.update(added.id, { host: '203.0.113.5' }),
    isValidation,
  )
  passed('ویرایش چاپگر (+ P2: میزبانِ عمومی در ویرایش هم رد)')

  // حذف → تخصیص‌ها پاک
  await print.remove(added.id)
  const a3 = await print.assignment()
  assert.strictEqual(a3.sales, null)
  assert.strictEqual(a3.kitchen, null)
  passed('حذف چاپگر → تخصیص‌های ارجاع‌دهنده null شدند')

  await assert.rejects(() => print.test(added.id), isValidation)
  passed('عملیات روی چاپگرِ حذف‌شده 404')

  // ══ ۴) P1 — مقصدِ دور: hintِ صریح در خطای چاپ ══
  {
    const distant = await print.add({ name: 'چاپگرِ بیرون از شبکه', host: '192.168.201.222', port: 9100, widthDots: 576 })
    await assert.rejects(
      () => print.dispatch({
        printerId: distant.id, widthPx: 576, heightPx: 16,
        rows: fakeBitmap(576, 16).toString('base64'),
      }),
      (e: unknown) =>
        e instanceof Error &&
        e.message.includes('بیرونِ زیرشبکه‌های') &&
        e.message.includes('VPS'),
    )
    passed('P1: چاپ به IP خصوصیِ بیرونِ زیرشبکه‌های سرور → خطا «راهنمایِ VPS/تونل» می‌آورد')

    // گزارشِ توپولوژی: هر دو چاپگر (loopback فیک + دور) بیرونِ زیرشبکه‌های
    // سرورند ⇒ remote + راهنمایِ استقرار
    const report = await print.networkReport()
    assert.notStrictEqual(report.deploymentMode, 'empty')
    if (report.deploymentMode === 'remote') {
      assert.ok(report.guidance.some((g) => g.includes('VPS') || g.includes('تونل')))
      const mine = report.printers.find((p) => p.id === distant.id)
      assert.ok(mine)
      assert.strictEqual(mine.ip, '192.168.201.222')
      assert.strictEqual(mine.ipKind, 'privatelan')
      assert.strictEqual(mine.inServerSubnet, false)
      passed('P1: گزارشِ شبکه — remote + جایِ IP چاپگر + راهنمایِ فارسی')
    } else {
      console.log(`SKIP P1 remote-گزارش — استقرارِ این ماشین: ${report.deploymentMode}`)
    }
    await print.remove(distant.id)

    // حالتِ «lan» فقط وقتی ماشین زیرشبکهٔ خصوصیِ واقعی دارد (داکرِ کلاینت) —
    // در سندباکسِ /32 اسکیپ می‌شود
    const subnets = serverSubnets()
    const lanSubnet = subnets.find((s) => classifyIpv4(parseIpv4(s.ip) as number) === 'privatelan')
    if (lanSubnet) {
      const inside = await print.add({ name: 'چاپگرِ داخلِ شبکه', host: lanSubnet.ip, port: 9100, widthDots: 576 })
      const lanReport = await print.networkReport()
      const mine = lanReport.printers.find((p) => p.id === inside.id)
      assert.strictEqual(mine?.inServerSubnet, true)
      assert.strictEqual(lanReport.deploymentMode, 'lan')
      await print.remove(inside.id)
      passed('P1: چاپگرِ داخلِ زیرشبکهٔ سرور ⇒ inServerSubnet + حالتِ lan')
    } else {
      console.log('SKIP P1 lan — این ماشین زیرشبکهٔ خصوصی ندارد (سندباکسِ /32)')
    }
  }

  // ══ ۵) تشخیص — اسکن فقط 9100 (P4) روی CIDRِ loopbackِ مجازِ dev ══
  decoy = await startIppDecoy()
  if (fake.port === 9100) {
    const disc = await print.discover({ cidr: '127.0.0.0/29' })
    assert.ok(disc.found.some((f) => f.host === '127.0.0.1' && f.port === 9100), JSON.stringify(disc.found))
    assert.ok(disc.found.every((f) => f.port === 9100), `پورت‌های غیر 9100 در نتیجه: ${JSON.stringify(disc.found)}`)
    assert.ok(!disc.found.some((f) => f.port === 631), 'فیکِ 631 نباید گزارش شود (IPP ≠ ESC/POS خام)')
    passed('P4: اسکنِ زیرشبکه — فقط پورتِ 9100؛ فیکِ 631 (IPP) «پیدا نمی‌شود»')
  } else {
    console.log('SKIP اسکنِ 9100 — پورتِ ترجیحی در سندباکس گرفته بود')
  }
  await assert.rejects(() => print.discover({ cidr: '300.0.0.0/24' }), isValidation)
  passed('CIDR نامعتبر رد می‌شود')
  await assert.rejects(() => print.discover({ cidr: '10.0.0.0/8' }), isValidation)
  passed('CIDR بزرگ‌تر از سقفِ ۵۱۲ میزبان رد می‌شود')
  await assert.rejects(
    () => print.discover({ cidr: '169.254.0.0/16' }),
    (e: unknown) => isValidation(e) && (e as Error).message.includes('169.254'),
  )
  await assert.rejects(
    () => print.discover({ cidr: '8.8.8.0/24' }),
    isValidation,
  )
  passed('P2: اسکنِ بازهٔ metadata و بازهٔ عمومی رد می‌شود')
  // CIDR از env — فقط بازهٔ خصوصیِ مجاز
  process.env.PRINT_SCAN_CIDRS = '10.20.30.0/29'
  const envScan = await print.discover({})
  assert.deepStrictEqual(envScan.scanned, ['10.20.30.0/29'])
  assert.deepStrictEqual(envScan.found, [])
  passed('اسکنِ پیش‌فرض از PRINT_SCAN_CIDRS (بازهٔ خصوصیِ مجاز)')
  process.env.PRINT_SCAN_CIDRS = '8.8.8.0/24'
  await assert.rejects(() => print.discover({}), isValidation)
  delete process.env.PRINT_SCAN_CIDRS
  passed('P2: PRINT_SCAN_CIDRSِ غیرمجاز (بازهٔ عمومی) → خطای صریح')

  // ══ ۶) حالتِ تولید — loopback بسته (پرچمِ dev خاموش) ══
  {
    const savedLoopback = process.env.PRINT_ALLOW_LOOPBACK
    const savedAnyPort = process.env.PRINT_ALLOW_ANY_PORT
    delete process.env.PRINT_ALLOW_LOOPBACK
    delete process.env.PRINT_ALLOW_ANY_PORT
    await assert.rejects(
      () => print.add({ name: 'لوکال در تولید', host: '127.0.0.1', port: 9100 }),
      (e: unknown) => isValidation(e) && (e as Error).message.includes('127'),
    )
    await assert.rejects(
      () => print.discover({ cidr: '127.0.0.0/29' }),
      isValidation,
    )
    passed('P2: حالتِ تولید — loopback برای ثبت و اسکن بسته است (سرویس‌های خودِ سرور در امان)')
    if (savedLoopback) process.env.PRINT_ALLOW_LOOPBACK = savedLoopback
    if (savedAnyPort) process.env.PRINT_ALLOW_ANY_PORT = savedAnyPort
  }

  console.log(`\nOK — ${count} بند سبز`)
} finally {
  try { await fake?.close() } catch { /* بی‌اهمیت */ }
  try { await decoy?.close() } catch { /* بی‌اهمیت */ }
  try { await database?.close() } catch { /* بی‌اهمیت */ }
  try {
    await admin.unsafe(`drop database if exists "${scratch}" with (force)`)
    await admin.close()
  } catch { /* بی‌اهمیت */ }
}
