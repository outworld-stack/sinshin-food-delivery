//src/../scripts/test-payment-money-path.ts
/**
 * تست عمیق مسیر پول (stage-74) — PostgreSQL واقعی + سرویس‌های واقعی:
 *
 *   bun scripts/test-payment-money-path.ts   (از apps/api)
 *
 * سناریوهای گزارش کارفرما + قرارداد مالی:
 *
 *  A) «مجموع پرداخت‌ها» (myOrdersPage.totalSpent):
 *     • PENDING_PAYMENT (پرداخت لغوشده در زرین‌پال) → نباید حساب شود
 *     • PAID (پرداخت واقعی) → حساب شود
 *     • CANCELED (پرداخت ناموفق) → نباید
 *     • REFUNDED (بازگشت وجه) → نباید
 *     • total (شمارش) همه را بشمارد
 *
 *  B) callback زرین‌پال روی سرویس واقعی PaymentService (درگاه stub تزریق‌شده):
 *     • B1: Verify با «errors آرایه‌ای -11» (لغوی واقعی کارفرما) → سفارش
 *          CANCELED + FAILED + آزادسازی کیف پول — نه PENDING ابدی
 *     • B2: خطای شبکه در Verify (throw) → 302 payment=pending (نه 500 خام)
 *          — سفارش دست‌نخورده (کارِ تایم‌اوت بعداً قطعی می‌کند)
 *     • B3: پاسخ indeterminate → همان B2 (رفتار موجود حفظ شد)
 *     • B4: موفق 100 → settle: PAID + paymentStatus=SUCCESS
 *     • B5: callback تکراری → CONFLICT → redirect بدون خطا
 *
 *  C) مرجعیت source of truth:
 *     • after B1: myOrdersPage.totalSpent سفارشِ لغوشده را ندارد (A×B)
 *
 *  D) stage-76 — درگاه‌های «واقعی» سپ/ملت از طریق سرویس (fetch سراسری
 *     mock؛ آداپترهای SepAdapter/MellatAdapter واقعی در رجیستری):
 *     • D1 SEP: initiate → callback موفق → PAID + gatewayRef=RefNum
 *     • D2 SEP: لغو (کوئری غیرخالی بدون RefNum = معادلِ NOK) → CANCELED فوری
 *     • D3 SEP: خطای شبکه در verify → pending + RefNum ذخیره می‌شود →
 *       کارِ تایم‌اوت (reconcilePending) با همان مرجع PAID می‌کند
 *     • D4 MELLAT: bpPayRequest → callback ResCode=0 → verify+settle → PAID
 *       + gatewayRef ماندگار «orderId:s:SaleReferenceId»
 *     • D5 MELLAT: لغو ResCode=17 → CANCELED فوری
 *     • D7 (stage-77): شکستِ قطعی → اعلانِ «پرداخت ناموفق» برای مشتری
 *     • D6 MELLAT: فالت settle → pending + مرجع ماندگار → کارِ تایم‌اوت
 *       ری-وریفای (kind=s) → PAID
 *  E) totalSpent نهایی: فقط PAIDها — لغوها و PENDINGها بیرون
 */
import { SQL } from 'bun'
import { eq } from 'drizzle-orm'

interface UrlParts {
  admin: string
  target: string
}

function parseUrl(): UrlParts {
  // فقط URLهای postgres معتبرند (در محیط توسعه‌ی این اسکن، DATABASE_URL
  // می‌تواند به sqlite محلی اشاره کند — تستِ PG باید به امبدد برود)
  const fromEnv = process.env.DATABASE_URL
  const raw =
    fromEnv && fromEnv.startsWith('postgres')
      ? fromEnv
      : 'postgres://sinshin:sinshin_local@127.0.0.1:5432/sinshin'
  const admin = new URL(raw)
  admin.pathname = '/postgres'
  return { admin: admin.toString(), target: raw }
}

const { admin } = parseUrl()
const scratch = `sinshin_e2e_pay_${process.pid}_${Math.random().toString(36).slice(2, 8)}`

