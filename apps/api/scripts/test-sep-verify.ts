//src/../scripts/test-sep-verify.ts
/**
 * تست عمیق آداپتور سامان/SEP (stage-76) — بدون شبکه‌ی واقعی: fetch سراسری
 * mock می‌شود و همه‌ی شکل‌های پاسخ Token API شبیه‌سازی می‌شوند.
 *
 *   bun scripts/test-sep-verify.ts   (از apps/api)
 *
 * سنجه — همان چک‌لیستی که باگ‌های زرین‌پال را گرفت (stage-74):
 *   ۱) لغو (معادلِ NOK زرین‌پال): callback بدون RefNum + کوئری غیرخالی ⇒
 *      شکستِ قطعیِ فوری — نه indeterminate ابدی (سفارش CANCELED می‌شود،
 *      «مجموع پرداخت‌ها» آلوده نمی‌شود، ۲۴ ساعت معلق نمی‌ماند).
 *   ۲) منبع حقیقت = VerifyPayment سرور-به-سرور؛ مرجعِ ذخیره‌شده مقدم بر
 *      کوئری (ضد-جعل)؛ چک مبلغ ریالی.
 *   ۳) نامشخصِ پول‌ایمن: خطای شبکه/پاسخ غیر-JSON/شکل ناشناخته ⇒
 *      indeterminate + RefNum در gatewayRef حفظ می‌شود تا کارِ تایم‌اوت
 *      دوباره تلاش کند.
 *   ۴) probe تایم‌اوت (کوئری خالی) ⇒ indeterminate (پول ممکن است گرفته
 *      شده باشد — رارد H6).
 *   ۵) پارامترها: مبلغ ×۱۰ ریال، ResNum=paymentId، CellNumber به فرمتِ
 *      مستندِ 98xxxxxxxxxx (stage-76)، TerminalId.
 */
import type { AppConfig } from '#/infra/config/env'
import { SepAdapter } from '#/domain/payment/sep.adapter'
import { AppError } from '#/domain/shared/errors'

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

/** آخرین درخواست آداپتور — برای ادعاهای پارامتری */
let lastBody: Record<string, unknown> | null = null
let lastUrl = ''

type Responder = () => Response | Promise<Response>

function mockFetch(responder: Responder): void {
  lastBody = null
  lastUrl = ''
  ;(globalThis as Record<string, unknown>).fetch = async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    lastUrl = String(url)
    if (init?.body) {
      try {
        lastBody = JSON.parse(String(init.body)) as Record<string, unknown>
      } catch {
        lastBody = null
      }
    }
    return responder()
  }
}

