//src/../scripts/test-mellat-verify.ts
/**
 * تست عمیق آداپتور ملت/به‌پرداخت (stage-76) — بدون شبکه‌ی واقعی: fetch سراسری
 * mock می‌شود و پاسخ‌های SOAP (مقدارِ <return>) شبیه‌سازی می‌شوند.
 *
 *   bun scripts/test-mellat-verify.ts   (از apps/api)
 *
 * پیش‌نیازِ mock-پذیری: stage-76 آداپتور را از Bun.fetch به fetch سراسری
 * آورد (همان درسِ stage-74 برای http-util) — تا این تست ممکن شود.
 *
 * سنجه — همان چک‌لیستِ زرین‌پال (stage-74):
 *   ۱) ResCode=17 امضا ندارد و به‌تنهایی عدم برداشت وجه را ثابت نمی‌کند.
 *   ۲) ضد-جعلِ پیوند: RefId فرم باید با توکنِ init یکی باشد.
 *   ۳) منبع حقیقت = bpVerifyRequest/bpSettleRequest سرور-به-سرور با
 *      کدهای رسمی: ۰/۴۳/۴۵ موفق، ۴۸ برگشت‌خورده (قطعی)، بقیه indeterminate.
 *   ۴) نامشخصِ پول‌ایمن: فالت/شبکه ⇒ indeterminate + مرجعِ ماندگار
 *      (orderId:s:SaleReferenceId) برگردانده می‌شود تا کارِ تایم‌اوت
 *      ری-وریفای کند.
 *   ۵) رگرسیون stage-58: bpPayRequest «X,0» ≠ موفق — فقط «0,X».
 *   ۶) پارامترها: مبلغ ×۱۰ ریال، تاریخ ۸رقمی و ساعت تهران ۶رقمی، گریز XML،
 *      پیشوندِ namespace در <return> (stage-76).
 */
import type { AppConfig } from '#/infra/config/env'
import { MellatAdapter } from '#/domain/payment/mellat.adapter'
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

/** آخرین پاکتِ SOAP فرستاده‌شده — برای ادعاهای پارامتری */
let lastEnvelope = ''
let lastOp = ''

/** پاسخِ SOAP با مقدارِ <return> — ns=true یعنی با پیشوند namespace (stage-76) */
const soapResponse = (value: string | null, ns = false): Response => {
  const body =
    value === null
      ? '<soapenv:Fault><faultcode>soapenv:Server</faultcode></soapenv:Fault>'
      : `<bpResponse xmlns="http://interfaces.core.sw.bps.com/"><${ns ? 'ns:' : ''}return>${value}</${ns ? 'ns:' : ''}return></bpResponse>`
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">' +
    `<soapenv:Body>${body}</soapenv:Body></soapenv:Envelope>`
  return new Response(xml, { status: 200, headers: { 'content-type': 'text/xml; charset=utf-8' } })
}

type Responder = () => Response | Promise<Response>

function mockFetch(responder: Responder): void {
  lastEnvelope = ''
  lastOp = ''
  ;(globalThis as Record<string, unknown>).fetch = async (
    _url: string | URL | Request,
    init?: RequestInit,
  ) => {
    lastEnvelope = String(init?.body ?? '')
    const m = /<ns:(\w+) xmlns:ns=/.exec(lastEnvelope)
    lastOp = m?.[1] ?? ''
    return responder()
  }
}

/** شبیه‌سازِ درون‌خطیِ درگاه — پشتِ هر فراخوانی، کدِ پاسخ را تعیین می‌کنیم */
let payResult: string | null = '0'
let verifyResult: string | null = '0'
let settleResult: string | null = '0'
let nsReturn = false
let throwNetwork = false

const wireRespond = (): Response => {
  if (throwNetwork) throw new Error('network: ECONNREFUSED به bpm.shaparak.ir')
  const value = lastOp === 'bpPayRequest' ? payResult : lastOp === 'bpVerifyRequest' ? verifyResult : settleResult
  return soapResponse(value, nsReturn)
}

const config = {
  gateway: {
    mellatTerminalId: '111222333',
    mellatUserName: 'shop&<>"\'user',
    mellatUserPassword: 'p@ss"w0rd',
    timeoutMs: 2_000,
  },
} as unknown as AppConfig