let pass = 0
let fail = 0
function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main(): Promise<void> {
  // ── دیتابیس موقتی + زنجیره‌ی کامل ──
  const boot = new SQL(admin, { max: 1 })
  await boot.unsafe(`drop database if exists "${scratch}" with (force)`)
  await boot.unsafe(`create database "${scratch}"`)
  await boot.close({ timeout: 5 })
  const url = new URL(parseUrl().target)
  url.pathname = `/${scratch}`
  console.log(`\n══ دیتابیس موقتی: ${scratch} ══`)

  const proc = Bun.spawn(['bun', 'src/infra/db/migrate.ts'], {
    cwd: import.meta.dir + '/..',
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const out = await new Response(proc.stdout).text()
  const errTxt = await new Response(proc.stderr).text()
  const code = await proc.exited
  if (code !== 0) {
    console.log(out + errTxt)
    throw new Error('migrate ناموفق بود')
  }

  // ── سرویس‌های واقعی ──
  const { Database } = await import('../src/infra/db/client')
  const { AppConfig } = await import('../src/infra/config/env')
  const { OrderService } = await import('../src/domain/order/order.service')
  const { PaymentService } = await import('../src/domain/payment/payment.service')
  const { NotificationService } = await import('../src/domain/notification/notification.service')
  const { SettingsService } = await import('../src/domain/settings/settings.service')
  const { DeliveryZoneService } = await import('../src/domain/delivery/delivery-zone.service')
  const { CouponService } = await import('../src/domain/coupon/coupon.service')
  const { signState } = await import('../src/domain/payment/state')
  const { orders, payments, users, walletTransactions } = await import('../src/infra/db/schema')

  const config = new AppConfig({
    NODE_ENV: 'development',
    DATABASE_URL: url.toString(),
    GATEWAY_MODE: 'direct',
    JWT_SECRET: 'x'.repeat(40),
    SITE_URL: 'https://sinshin.example',
    SEP_TERMINAL_ID: '12345678',
    MELLAT_TERMINAL_ID: '111222333',
    MELLAT_USERNAME: 'test-user',
    MELLAT_PASSWORD: 'test-pass',
  })
  const database = new Database(url.toString(), { max: 4 })
  const db = database.db

  const settings = new SettingsService({ db, config })
  const zones = new DeliveryZoneService({ db, settings })
  const coupons = new CouponService({ db })
  const notifications = new NotificationService({
    db,
    config,
    hub: { publish: () => undefined, subscribe: () => () => undefined } as never,
  })
  const orderService = new OrderService({ db, config, zones, settings, coupons, notifications })
  const paymentService = new PaymentService({
    db,
    config,
    orders: orderService,
    hub: { publish: () => undefined, subscribe: () => () => undefined } as never,
    notifications,
  })

  // ── داده‌ی پایه: کاربر + ۴ سفارش با وضعیت‌های متمایز ──
  const [user] = await db
    .insert(users)
    .values({ phone: '09150000001', role: 'user' })
    .returning()
  const uid = user!.id
  const breakdown = {
    foodTotal: 100_000,
    deliveryFee: 0,
    discount: 0,
    walletDeduction: 0,
    packagingFee: 0,
    amountPaidOnline: 100_000,
    totalAmount: 100_000,
  } as unknown as typeof orders.$inferInsert.breakdown

  const mkOrder = async (status: string, paymentStatus: string, amount: number) => {
    const [row] = await db
      .insert(orders)
      .values({
        userId: uid,
        displayId: `ord-test${Math.random().toString(36).slice(2, 8)}`,
        status: status as typeof orders.$inferInsert.status,
        paymentStatus,
        deliveryType: 'PICKUP',
        totalAmount: amount,
        breakdown: { ...breakdown, foodTotal: amount, totalAmount: amount, amountPaidOnline: amount },
      })
      .returning()
    return row
  }

  const orderPending = (await mkOrder('PENDING_PAYMENT', 'PENDING', 100_000))! // لغوشده در زرین‌پال
  await mkOrder('PAID', 'SUCCESS', 250_000)
  await mkOrder('CANCELED', 'FAILED', 50_000)
  await mkOrder('CANCELED', 'REFUNDED', 75_000)
  await wait(50)

  console.log('\n══ A) «مجموع پرداخت‌ها» — myOrdersPage ══\n')
  const page = await orderService.myOrdersPage(uid, { page: 1, limit: 10, sort: 'newest' })
  ok('A1: totalSpent فقط سفارشِ پرداخت‌شده (۲۵۰٬۰۰۰)', page.totalSpent === 250_000, `got=${page.totalSpent}`)
  ok('A2: total همه‌ی سفارش‌ها (۴)', page.total === 4, `got=${page.total}`)
  ok(
    'A3: لیست سفارشات همه را نشان می‌دهد (ردیف کامل)',
    page.orders.length === 4,
    `got=${page.orders.length}`,
  )

  // صفحه‌های sort — same aggregate
  const pageSorted = await orderService.myOrdersPage(uid, { page: 1, limit: 2, sort: 'expensive' })
  ok('A4: تجمیع مستقل از صفحه‌بندی/سورت', pageSorted.totalSpent === 250_000)

  console.log('\n══ B) callback زرین‌پال — PaymentService.handleCallback ══\n')

  // درگاه stub با رفتار قابل‌کنترل — مستقیم در رجیستری سرویس
  type VerifyOutcome = { success: boolean; indeterminate?: boolean }
  let behavior: () => VerifyOutcome | Promise<VerifyOutcome> = () => ({ success: false, indeterminate: true })
  let verifyCalls = 0
  const stubGateway = {
    id: 'STUBGW',
    mode: 'direct' as const,
    init: async () => ({ paymentUrl: 'https://stub.example/pay', gatewayRef: 'STUB-REF-1' }),
    verify: async (): Promise<VerifyOutcome & { gatewayRef: string }> => {
      verifyCalls++
      const b = await behavior()
      return { gatewayRef: 'STUB-REF-1', ...b }
    },
  }
  ;(paymentService as unknown as { gateways: Map<string, unknown> }).gateways.set('STUBGW', stubGateway)

  // ردیف پرداخت + state امضاشده
  const mkPayment = async (orderId: string, gwRef: string) => {
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId as never))
    const [row] = await db
      .insert(payments)
      .values({
        orderId: orderId as never,
        userId: uid,
        gateway: 'STUBGW',
        mode: 'direct',
        amount: order!.breakdown.amountPaidOnline,
        status: 'PENDING',
        gatewayRef: gwRef,
      })
      .returning()
    return row!
  }
  const state = (id: string) => signState(id as never, config.jwtSecret)

  // B1 — لغوی واقعی: errors آرایه‌ای -11 → قطعی FAILED
  const payB1 = await mkPayment(orderPending.id, 'STUB-B1')
  behavior = () => ({ success: false }) // آداپتورِ واقعی این را از errors:[{code:-11}] می‌سازد
  const rB1 = await paymentService.handleCallback('STUBGW', {
    state: state(payB1.id),
    Status: 'NOK', // همان callback لغوِ کارفرما
  })
  const orderB1 = (await db.select().from(orders).where(eq(orders.id, orderPending.id)))[0]!
  const payB1Row = (await db.select().from(payments).where(eq(payments.id, payB1.id)))[0]!
  ok(
    'B1: لغو (NOK + قطعی-ناموفق) → سفارش CANCELED (نه PENDING ابدی)',
    orderB1.status === 'CANCELED',
    `status=${orderB1.status}`,
  )
  ok('B1: پرداخت FAILED', payB1Row.status === 'FAILED')
  ok('B1: redirect به صفحه‌ی سفارش (نه خطا)', (rB1.redirect ?? '').includes('/dashboard/orders/'))

  // B2 — خطای شبکه در verify → indeterminate → 302 pending، سفارش دست‌نخورده
  const orderForB2 = (await mkOrder('PENDING_PAYMENT', 'PENDING', 120_000))!
  const payB2 = await mkPayment(orderForB2.id, 'STUB-B2')
  ;(stubGateway as { verify: unknown }).verify = async () => {
    verifyCalls++
    throw new Error('network: ETIMEDOUT به درگاه')
  }
  const rB2 = await paymentService.handleCallback('STUBGW', { state: state(payB2.id), Status: 'NOK' })
  const orderB2 = (await db.select().from(orders).where(eq(orders.id, orderForB2.id)))[0]!
  const payB2Row = (await db.select().from(payments).where(eq(payments.id, payB2.id)))[0]!
  ok(
    'B2: خطای شبکه‌ی verify → 302 payment=pending (نه 500 خام)',
    (rB2.redirect ?? '').includes('payment=pending'),
    JSON.stringify(rB2),
  )
  ok('B2: سفارش PENDING_PAYMENT می‌ماند (پول در خطر نیست)', orderB2.status === 'PENDING_PAYMENT')
  ok('B2: ردیف پرداخت PENDING می‌ماند', payB2Row.status === 'PENDING')
  ;(stubGateway as { verify: unknown }).verify = async (): Promise<VerifyOutcome & { gatewayRef: string }> => {
    verifyCalls++
    const b = await behavior()
    return { gatewayRef: 'STUB-REF-1', ...b }
  }

  // B3 — indeterminate (بدون throw) → همان B2
  behavior = () => ({ success: false, indeterminate: true })
  const rB3 = await paymentService.handleCallback('STUBGW', { state: state(payB2.id), Status: 'NOK' })
  ok(
    'B3: indeterminate کلاسیک → 302 payment=pending (رفتار موجود)',
    (rB3.redirect ?? '').includes('payment=pending'),
  )

  // B4 — موفق 100 → settle
  const orderForB4 = (await mkOrder('PENDING_PAYMENT', 'PENDING', 130_000))!
  const payB4 = await mkPayment(orderForB4.id, 'STUB-B4')
  behavior = () => ({ success: true })
  const rB4 = await paymentService.handleCallback('STUBGW', { state: state(payB4.id), Status: 'OK' })
  const orderB4 = (await db.select().from(orders).where(eq(orders.id, orderForB4.id)))[0]!
  const payB4Row = (await db.select().from(payments).where(eq(payments.id, payB4.id)))[0]!
  ok('B4: پرداخت موفق → سفارش PAID', orderB4.status === 'PAID', `status=${orderB4.status}`)
  ok('B4: paymentStatus=SUCCESS', orderB4.paymentStatus === 'SUCCESS')
  ok('B4: ردیف پرداخت SUCCESS + verifiedAt', payB4Row.status === 'SUCCESS' && !!payB4Row.verifiedAt)
  ok('B4: redirect به صفحه‌ی سفارش', (rB4.redirect ?? '').includes('/dashboard/orders/'))

  // B5 — callback تکراری → CONFLICT → redirect بدون خطا
  const rB5 = await paymentService.handleCallback('STUBGW', { state: state(payB4.id), Status: 'OK' })
  ok(
    'B5: callback تکراری → redirect صفحه‌ی سفارش (بدون throw)',
    (rB5.redirect ?? '').includes('/dashboard/orders/') && !(rB5 as { redirect?: string }).redirect!.includes('payment=pending'),
  )

  console.log('\n══ C) قرارداد «A×B» — مجموع پس از لغو ══\n')
  const pageFinal = await orderService.myOrdersPage(uid, { page: 1, limit: 10 })
  // 250k (PAID قدیمی) + 130k (B4 تازه settled) — بدون لغوشده‌ها و بدون refunded
  ok(
    'C1: totalSpent پس از settle = ۳۸۰٬۰۰۰ (لغوها بیرون)',
    pageFinal.totalSpent === 380_000,
    `got=${pageFinal.totalSpent}`,
  )

  // کیف پول — B4 نگاهی به تسویه: breakdown این تست wallet ندارد؛ فقط ثابت کنیم
  // مسیرِ آزادسازیِ رزرو (failPayment) در B1 اجرا شد و wallet_tx خراب نکرد
  // (صفر تراکنشِ جعلی/زائد برای این کاربرِ تستی)
  const walletRows = await db.select().from(walletTransactions).where(eq(walletTransactions.userId, uid))
  ok('C2: مسیر failPayment در B1 بی‌خطا اجرا شد', verifyCalls >= 3 && walletRows.length === 0, `txs=${walletRows.length}`)

  // ════════════════════════════════════════════════════════════════
  // D) stage-76 — درگاه‌های واقعی سپ/ملت از طریق سرویس (fetch سراسری mock)
  // ════════════════════════════════════════════════════════════════
  console.log('\n══ D) درگاه‌های واقعی سپ/ملت — PaymentService + آداپترهای واقعی ══\n')

  const gwJson = (obj: unknown): Response =>
    new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } })
  const soap = (value: string | null): Response => {
    const body =
      value === null
        ? '<soapenv:Fault><faultcode>soapenv:Server</faultcode></soapenv:Fault>'
        : `<bpResponse xmlns="http://interfaces.core.sw.bps.com/"><return>${value}</return></bpResponse>`
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">' +
        `<soapenv:Body>${body}</soapenv:Body></soapenv:Envelope>`,
      { status: 200, headers: { 'content-type': 'text/xml; charset=utf-8' } },
    )
  }

  // رفتارِ قابل‌کنترلِ درگاه‌ها — به‌ازای هر سناریو تنظیم می‌شود
  let sepVerify: () => Response | Promise<Response> = () => gwJson({ IsSuccess: true, Amount: 0 })
  let sepInitOk = true
  let mellatPay = '0,555001'
  let mellatVerify = '0'
  let mellatSettle = '0'

  ;(globalThis as Record<string, unknown>).fetch = async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    const u = String(url)
    if (u.includes('sep.shaparak.ir/api/v1/Payment/InitPayment')) {
      return sepInitOk ? gwJson({ IsSuccess: true, Token: `tok-${Math.random().toString(36).slice(2, 8)}` }) : gwJson({ IsSuccess: false, ResultCode: 58 })
    }
    if (u.includes('sep.shaparak.ir/api/v1/Payment/VerifyPayment')) return sepVerify()
    if (u.includes('bpm.shaparak.ir')) {
      const op = /<ns:(\w+) xmlns:ns=/.exec(String(init?.body ?? ''))?.[1] ?? ''
      if (op === 'bpPayRequest') return soap(mellatPay)
      if (op === 'bpVerifyRequest') return soap(mellatVerify)
      return soap(mellatSettle)
    }
    throw new Error(`[test] fetch غیرمنتظره: ${u}`)
  }

  const orderAndPayment = async (gateway: 'SEP' | 'MELLAT', amount2: number, gwRef: string | null) => {
    const o = (await mkOrder('PENDING_PAYMENT', 'PENDING', amount2))!
    const [p] = await db
      .insert(payments)
      .values({
        orderId: o.id as never,
        userId: uid,
        gateway,
        mode: 'direct',
        amount: amount2,
        status: 'PENDING',
        gatewayRef: gwRef,
      })
      .returning()
    return { order: o, payment: p! }
  }
  const refreshOrder = async (id: string) => (await db.select().from(orders).where(eq(orders.id, id as never)))[0]!
  const refreshPayment = async (id: string) => (await db.select().from(payments).where(eq(payments.id, id as never)))[0]!

  // ── D1: SEP — مسیر موفق کامل ──
  sepInitOk = true
  const d1 = await orderAndPayment('SEP', 140_000, null)
  const init1 = await paymentService.initiate(d1.payment.id, 'SEP', {
    displayId: d1.order.displayId,
    amount: 140_000,
  })
  ok('D1: SEP initiate → paymentUrl صفحه‌ی پرداخت شاپرک', init1.paymentUrl.includes('/PaymentPage?Token='))
  sepVerify = () => gwJson({ IsSuccess: true, Amount: 140_000 * 10 })
  await paymentService.handleCallback('SEP', {
    state: state(d1.payment.id),
    State: 'OK',
    RefNum: 'R1',
    TraceNo: '111',
  })
  ok('D1: SEP callback موفق → سفارش PAID', (await refreshOrder(d1.order.id)).status === 'PAID')
  const d1p = await refreshPayment(d1.payment.id)
  ok('D1: SEP ردیف SUCCESS + gatewayRef=RefNum', d1p.status === 'SUCCESS' && d1p.gatewayRef === 'R1')

  // ── D2: SEP — لغو (معادلِ NOK زرین‌پال): کوئری غیرخالی بدون RefNum ──
  const d2 = await orderAndPayment('SEP', 180_000, null)
  await paymentService.initiate(d2.payment.id, 'SEP', { displayId: d2.order.displayId, amount: 180_000 })
  await paymentService.handleCallback('SEP', {
    state: state(d2.payment.id),
    State: 'Canceled By User',
    TraceNo: '222',
  })
  const d2o = await refreshOrder(d2.order.id)
  const d2p = await refreshPayment(d2.payment.id)
  ok(
    'D2: unsigned SEP cancellation preserves the pending order and hold',
    d2o.status === 'PENDING_PAYMENT' && d2p.status === 'PENDING',
    `order=${d2o.status} payment=${d2p.status}`,
  )
  const d2fail = (d2p.metadata as { fail?: { source?: string; gateway?: string } } | null)?.fail
  ok(
    'D2: unsigned cancellation is not recorded as a confirmed failure',
    d2fail === undefined,
    JSON.stringify(d2fail),
  )

  // ── D3: SEP — خطای شبکه → pending + RefNum ذخیره → کارِ تایم‌اوت PAID می‌کند ──
  const d3 = await orderAndPayment('SEP', 150_000, null)
  await paymentService.initiate(d3.payment.id, 'SEP', { displayId: d3.order.displayId, amount: 150_000 })
  sepVerify = () => {
    throw new Error('network: قطعی شاپرک')
  }
  const d3r = await paymentService.handleCallback('SEP', {
    state: state(d3.payment.id),
    State: 'OK',
    RefNum: 'R3',
    TraceNo: '333',
  })
  ok(
    'D3: SEP خطای شبکه در verify → 302 payment=pending (نه 500 خام)',
    (d3r.redirect ?? '').includes('payment=pending'),
    JSON.stringify(d3r),
  )
  const d3pMid = await refreshPayment(d3.payment.id)
  ok(
    'D3: SEP RefNum در حالت indeterminate ذخیره شد (برای ری-وریفای)',
    d3pMid.status === 'PENDING' && d3pMid.gatewayRef === 'R3',
    `status=${d3pMid.status} ref=${d3pMid.gatewayRef}`,
  )

  // ── D4: MELLAT — مسیر موفق کامل (bpPayRequest → ResCode=0 → verify+settle) ──
  const d4 = await orderAndPayment('MELLAT', 160_000, null)
  mellatPay = '0,555401'
  const init4 = await paymentService.initiate(d4.payment.id, 'MELLAT', {
    displayId: d4.order.displayId,
    amount: 160_000,
  })
  const d4pMid = await refreshPayment(d4.payment.id)
  ok(
    'D4: MELLAT initiate → StartPay + gatewayRef «orderId:t:RefId»',
    init4.paymentUrl.includes('/StartPay/') && /:t:555401$/.test(String(d4pMid.gatewayRef)),
    `url=${init4.paymentUrl} ref=${d4pMid.gatewayRef}`,
  )
  mellatVerify = '0'
  mellatSettle = '0'
  await paymentService.handleCallback('MELLAT', {
    state: state(d4.payment.id),
    ResCode: '0',
    RefId: '555401',
    SaleOrderId: String(d4pMid.gatewayRef).split(':')[0]!,
    SaleReferenceId: '555402',
  })
  ok('D4: MELLAT callback (ResCode=0 + verify+settle ۰/۰) → PAID', (await refreshOrder(d4.order.id)).status === 'PAID')
  const d4p = await refreshPayment(d4.payment.id)
  ok(
    'D4: MELLAT gatewayRef ماندگار «orderId:s:SaleReferenceId»',
    d4p.status === 'SUCCESS' &&
      d4p.gatewayRef === String(d4pMid.gatewayRef).replace(':t:555401', ':s:555402') &&
      /:s:555402$/.test(String(d4p.gatewayRef)),
    `ref=${d4p.gatewayRef}`,
  )

  // ── D5: MELLAT — لغو ResCode=17 (انصراف مشتری) ──
  const d5 = await orderAndPayment('MELLAT', 190_000, null)
  mellatPay = '0,555501'
  await paymentService.initiate(d5.payment.id, 'MELLAT', { displayId: d5.order.displayId, amount: 190_000 })
  await paymentService.handleCallback('MELLAT', {
    state: state(d5.payment.id),
    ResCode: '17',
    RefId: '555501',
  })
  ok(
    'D5: unsigned Mellat cancellation preserves the pending order and hold',
    (await refreshOrder(d5.order.id)).status === 'PENDING_PAYMENT' && (await refreshPayment(d5.payment.id)).status === 'PENDING',
  )


  // ── D6: MELLAT — فالت settle → pending + مرجع ماندگار → کارِ تایم‌اوت PAID ──
  const d6 = await orderAndPayment('MELLAT', 170_000, null)
  mellatPay = '0,555601'
  await paymentService.initiate(d6.payment.id, 'MELLAT', { displayId: d6.order.displayId, amount: 170_000 })
  mellatVerify = '0'
  mellatSettle = null as unknown as string // فالت — null یعنی فالت ساب
  const d6r = await paymentService.handleCallback('MELLAT', {
    state: state(d6.payment.id),
    ResCode: '0',
    RefId: '555601',
    SaleReferenceId: '555602',
  })
  ok(
    'D6: MELLAT فالت settle → 302 payment=pending (پول در خطر نیست)',
    (d6r.redirect ?? '').includes('payment=pending'),
    JSON.stringify(d6r),
  )
  const d6pMid = await refreshPayment(d6.payment.id)
  ok(
    'D6: MELLAT مرجع ماندگار ذخیره شد (s:)',
    d6pMid.status === 'PENDING' && /:s:555602$/.test(String(d6pMid.gatewayRef)),
    `status=${d6pMid.status} ref=${d6pMid.gatewayRef}`,
  )

  // ── کارِ تایم‌اوت — ری-وریفایِ D3 و D6 (B2 عمداً indeterminate می‌ماند) ──
  behavior = () => ({ success: false, indeterminate: true }) // B2: نامشخصِ <۲۴h → دست‌نخورده
  sepVerify = () => gwJson({ IsSuccess: true, Amount: 150_000 * 10 })
  mellatVerify = '43'
  mellatSettle = '0'
  const rec = await paymentService.reconcilePending(0)
  ok(
    'D3+D6: کارِ تایم‌اوت هر دو را PAID کرد (ری-وریفای با مرجعِ ذخیره‌شده)',
    (await refreshOrder(d3.order.id)).status === 'PAID' && (await refreshOrder(d6.order.id)).status === 'PAID',
    `orderD3=${(await refreshOrder(d3.order.id)).status} orderD6=${(await refreshOrder(d6.order.id)).status}`,
  )
  ok(
    'D3+D6: شمارشِ کار — ۲ ری-وریفای، ۰ شکست',
    rec.reverified === 2 && rec.failed === 0,
    JSON.stringify(rec),
  )
  ok(
    'B2: نامشخصِ <۲۴h دست‌نخورده ماند (PENDING_PAYMENT — پول در خطر نیست)',
    (await refreshOrder(orderForB2.id)).status === 'PENDING_PAYMENT',
  )

  console.log('\n══ E) قرارداد نهایی «A×B×D» — مجموع فقط از PAIDها ══\n')
  const pageFinal2 = await orderService.myOrdersPage(uid, { page: 1, limit: 30 })
  ok(
    'E1: totalSpent نهایی = ۱٬۰۰۰٬۰۰۰ — فقط شش PAID (۲۵۰+۱۳۰+۱۴۰+۱۵۰+۱۶۰+۱۷۰)؛ لغوها/PENDING بیرون',
    pageFinal2.totalSpent === 1_000_000,
    `got=${pageFinal2.totalSpent}`,
  )

  // ── D7 (stage-77/N4): شکستِ قطعیِ پرداخت ⇒ اعلانِ مشتری ──
  // Only the server-verified failure B1 may announce a refund. Unsigned
  // cancellations and indeterminate attempts must not emit failure notices.
  {
    const { notifications: notifRows } = await import('../src/infra/db/schema')
    const notifs = await db
      .select()
      .from(notifRows)
      .where(eq(notifRows.userId, uid))
    const payFails = notifs.filter(
      (n) => n.type === 'system' && (n.data as { source?: string })?.source === 'payment-failed',
    )
    ok(
      'D7: only verified failure B1 emits a payment-failed notification',
      payFails.length === 1,
      `count=${payFails.length}`,
    )
    ok(
      'D7: unverified Mellat cancellation does not announce a refund',
      !payFails.some((n) => (n.url ?? '').includes(d5.order.displayId)),
    )
    ok(
      'D7: unverified SEP cancellation does not announce a refund',
      !payFails.some((n) => (n.url ?? '').includes(d2.order.displayId)),
    )
  }

  await wait(300)

  // پاک‌سازی
  await database.close()
  const cleaner = new SQL(admin, { max: 1 })
  await cleaner.unsafe(`drop database if exists "${scratch}" with (force)`)
  await cleaner.close({ timeout: 5 })

  console.log(`\n══ نتیجه: ${pass} ✓ / ${fail} ✗ ══\n`)
  if (fail > 0) process.exit(1)
}

void main()