const jsonResponse = (obj: unknown): Response =>
  new Response(JSON.stringify(obj), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const config = {
  gateway: { sepTerminalId: '12345678', timeoutMs: 2_000 },
} as unknown as AppConfig

const adapter = new SepAdapter(config)
const PAYMENT_ID = 'pay-000000000000001' as never // PaymentId برنددار
const REFNUM = 'REF-SEP-000111'
const amount = 150_000 // تومان

async function main(): Promise<void> {
  console.log('\n══ تست آداپتور سامان (SEP) — Token API ══\n')

  // ── init ──
  console.log('── init (InitPayment) ──')

  mockFetch(() => jsonResponse({ IsSuccess: true, Token: 'tok-AAA' }))
  const initOk = await adapter.init({
    paymentId: PAYMENT_ID,
    displayId: 'ord-1',
    amount,
    callbackUrl: 'https://sinshin.example/api/payments/sep/callback?state=st',
    description: 'سفارش ord-1',
    mobile: '09151234567',
  })
  ok('init موفق → paymentUrl صفحه‌ی پرداخت با Token', initOk.paymentUrl.includes('/PaymentPage?Token=tok-AAA'), initOk.paymentUrl)
  ok('init موفق → gatewayRef=null (RefNum فقط در callback می‌رسد)', initOk.gatewayRef === null)

  mockFetch(() => jsonResponse({ isSuccess: true, token: 'tok-BBB' }))
  const initLower = await adapter.init({
    paymentId: PAYMENT_ID,
    displayId: 'ord-1',
    amount,
    callbackUrl: 'https://sinshin.example/cb',
    description: 'd',
    mobile: null,
  })
  ok('init با کلیدهای lowercase (isSuccess/token) هم خوانده می‌شود', initLower.paymentUrl.includes('tok-BBB'))

  mockFetch(() => jsonResponse({ IsSuccess: false, ResultCode: 58 }))
  try {
    await adapter.init({ paymentId: PAYMENT_ID, displayId: 'ord-1', amount, callbackUrl: 'https://x/cb', description: 'd' })
    ok('init ناموفق (IsSuccess=false) → conflict', false)
  } catch (e) {
    ok(
      'init ناموفق (IsSuccess=false) → conflict با کد درگاه',
      e instanceof AppError && e.code === 'CONFLICT' && String(e.message).includes('58'),
    )
  }

  mockFetch(() => new Response('<html>شاپرک خطا</html>', { status: 502, headers: { 'content-type': 'text/html' } }))
  try {
    await adapter.init({ paymentId: PAYMENT_ID, displayId: 'ord-1', amount, callbackUrl: 'https://x/cb', description: 'd' })
    ok('init با پاسخ HTML شاپرک → conflict (نه کرش)', false)
  } catch (e) {
    ok('init با پاسخ HTML شاپرک → conflict (نه کرش)', e instanceof AppError && e.code === 'CONFLICT')
  }

  // پارامترهای init
  mockFetch(() => jsonResponse({ IsSuccess: true, Token: 'tok-P' }))
  await adapter.init({
    paymentId: PAYMENT_ID,
    displayId: 'ord-1',
    amount,
    callbackUrl: 'https://sinshin.example/cb',
    description: 'd',
    mobile: '09151234567',
  })
  ok('init: مبلغ به ریال (×۱۰) فرستاده می‌شود', lastBody?.Amount === amount * 10)
  ok('init: ResNum = شناسه‌ی پرداخت داخلی', lastBody?.ResNum === PAYMENT_ID)
  ok('init: RedirectUrl همان callback امضاشده', lastBody?.RedirectUrl === 'https://sinshin.example/cb')
  ok('init: CellNumber نرمال‌شده به 98xxxxxxxxxx (stage-76)', lastBody?.CellNumber === '989151234567', String(lastBody?.CellNumber))

  mockFetch(() => jsonResponse({ IsSuccess: true, Token: 'tok-Q' }))
  await adapter.init({
    paymentId: PAYMENT_ID,
    displayId: 'ord-1',
    amount,
    callbackUrl: 'https://sinshin.example/cb',
    description: 'd',
    mobile: '+441234567890',
  })
  ok(
    'init: موبایل غیر-ایرانی → CellNumber حذف (اختیاری است)',
    lastBody?.CellNumber === undefined,
    String(lastBody?.CellNumber),
  )

  mockFetch(() => jsonResponse({ IsSuccess: true, Token: 'tok-R' }))
  await adapter.init({
    paymentId: PAYMENT_ID,
    displayId: 'ord-1',
    amount,
    callbackUrl: 'https://sinshin.example/cb',
    description: 'd',
    mobile: null,
  })
  ok('init: بدون موبایل → CellNumber حذف', lastBody?.CellNumber === undefined)

  // ── verify ──
  console.log('\n── verify (VerifyPayment) ──')

  // موفق + تطابق مبلغ
  mockFetch(() => jsonResponse({ IsSuccess: true, Amount: amount * 10 }))
  const vOk = await adapter.verify({ gatewayRef: REFNUM, amount, query: { State: 'OK', RefNum: REFNUM, TraceNo: '777' } })
  ok('verify موفق + مبلغ یکسان → success', vOk.success && !vOk.indeterminate)
  ok('verify موفق → gatewayRef=RefNum', vOk.gatewayRef === REFNUM)

  // مبلغ رشته‌ای (بعضی استک‌های بانک)
  mockFetch(() => jsonResponse({ IsSuccess: true, Amount: String(amount * 10) }))
  const vStr = await adapter.verify({ gatewayRef: REFNUM, amount, query: {} })
  ok('verify: Amount به شکل رشته هم تطبیق می‌خورد', vStr.success)

  // موفق اعلام‌شده + مبلغ ناهم‌خوان → indeterminate (پول‌ایمنی stage-58)
  mockFetch(() => jsonResponse({ IsSuccess: true, Amount: amount * 10 + 500 }))
  const vAmt = await adapter.verify({ gatewayRef: REFNUM, amount, query: {} })
  ok('verify: موفق + مبلغ ناهم‌خوان → indeterminate (نه fail قطعی)', !vAmt.success && vAmt.indeterminate === true)

  // IsSuccess=false → شکست قطعی از زبان خود بانک
  mockFetch(() => jsonResponse({ IsSuccess: false, ResultCode: 32 }))
  const vFail = await adapter.verify({ gatewayRef: REFNUM, amount, query: {} })
  ok('verify: IsSuccess=false → شکست قطعی (بدون indeterminate)', !vFail.success && !vFail.indeterminate)

  // شکل ناشناخته (IsSuccess غایب) → indeterminate
  mockFetch(() => jsonResponse({ Weird: 1 }))
  const vWeird = await adapter.verify({ gatewayRef: REFNUM, amount, query: {} })
  ok('verify: شکل ناشناخته → indeterminate', !vWeird.success && vWeird.indeterminate === true)

  // پاسخ HTML → indeterminate
  mockFetch(() => new Response('<html>err</html>', { status: 500, headers: { 'content-type': 'text/html' } }))
  const vHtml = await adapter.verify({ gatewayRef: REFNUM, amount, query: {} })
  ok('verify: پاسخ HTML شاپرک → indeterminate (نه کرش)', !vHtml.success && vHtml.indeterminate === true)

  // خطای شبکه → indeterminate + حفظ RefNum برای کارِ تایم‌اوت
  mockFetch(() => {
    throw new Error('network: ETIMEDOUT به شاپرک')
  })
  const vNet = await adapter.verify({ gatewayRef: REFNUM, amount, query: { RefNum: REFNUM } })
  ok(
    'verify: خطای شبکه → indeterminate و RefNum حفظ می‌شود',
    !vNet.success && vNet.indeterminate === true && vNet.gatewayRef === REFNUM,
  )

  // probe کارِ تایم‌اوت — کوئری خالی، هیچ مرجعی نیست
  const vProbe = await adapter.verify({ gatewayRef: null, amount, query: {} })
  ok('verify: probe تایم‌اوت (کوئری خالی) → indeterminate (رارد H6)', !vProbe.success && vProbe.indeterminate === true)

  // لغو — معادلِ NOK زرین‌پال: کوئری غیرخالی بدون RefNum
  const vCancel = await adapter.verify({
    gatewayRef: null,
    amount,
    query: { State: 'Canceled By User', ResNum: String(PAYMENT_ID), TraceNo: '778' },
  })
  ok(
    'verify: لغو (کوئری غیرخالی بدون RefNum) → شکست قطعیِ فوری — نه ۲۴h معلق',
    !vCancel.success && !vCancel.indeterminate,
  )

  // RefNum از کوئری وقتی مرجع ذخیره‌شده نیست (هر سه صورت حروف)
  for (const key of ['RefNum', 'refNum', 'refnum']) {
    mockFetch(() => jsonResponse({ IsSuccess: true, Amount: amount * 10 }))
    const vFromQuery = await adapter.verify({ gatewayRef: null, amount, query: { [key]: REFNUM } })
    ok(`verify: RefNum از کوئری (${key}) خوانده می‌شود`, vFromQuery.success && vFromQuery.gatewayRef === REFNUM)
  }

  // مرجع ذخیره‌شده مقدم بر کوئری — ضد جعل
  mockFetch(() => jsonResponse({ IsSuccess: true, Amount: amount * 10 }))
  await adapter.verify({ gatewayRef: REFNUM, amount, query: { RefNum: 'REF-FORGED' } })
  ok(
    'verify: مرجع ذخیره‌شده مقدم بر کوئری است (ضد-جعل)',
    (lastBody?.RefNum as string) === REFNUM,
  )

  // پارامترهای verify
  ok('verify: آدرس VerifyPayment شاپرک', lastUrl.includes('sep.shaparak.ir/api/v1/Payment/VerifyPayment'))
  ok('verify: TerminalId در بدنه', lastBody?.TerminalId === '12345678')

  console.log(`\n══ نتیجه: ${pass} ✓ / ${fail} ✗ ══\n`)
  if (fail > 0) process.exit(1)
}

void main()
