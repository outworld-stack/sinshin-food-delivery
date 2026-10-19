/** stage-88 — تست یکپارچه‌ی «پل چاپِ سرور» روی PostgreSQL واقعی + چاپگرِ فیکِ TCP.
 *
 * پوشش:
 *  ۱) کدگذار ESC/POS بایت‌به‌بایت: GS v 0 (xL/xH بایت، yL/yH dot)،
 *     قطعه‌بندیِ ≤۹۶۰dot + LF بینِ قطعه‌ها، دنبالهٔ برش GS V 42 0،
 *     تفسیرِ DLE EOT 1/4
 *  ۲) PrinterService روی DB موقتی: CRUD + یکتاییِ (host,port) + تخصیصِ
 *     فاکتورها (خطای id مجهول) + پاک‌شدنِ تخصیص با حذف
 *  ۳) چاپِ واقعی روی سوکت: چاپگرِ فیکِ ESC/POS در همین پروسه (پاسخِ DLE
 *     EOT می‌دهد) — dispatch: ESC @ → GS v 0 → برش؛ کاغذِ تمام = خطا
 *     قبل از ارسالِ رستری؛ عرضِ ناهمخوان = خطا
 *  ۴) تشخیص: اسکنِ CIDR روی 127.0.0.1 — پورتِ باز پیدا می‌شود
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
  close: () => Promise<void>
}
async function startFakePrinter(preferredPort: number): Promise<FakePrinter> {
  const chunks: Buffer[] = []
  let paperEnd = false
  const server = net.createServer((socket) => {
    socket.on('data', (d: Buffer) => {
      chunks.push(d)
      // پروتکلِ DLE EOT — همان‌طور که چاپگرِ واقعی: هر درخواست یک بایت پاسخ
      for (let i = 0; i + 2 < d.length; i++) {
        if (d[i] === 0x10 && d[i + 1] === 0x04 && d[i + 2] === 0x01) {
          socket.write(Buffer.from([0x12])) // آنلاینِ سالم
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
let fakeDiscover: FakePrinter | undefined
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
  // ══ ۱) کدگذار ESC/POS — بایت‌به‌بایت (بدون DB) ══
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
    assert.strictEqual(frags, 3, `قطعه‌بندی 960+960+120 → ${frags}`)
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

  // ══ ۲) سرویس روی DB موقتی + چاپگرِ فیک ══
  await admin.unsafe(`create database "${scratch}"`)
  database = new Database(scratchUrl.toString(), { max: 8 })
  const db = database.db
  await migrate(db, { migrationsFolder: import.meta.dir + '/../drizzle' })
  const config = new AppConfig({
    NODE_ENV: 'development', DATABASE_URL: scratchUrl.toString(), GATEWAY_MODE: 'direct',
    JWT_SECRET: 'print-test-'.repeat(3), SITE_URL: 'https://sinshin.example',
  })
  const settings = new SettingsService({ db, config })
  const print = new PrinterService({ db, settings })

  fake = await startFakePrinter(9100)
  const fp: FakePrinter = fake
  console.log(`— چاپگرِ فیک روی 127.0.0.1:${fp.port}`)

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

  // ویرایش
  const upd = await print.update(added.id, { name: 'چاپگر فروش' })
  assert.strictEqual(upd.name, 'چاپگر فروش')
  passed('ویرایش چاپگر')

  // حذف → تخصیص‌ها پاک
  await print.remove(added.id)
  const a3 = await print.assignment()
  assert.strictEqual(a3.sales, null)
  assert.strictEqual(a3.kitchen, null)
  passed('حذف چاپگر → تخصیص‌های ارجاع‌دهنده null شدند')

  await assert.rejects(() => print.test(added.id), isValidation)
  passed('عملیات روی چاپگرِ حذف‌شده 404')

  // ══ ۳) تشخیص — اسکنِ CIDR روی loopback ══
  if (fake.port === 9100) {
    const disc = await print.discover({ cidr: '127.0.0.0/29' })
    assert.ok(disc.found.some((f) => f.host === '127.0.0.1' && f.port === 9100), JSON.stringify(disc.found))
    passed('اسکنِ زیرشبکه: چاپگرِ فیک روی 127.0.0.1:9100 پیدا شد')
  } else {
    console.log('SKIP اسکنِ 9100 — پورتِ ترجیحی در سندباکس گرفته بود')
  }
  await assert.rejects(() => print.discover({ cidr: '300.0.0.0/24' }), isValidation)
  passed('CIDR نامعتبر رد می‌شود')
  await assert.rejects(() => print.discover({ cidr: '10.0.0.0/8' }), isValidation)
  passed('CIDR بزرگ‌تر از سقفِ ۵۱۲ میزبان رد می‌شود')

  console.log(`\nOK — ${count} بند سبز`)
} finally {
  try { await fake?.close() } catch { /* بی‌اهمیت */ }
  try { await fakeDiscover?.close() } catch { /* بی‌اهمیت */ }
  try { await database?.close() } catch { /* بی‌اهمیت */ }
  try {
    await admin.unsafe(`drop database if exists "${scratch}" with (force)`)
    await admin.close()
  } catch { /* بی‌اهمیت */ }
}