const adapter = new MellatAdapter(config)
const PAYMENT_ID = 'pay-000000000000002' as never // PaymentId برنددار
const amount = 200_000 // تومان

async function main(): Promise<void> {
  console.log('\n══ تست آداپتور ملت (به‌پرداخت) — SOAP ══\n')

  // ── init (bpPayRequest) ──
  console.log('── init (bpPayRequest) ──')

  mockFetch(wireRespond) // نصبِ mock — همه‌ی فراخوانی‌های ساب از اینجا می‌گذرند
  payResult = '0,REF123456'
  const initOk = await adapter.init({
    paymentId: PAYMENT_ID,
    displayId: 'ord-2',
    amount,
    callbackUrl: 'https://sinshin.example/api/payments/mellat/callback?state=st',
    description: 'سفارش ord-2',
    mobile: null,
  })
  ok('init موفق («0,REF123456») → paymentUrl استارت‌پی', initOk.paymentUrl.endsWith('/StartPay/REF123456'), initOk.paymentUrl)
  ok(
    'init موفق → gatewayRef کدگذاری‌شده «orderId:t:RefId»',
    /^(\d{1,15}):t:REF123456$/.test(initOk.gatewayRef ?? ''),
    String(initOk.gatewayRef),
  )

  payResult = '39,0' // رگرسیون stage-58 — ترتیبِ معکوس = شکست
  try {
    await adapter.init({ paymentId: PAYMENT_ID, displayId: 'ord-2', amount, callbackUrl: 'https://x/cb', description: 'd' })
    ok('init «39,0» (ترتیب معکوس) → conflict (رگرسیون stage-58)', false)
  } catch (e) {
    ok('init «39,0» (ترتیب معکوس) → conflict (رگرسیون stage-58)', e instanceof AppError && e.code === 'CONFLICT')
  }

  payResult = '21' // تک‌توکن = شکست
  try {
    await adapter.init({ paymentId: PAYMENT_ID, displayId: 'ord-2', amount, callbackUrl: 'https://x/cb', description: 'd' })
    ok('init تک‌توکن («21») → conflict', false)
  } catch (e) {
    ok('init تک‌توکن («21») → conflict', e instanceof AppError && e.code === 'CONFLICT')
  }

  payResult = null // فالت
  try {
    await adapter.init({ paymentId: PAYMENT_ID, displayId: 'ord-2', amount, callbackUrl: 'https://x/cb', description: 'd' })
    ok('init فالت ساب → conflict (نه کرش)', false)
  } catch (e) {
    ok('init فالت ساب → conflict (نه کرش)', e instanceof AppError && e.code === 'CONFLICT')
  }

  payResult = '0,REFX'
  mockFetch(wireRespond)
  await adapter.init({
    paymentId: PAYMENT_ID,
    displayId: 'ord-2',
    amount,
    callbackUrl: 'https://sinshin.example/cb',
    description: 'سفارش',
    mobile: null,
  })
  ok('init: مبلغ به ریال (×۱۰) در پاکت', lastEnvelope.includes(`>2000000</amount>`))
  ok('init: گریز XML در اعتبارنامه (&amp; &lt; &gt; &quot;)', lastEnvelope.includes('shop&amp;&lt;&gt;&quot;&#x27;user') || lastEnvelope.includes('shop&amp;&lt;&gt;&quot;&apos;user'))
  ok('init: Gregorian yyyyMMdd date and HHmmss Tehran time', /<localDate[^>]*>\d{8}</.test(lastEnvelope) && /<localTime[^>]*>\d{6}</.test(lastEnvelope))
  ok('init: orderId عددی ≤۱۵ رقم (هش پایدار)', /<orderId[^>]*>\d{1,15}</.test(lastEnvelope))

  // orderId پایدار برای همان paymentId
  const env1 = lastEnvelope.match(/<orderId[^>]*>(\d+)</)?.[1] ?? ''
  payResult = '0,REFY'
  await adapter.init({ paymentId: PAYMENT_ID, displayId: 'ord-2', amount, callbackUrl: 'https://x/cb', description: 'd' })
  const env2 = lastEnvelope.match(/<orderId[^>]*>(\d+)</)?.[1] ?? ''
  ok('init: orderId برای همان paymentId پایدار است', env1 !== '' && env1 === env2)

  // ── verify ──
  console.log('\n── verify (bpVerifyRequest + bpSettleRequest) ──')

  // gatewayRef واقعی از init (برای متصل‌بودنِ پیوند)
  // توجه: RefId ملت در واقعیت عددی است — رجکسِ آداپتور [A-Za-z0-9]+
  // است؛ داده‌ی تست هم باید واقع‌گرا باشد.
  payResult = '0,123456789'
  const initReal = await adapter.init({
    paymentId: PAYMENT_ID,
    displayId: 'ord-2',
    amount,
    callbackUrl: 'https://sinshin.example/cb',
    description: 'd',
    mobile: null,
  })
  const gwRef = initReal.gatewayRef ?? ''
  const storedRef = '123456789'
  const saleRef = '987654321012'

  // probe تایم‌اوت — kind=t بدون ResCode
  const vProbe = await adapter.verify({ gatewayRef: gwRef, amount, query: {} })
  ok('verify: probe تایم‌اوت (بدون ResCode) → indeterminate (رارد H6)', !vProbe.success && vProbe.indeterminate === true)

  // لغو — ResCode=17 (انصراف مشتری) — معادلِ NOK زرین‌پال
  const vCancel = await adapter.verify({ gatewayRef: gwRef, amount, query: { ResCode: '17', RefId: storedRef } })
  ok('unsigned ResCode=17 does not prove nonpayment', !vCancel.success && vCancel.indeterminate === true)

  // شکست اعلام‌شده‌ی بانک — هر ResCode≠0
  const vErr = await adapter.verify({ gatewayRef: gwRef, amount, query: { ResCode: '12', RefId: storedRef } })
  ok('unsigned ResCode=12 does not prove nonpayment', !vErr.success && vErr.indeterminate === true)

  // ضد-جعل — RefId فرم ≠ توکن init
  const vForge = await adapter.verify({
    gatewayRef: gwRef,
    amount,
    query: { ResCode: '0', RefId: '999888777', SaleReferenceId: saleRef },
  })
  ok('mismatched browser RefId cannot release money', !vForge.success && vForge.indeterminate === true)

  // ResCode=0 بدون SaleReferenceId → indeterminate (پاسخ ناقص)
  const vNoRef = await adapter.verify({ gatewayRef: gwRef, amount, query: { ResCode: '0', RefId: storedRef } })
  ok('verify: ResCode=0 بدون SaleReferenceId → indeterminate (ناقص)', !vNoRef.success && vNoRef.indeterminate === true)

  // A malformed reference needs reconciliation.
  const vGarbage = await adapter.verify({ gatewayRef: 'garbage-ref', amount, query: { ResCode: '0' } })
  ok('malformed persisted reference requires review', !vGarbage.success && vGarbage.indeterminate === true)

  // مسیر موفق کامل — verify 0 + settle 0
  verifyResult = '0'
  settleResult = '0'
  const vOk = await adapter.verify({
    gatewayRef: gwRef,
    amount,
    query: { ResCode: '0', RefId: storedRef, SaleReferenceId: saleRef },
  })
  ok('verify+settle: کد ۰/۰ → موفق', vOk.success)
  ok(
    'verify+settle: gatewayRef ماندگار «orderId:s:SaleReferenceId»',
    vOk.gatewayRef === gwRef.replace(':t:', ':s:').replace(storedRef, saleRef),
    String(vOk.gatewayRef),
  )
  ok('verify+settle: پارامترهای bpVerifyRequest — saleReferenceId', lastEnvelope.includes(`<saleReferenceId xsi:type="xsd:long">${saleRef}</saleReferenceId>`))

  // verify=43 (قبلاً وریفای شده) → عبور
  verifyResult = '43'
  settleResult = '0'
  const v43 = await adapter.verify({
    gatewayRef: gwRef,
    amount,
    query: { ResCode: '0', RefId: storedRef, SaleReferenceId: saleRef },
  })
  ok('verify+settle: ۴۳/۰ (قبلاً وریفای) → موفق', v43.success)

  // settle=45 (قبلاً تسویه شده) → موفق
  verifyResult = '0'
  settleResult = '45'
  const v45 = await adapter.verify({
    gatewayRef: gwRef,
    amount,
    query: { ResCode: '0', RefId: storedRef, SaleReferenceId: saleRef },
  })
  ok('verify+settle: ۰/۴۵ (قبلاً تسویه) → موفق', v45.success)

  verifyResult = '45'
  settleResult = 'FAULT'
  const vAlreadySettled = await adapter.verify({
    gatewayRef: gwRef,
    amount,
    query: { ResCode: '0', RefId: storedRef, SaleReferenceId: saleRef },
  })
  ok('verify=45 already settled succeeds without requiring another settle',
    vAlreadySettled.success && !vAlreadySettled.indeterminate && lastOp === 'bpVerifyRequest')

  // verify=48 (برگشت خورده) → قطعی
  verifyResult = '48'
  const v48 = await adapter.verify({
    gatewayRef: gwRef,
    amount,
    query: { ResCode: '0', RefId: storedRef, SaleReferenceId: saleRef },
  })
  ok('verify: ۴۸ (برگشت خورده) → شکست قطعی', !v48.success && !v48.indeterminate)

  // کد ناشناخته verify → indeterminate
  verifyResult = '25'
  settleResult = '0'
  const v25 = await adapter.verify({
    gatewayRef: gwRef,
    amount,
    query: { ResCode: '0', RefId: storedRef, SaleReferenceId: saleRef },
  })
  ok('verify: کد ناشناخته (۲۵) → indeterminate (پول در خطر نیست)', !v25.success && v25.indeterminate === true)

  // فالت در verify → indeterminate + مرجع ماندگار
  verifyResult = null
  const vFault = await adapter.verify({
    gatewayRef: gwRef,
    amount,
    query: { ResCode: '0', RefId: storedRef, SaleReferenceId: saleRef },
  })
  ok(
    'verify: فالت ساب → indeterminate و مرجع ماندگار برگردانده می‌شود',
    !vFault.success && vFault.indeterminate === true && vFault.gatewayRef === gwRef.replace(':t:', ':s:').replace(storedRef, saleRef),
  )

  // فالت در settle → indeterminate + مرجع ماندگار
  verifyResult = '0'
  settleResult = null
  const vSettleFault = await adapter.verify({
    gatewayRef: gwRef,
    amount,
    query: { ResCode: '0', RefId: storedRef, SaleReferenceId: saleRef },
  })
  ok(
    'settle: فالت → indeterminate و مرجع ماندگار',
    !vSettleFault.success && vSettleFault.indeterminate === true && vSettleFault.gatewayRef === gwRef.replace(':t:', ':s:').replace(storedRef, saleRef),
  )

  // خطای شبکه در bpCall → indeterminate
  verifyResult = '0'
  settleResult = '0'
  throwNetwork = true
  const vNet = await adapter.verify({
    gatewayRef: gwRef,
    amount,
    query: { ResCode: '0', RefId: storedRef, SaleReferenceId: saleRef },
  })
  ok('verify: خطای شبکه → indeterminate (نه کرش)', !vNet.success && vNet.indeterminate === true)
  throwNetwork = false

  // ری-وریفای از کارِ تایم‌اوت — kind=s مستقیم
  verifyResult = '43'
  settleResult = '45'
  const vRe = await adapter.verify({ gatewayRef: vOk.gatewayRef, amount, query: {} })
  ok('ری-وریفای (kind=s): ۴۳/۴۵ → موفق — مسیرِ کارِ تایم‌اوت', vRe.success)

  // حساسیت به حروف — فیلدهای کوچک‌شده
  verifyResult = '0'
  settleResult = '0'
  const vLower = await adapter.verify({
    gatewayRef: gwRef,
    amount,
    query: { rescode: '0', refid: storedRef, salereferenceid: saleRef },
  })
  ok('verify: فیلدهای کوچک‌شده (rescode/refid/salereferenceid) هم خوانده می‌شوند (stage-76)', vLower.success)

  // <return> با پیشوند namespace (stage-76)
  nsReturn = true
  const vNs = await adapter.verify({
    gatewayRef: gwRef,
    amount,
    query: { ResCode: '0', RefId: storedRef, SaleReferenceId: saleRef },
  })
  ok('verify: <ns:return> با پیشوند namespace هم پارس می‌شود (stage-76)', vNs.success)
  nsReturn = false

  console.log(`\n══ نتیجه: ${pass} ✓ / ${fail} ✗ ══\n`)
  if (fail > 0) process.exit(1)
}

void main()
