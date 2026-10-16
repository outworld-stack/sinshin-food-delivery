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
    itemsTotal: 100_000,
    deliveryFee: 0,
    discount: 0,
    walletUsed: 0,
    online: 100_000,
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
        breakdown,
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
    const [row] = await db
      .insert(payments)
      .values({
        orderId: orderId as never,
        userId: uid,
        gateway: 'STUBGW',
        mode: 'direct',
        amount: 100_000,
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
