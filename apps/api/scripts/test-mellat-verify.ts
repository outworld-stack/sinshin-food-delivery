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
import type { GatewayVerifyInput } from '#/domain/payment/gateway.types'
import { MellatAdapter, MellatInitError } from '#/domain/payment/mellat.adapter'
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
let networkCalls = 0
let envelopes: string[] = []

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
  envelopes = []
  ;(globalThis as Record<string, unknown>).fetch = async (
    _url: string | URL | Request,
    init?: RequestInit,
  ) => {
    networkCalls++
    lastEnvelope = String(init?.body ?? '')
    envelopes.push(lastEnvelope)
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
const ALLOCATED_ORDER_ID = '281474976710656'
// Historical descriptor captured before allocated request IDs were introduced.
const LEGACY_ORDER_ID = '146601460370742'
const amount = 200_000 // تومان

async function main(): Promise<void> {
  console.log('\n══ تست آداپتور ملت (به‌پرداخت) — SOAP ══\n')

  // ── init (bpPayRequest) ──
  console.log('── init (bpPayRequest) ──')

  mockFetch(wireRespond) // نصبِ mock — همه‌ی فراخوانی‌های ساب از اینجا می‌گذرند
  payResult = '0,REF123456'
  const initOk = await adapter.init({
    paymentId: PAYMENT_ID,
    mellatOrderId: ALLOCATED_ORDER_ID,
    displayId: 'ord-2',
    amount,
    callbackUrl: 'https://sinshin.example/api/payments/mellat/callback?state=st',
    description: 'سفارش ord-2',
    mobile: null,
  })
  ok('init موفق («0,REF123456») → paymentUrl استارت‌پی', initOk.paymentUrl.endsWith('/StartPay/REF123456'), initOk.paymentUrl)
  ok(
    'init موفق → gatewayRef کدگذاری‌شده «orderId:t:RefId»',
    initOk.gatewayRef === `${ALLOCATED_ORDER_ID}:t:REF123456`,
    String(initOk.gatewayRef),
  )

  payResult = '39,0' // رگرسیون stage-58 — ترتیبِ معکوس = شکست
  try {
    await adapter.init({ paymentId: PAYMENT_ID, mellatOrderId: ALLOCATED_ORDER_ID, displayId: 'ord-2', amount, callbackUrl: 'https://x/cb', description: 'd' })
    ok('init «39,0» (ترتیب معکوس) → conflict (رگرسیون stage-58)', false)
  } catch (e) {
    ok('init «39,0» ambiguous rejection preserves financial review', e instanceof MellatInitError && e.code === 'CONFLICT' && e.indeterminate)
  }

  payResult = '21' // تک‌توکن = شکست
  try {
    await adapter.init({ paymentId: PAYMENT_ID, mellatOrderId: ALLOCATED_ORDER_ID, displayId: 'ord-2', amount, callbackUrl: 'https://x/cb', description: 'd' })
    ok('init تک‌توکن («21») → conflict', false)
  } catch (e) {
    ok('init code21 remains indeterminate without a terminality guarantee', e instanceof MellatInitError && e.code === 'CONFLICT' && e.indeterminate)
  }

  payResult = null // فالت
  try {
    await adapter.init({ paymentId: PAYMENT_ID, mellatOrderId: ALLOCATED_ORDER_ID, displayId: 'ord-2', amount, callbackUrl: 'https://x/cb', description: 'd' })
    ok('init فالت ساب → conflict (نه کرش)', false)
  } catch (e) {
    ok('init SOAP fault is typed and indeterminate', e instanceof MellatInitError && e.code === 'CONFLICT' && e.indeterminate)
  }

  payResult = '0,REFX'
  mockFetch(wireRespond)
  await adapter.init({
    paymentId: PAYMENT_ID,
    mellatOrderId: ALLOCATED_ORDER_ID,
    displayId: 'ord-2',
    amount,
    callbackUrl: 'https://sinshin.example/cb',
    description: 'سفارش',
    mobile: null,
  })
  ok('init: مبلغ به ریال (×۱۰) در پاکت', lastEnvelope.includes(`>2000000</amount>`))
  ok('init: گریز XML در اعتبارنامه (&amp; &lt; &gt; &quot;)', lastEnvelope.includes('shop&amp;&lt;&gt;&quot;&#x27;user') || lastEnvelope.includes('shop&amp;&lt;&gt;&quot;&apos;user'))
  ok('init: Gregorian yyyyMMdd date and HHmmss Tehran time', /<localDate[^>]*>\d{8}</.test(lastEnvelope) && /<localTime[^>]*>\d{6}</.test(lastEnvelope))
  ok('init sends the persisted allocated orderId instead of hashing paymentId', lastEnvelope.includes(`>${ALLOCATED_ORDER_ID}</orderId>`))

  // The numeric ID belongs to the allocated request; it is not derived from paymentId.
  const allocatedEnv1 = lastEnvelope.match(/<orderId[^>]*>(\d+)</)?.[1] ?? ''
  payResult = '0,REFY'
  await adapter.init({ paymentId: PAYMENT_ID, mellatOrderId: '281474976710657', displayId: 'ord-2', amount, callbackUrl: 'https://x/cb', description: 'd' })
  const env2 = lastEnvelope.match(/<orderId[^>]*>(\d+)</)?.[1] ?? ''
  ok('init uses distinct allocated IDs for the same internal payment UUID', allocatedEnv1 === ALLOCATED_ORDER_ID && env2 === '281474976710657')

  const baseInit = { paymentId: PAYMENT_ID, displayId: 'ord-2', amount, callbackUrl: 'https://x/cb', description: 'd' }
  for (const missing of ['mellatTerminalId', 'mellatUserName', 'mellatUserPassword'] as const) {
    const withoutCredential = new MellatAdapter({ ...config, gateway: { ...config.gateway, [missing]: undefined } } as unknown as AppConfig)
    const before = networkCalls
    try {
      await withoutCredential.init({ ...baseInit, mellatOrderId: ALLOCATED_ORDER_ID })
      ok(`missing ${missing} is a known preflight rejection`, false)
    } catch (error) {
      ok(`missing ${missing} is typed, definite and preserves its configuration error without network`,
        error instanceof MellatInitError && !error.indeterminate && error.code === 'CONFLICT' && error.status === 409 &&
        error.message === 'تنظیمات درگاه ملت کامل نیست (MELLAT_TERMINAL_ID / MELLAT_USERNAME / MELLAT_PASSWORD).' && networkCalls === before)
    }
  }
  for (const invalidAmount of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER]) {
    const before = networkCalls
    try {
      await adapter.init({ ...baseInit, mellatOrderId: ALLOCATED_ORDER_ID, amount: invalidAmount })
      ok(`invalid amount ${String(invalidAmount)} is a known preflight rejection`, false)
    } catch (error) {
      ok(`invalid amount ${String(invalidAmount)} preserves validation code/message and sends no bank request`,
        error instanceof MellatInitError && !error.indeterminate && error.code === 'VALIDATION_ERROR' && error.status === 422 &&
        error.message === 'مبلغ پرداخت باید عدد صحیح مثبت و در محدوده مجاز باشد.' && networkCalls === before)
    }
  }
  for (const invalid of [undefined, null, '', '0', '1', '281474976710655', '-281474976710656', '+281474976710656', '0281474976710656', '281474976710656 ', '2.81474976710656e14', '9223372036854775808', '99999999999999999999', 281474976710656]) {
    const before = networkCalls
    try {
      await adapter.init({ ...baseInit, mellatOrderId: invalid as never })
      ok(`init rejects invalid/unallocated numeric ID ${String(invalid)}`, false)
    } catch (error) {
      ok(`init rejects invalid/unallocated numeric ID ${String(invalid)} before network`,
        error instanceof MellatInitError && !error.indeterminate && networkCalls === before)
    }
  }
  for (const allocated of ['9007199254740993', '9223372036854775807']) {
    payResult = '0,PRECISEID'
    const precise = await adapter.init({ ...baseInit, mellatOrderId: allocated })
    ok(`init retains full precision for allocated ID ${allocated}`, precise.gatewayRef === `${allocated}:t:PRECISEID` && lastEnvelope.includes(`>${allocated}</orderId>`))
  }
  for (const [raw, indeterminate] of [['12', true], ['13', false], ['25', true], ['13,REFISSUED', true], ['0', true], ['0,BAD!TOKEN', true], ['unreadable', true]] as const) {
    payResult = raw
    try {
      await adapter.init({ ...baseInit, mellatOrderId: ALLOCATED_ORDER_ID })
      ok(`init ${raw} is classified safely`, false)
    } catch (error) {
      ok(`init ${raw} has indeterminate=${indeterminate}`, error instanceof MellatInitError && error.indeterminate === indeterminate)
    }
  }
  throwNetwork = true
  try {
    await adapter.init({ ...baseInit, mellatOrderId: ALLOCATED_ORDER_ID })
    ok('init network failure retains an unknown bank session', false)
  } catch (error) {
    ok('init network failure retains an unknown bank session', error instanceof MellatInitError && error.indeterminate)
  }
  throwNetwork = false
  mockFetch(() => { throw new DOMException('Bank initialization timed out', 'TimeoutError') })
  try {
    await adapter.init({ ...baseInit, mellatOrderId: ALLOCATED_ORDER_ID })
    ok('init timeout stays indeterminate', false)
  } catch (error) {
    ok('init timeout stays indeterminate', error instanceof MellatInitError && error.indeterminate)
  }
  mockFetch(() => new Response('<invalid-bank-response/>'))
  try {
    await adapter.init({ ...baseInit, mellatOrderId: ALLOCATED_ORDER_ID })
    ok('malformed init SOAP stays indeterminate', false)
  } catch (error) {
    ok('malformed init SOAP stays indeterminate', error instanceof MellatInitError && error.indeterminate)
  }
  mockFetch(wireRespond)

  // ── verify ──
  console.log('\n── verify (bpVerifyRequest + bpSettleRequest) ──')

  // gatewayRef واقعی از init (برای متصل‌بودنِ پیوند)
  // توجه: RefId ملت در واقعیت عددی است — رجکسِ آداپتور [A-Za-z0-9]+
  // است؛ داده‌ی تست هم باید واقع‌گرا باشد.
  payResult = '0,123456789'
  const initReal = await adapter.init({
    paymentId: PAYMENT_ID,
    mellatOrderId: ALLOCATED_ORDER_ID,
    displayId: 'ord-2',
    amount,
    callbackUrl: 'https://sinshin.example/cb',
    description: 'd',
    mobile: null,
  })
  const newGwRef = initReal.gatewayRef ?? ''
  const env1 = LEGACY_ORDER_ID
  const gwRef = `${LEGACY_ORDER_ID}:t:123456789`
  const storedRef = '123456789'
  const saleRef = '987654321012'
  const withoutVerifyCredential = new MellatAdapter({ ...config, gateway: { ...config.gateway, mellatUserPassword: undefined } } as unknown as AppConfig)
  const beforeVerifyConfigFailure = networkCalls
  try {
    await withoutVerifyCredential.verify({ paymentId: PAYMENT_ID, gatewayRef: gwRef, amount, query: { RefId: storedRef, SaleReferenceId: saleRef } })
    ok('verification configuration errors retain their existing classification', false)
  } catch (error) {
    ok('verification configuration errors retain their existing classification', error instanceof AppError && !(error instanceof MellatInitError) && error.code === 'CONFLICT' && networkCalls === beforeVerifyConfigFailure)
  }

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

  // Initial verification cannot authenticate a browser-supplied receipt on outage.
  verifyResult = null
  const vFault = await adapter.verify({
    gatewayRef: gwRef,
    amount,
    query: { ResCode: '0', RefId: storedRef, SaleReferenceId: saleRef },
  })
  ok(
    'initial verification outage preserves the authenticated initialization reference',
    !vFault.success && vFault.indeterminate === true && vFault.gatewayRef === gwRef,
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

  for (const code of ['17', '41', '42', '44', '46', '47', '49', '54', '55']) {
    verifyResult = code
    const unconfirmed = await adapter.verify({ paymentId: PAYMENT_ID, gatewayRef: gwRef, amount,
      query: { ResCode: '0', RefId: storedRef, SaleOrderId: env1, SaleReferenceId: saleRef } })
    ok(`verify=${code} cannot prove terminal nonpayment or promote an unbound receipt`,
      !unconfirmed.success && unconfirmed.indeterminate === true && unconfirmed.gatewayRef === gwRef)
  }

  // The browser cancellation flag cannot override verified and settled money.
  verifyResult = '0'; settleResult = '0'
  const canceledButPaid = await adapter.verify({ paymentId: PAYMENT_ID, gatewayRef: gwRef, amount,
    query: { ResCode: '17', RefId: storedRef, SaleOrderId: env1, SaleReferenceId: saleRef } })
  ok('unsigned ResCode=17 with server verify+settle success still settles', canceledButPaid.success)

  const poisonedReference = `${env1}:s:111111111`
  verifyResult = '44'
  const failedRecovery = await adapter.verify({ paymentId: PAYMENT_ID, gatewayRef: poisonedReference, amount,
    query: { ResCode: '0', RefId: storedRef, SaleOrderId: env1, SaleReferenceId: saleRef } })
  ok('a replacement unverified receipt cannot overwrite a saved receipt on a bank mismatch',
    failedRecovery.indeterminate === true && failedRecovery.gatewayRef === poisonedReference)
  verifyResult = '0'; settleResult = '0'
  const recovered = await adapter.verify({ paymentId: PAYMENT_ID, gatewayRef: poisonedReference, amount,
    query: { ResCode: '0', RefId: storedRef, SaleOrderId: env1, SaleReferenceId: saleRef } })
  ok('a later correctly bound callback recovers a historical unverified receipt',
    recovered.success && recovered.gatewayRef === `${env1}:s:${saleRef}`)
  const unboundRecovery = await adapter.verify({ paymentId: PAYMENT_ID, gatewayRef: poisonedReference, amount,
    query: { SaleReferenceId: saleRef } })
  ok('a changed receipt needs the matching sale order before re-verification',
    unboundRecovery.indeterminate === true && unboundRecovery.gatewayRef === poisonedReference)

  console.log('\n── allocated request IDs, existing references and lost init response ──')
  const legacyUrl = `https://bpm.shaparak.ir/StartPay/${storedRef}`
  ok('legacy resume retains its stored hash/token association', adapter.resumeUrl({ paymentId: PAYMENT_ID, gatewayRef: gwRef, paymentUrl: legacyUrl }) === legacyUrl)
  ok('legacy resume rejects another payment UUID', adapter.resumeUrl({ paymentId: 'another-payment' as never, gatewayRef: gwRef, paymentUrl: legacyUrl }) === null)
  ok('allocated resume uses the persisted request ID', adapter.resumeUrl({ paymentId: PAYMENT_ID, mellatOrderId: ALLOCATED_ORDER_ID, gatewayRef: newGwRef, paymentUrl: initReal.paymentUrl }) === legacyUrl)
  ok('allocated resume cannot fall back to the legacy hash when its ID is invalid', adapter.resumeUrl({ paymentId: PAYMENT_ID, mellatOrderId: 'invalid', gatewayRef: gwRef, paymentUrl: legacyUrl }) === null)
  ok('a lost init token cannot be resumed from only an allocated ID or a browser URL', adapter.resumeUrl({ paymentId: PAYMENT_ID, mellatOrderId: ALLOCATED_ORDER_ID, gatewayRef: null, paymentUrl: legacyUrl }) === null)
  ok('allocated resume rejects a mismatched persisted token', adapter.resumeUrl({ paymentId: PAYMENT_ID, mellatOrderId: ALLOCATED_ORDER_ID, gatewayRef: newGwRef, paymentUrl: 'https://bpm.shaparak.ir/StartPay/OTHERREF' }) === null)

  const highestOrderId = '9223372036854775807'
  const highestRef = `${highestOrderId}:t:${storedRef}`
  const precise = await adapter.verify({ paymentId: PAYMENT_ID, mellatOrderId: highestOrderId, gatewayRef: highestRef, amount,
    query: { SaleOrderId: highestOrderId, RefId: storedRef, SaleReferenceId: highestOrderId } })
  ok('19-digit allocated IDs and sale references verify/settle without losing precision', precise.success && precise.gatewayRef === `${highestOrderId}:s:${highestOrderId}` &&
    lastEnvelope.includes(`>${highestOrderId}</orderId>`) && lastEnvelope.includes(`>${highestOrderId}</saleOrderId>`) && lastEnvelope.includes(`>${highestOrderId}</saleReferenceId>`))
  ok('full signed-long allocated ID can resume its own persisted token', adapter.resumeUrl({ paymentId: PAYMENT_ID, mellatOrderId: highestOrderId, gatewayRef: highestRef, paymentUrl: legacyUrl }) === legacyUrl)
  const allocatedSettled = await adapter.verify({ paymentId: PAYMENT_ID, mellatOrderId: highestOrderId, gatewayRef: precise.gatewayRef, amount, query: {} })
  ok('allocated permanent receipt remains re-verifiable without a callback', allocatedSettled.success && allocatedSettled.gatewayRef === precise.gatewayRef)

  for (const invalid of ['', '0', '-1', '+281474976710656', '0281474976710656', '9223372036854775808']) {
    const before = networkCalls
    const verdict = await adapter.verify({ paymentId: PAYMENT_ID, mellatOrderId: invalid, gatewayRef: gwRef, amount,
      query: { SaleOrderId: LEGACY_ORDER_ID, RefId: storedRef, SaleReferenceId: saleRef } })
    ok(`invalid trusted ID ${invalid} never falls back to a valid legacy association`, !verdict.success && verdict.indeterminate === true && verdict.gatewayRef === gwRef && networkCalls === before)
  }
  const associationCases: Array<Pick<GatewayVerifyInput, 'gatewayRef' | 'mellatOrderId' | 'query'>> = [
    { gatewayRef: `${highestOrderId}:t:${storedRef}`, mellatOrderId: ALLOCATED_ORDER_ID, query: { SaleOrderId: highestOrderId, SaleReferenceId: saleRef } },
    { gatewayRef: newGwRef, mellatOrderId: ALLOCATED_ORDER_ID, query: { SaleOrderId: highestOrderId, SaleReferenceId: saleRef } },
    { gatewayRef: null, mellatOrderId: ALLOCATED_ORDER_ID, query: { SaleOrderId: highestOrderId, SaleReferenceId: saleRef } },
    { gatewayRef: null, mellatOrderId: undefined, query: { SaleOrderId: ALLOCATED_ORDER_ID, SaleReferenceId: saleRef } },
    { gatewayRef: null, mellatOrderId: undefined, query: { SaleOrderId: LEGACY_ORDER_ID, SaleReferenceId: saleRef } },
    { gatewayRef: null, mellatOrderId: ALLOCATED_ORDER_ID, query: {} },
    { gatewayRef: 'malformed', mellatOrderId: ALLOCATED_ORDER_ID, query: { SaleReferenceId: saleRef } },
  ]
  for (const candidate of associationCases) {
    const before = networkCalls
    const verdict = await adapter.verify({ paymentId: PAYMENT_ID, amount, ...candidate })
    ok(`missing/mismatched association ${JSON.stringify(candidate)} preserves review without a bank call`,
      !verdict.success && verdict.indeterminate === true && verdict.gatewayRef === candidate.gatewayRef && networkCalls === before)
  }

  for (const callbackOrderId of [ALLOCATED_ORDER_ID, undefined]) {
    const before = envelopes.length
    const verdict = await adapter.verify({ paymentId: PAYMENT_ID, mellatOrderId: ALLOCATED_ORDER_ID, gatewayRef: null, amount,
      query: { ...(callbackOrderId === undefined ? {} : { SaleOrderId: callbackOrderId }), RefId: 'UNSAVEDTOKEN', SaleReferenceId: saleRef } })
    ok(`lost init response is recoverable using only the trusted ID and bank verification (callback order ${String(callbackOrderId)})`,
      verdict.success && verdict.gatewayRef === `${ALLOCATED_ORDER_ID}:s:${saleRef}` && envelopes.slice(before).length === 2 &&
      envelopes.slice(before).every(envelope => envelope.includes(`>${ALLOCATED_ORDER_ID}</orderId>`) && envelope.includes(`>${ALLOCATED_ORDER_ID}</saleOrderId>`)))
  }
  for (const reference of ['0', '-1', '01', '9223372036854775808', 'not-a-receipt']) {
    const before = networkCalls
    const verdict = await adapter.verify({ paymentId: PAYMENT_ID, mellatOrderId: ALLOCATED_ORDER_ID, gatewayRef: null, amount,
      query: { SaleOrderId: ALLOCATED_ORDER_ID, SaleReferenceId: reference } })
    ok(`invalid late receipt ${reference} preserves the unknown result without a bank call`, !verdict.success && verdict.indeterminate === true && verdict.gatewayRef === null && networkCalls === before)
  }
  for (const bankResult of ['44', '13', null]) {
    verifyResult = bankResult
    const verdict = await adapter.verify({ paymentId: PAYMENT_ID, mellatOrderId: ALLOCATED_ORDER_ID, gatewayRef: null, amount,
      query: { SaleOrderId: ALLOCATED_ORDER_ID, SaleReferenceId: saleRef } })
    ok(`late receipt bank result ${String(bankResult)} cannot promote an unverified receipt or prove nonpayment`,
      !verdict.success && verdict.indeterminate === true && verdict.gatewayRef === null)
  }
  verifyResult = '0'; settleResult = null
  const lateSettleOutage = await adapter.verify({ paymentId: PAYMENT_ID, mellatOrderId: ALLOCATED_ORDER_ID, gatewayRef: null, amount,
    query: { SaleOrderId: ALLOCATED_ORDER_ID, SaleReferenceId: saleRef } })
  ok('late verify success followed by settlement outage saves the bank-authenticated receipt',
    !lateSettleOutage.success && lateSettleOutage.indeterminate === true && lateSettleOutage.gatewayRef === `${ALLOCATED_ORDER_ID}:s:${saleRef}`)
  verifyResult = '48'; settleResult = '0'
  const lateReversed = await adapter.verify({ paymentId: PAYMENT_ID, mellatOrderId: ALLOCATED_ORDER_ID, gatewayRef: null, amount,
    query: { SaleOrderId: ALLOCATED_ORDER_ID, SaleReferenceId: saleRef } })
  ok('late bank-proven reversal remains terminal under the trusted original association', !lateReversed.success && !lateReversed.indeterminate && lateReversed.gatewayRef === `${ALLOCATED_ORDER_ID}:s:${saleRef}`)

  console.log(`\n══ نتیجه: ${pass} ✓ / ${fail} ✗ ══\n`)
  if (fail > 0) process.exit(1)
}

void main()
