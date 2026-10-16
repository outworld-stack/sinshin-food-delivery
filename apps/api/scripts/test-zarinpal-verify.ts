//src/../scripts/test-zarinpal-verify.ts
/**
 * تست عمیق آداپتور زرین‌پال (stage-74) — بدون شبکه‌ی واقعی: fetch سراسری
 * mock می‌شود و «همه‌ی شکل‌های پاسخ v4» شبیه‌سازی می‌شوند.
 *
 *   bun scripts/test-zarinpal-verify.ts   (از apps/api)
 *
 * ریشه‌ی باگِ گزارش کارفرما: زرین‌پال برای «پرداخت لغوشده» (Status=NOK در
 * callback) در Verify پاسخی برمی‌گرداند که کدش غالباً در آرایه/شیءِ errors
 * می‌آید نه data.code — آداپتور قبلاً فقط data.code می‌خواند ⇒ undefined ⇒
 * indeterminate ⇒ سفارش تا ۲۴ ساعت در PENDING_PAYMENT می‌ماند و مبلغش در
 * «مجموع پرداخت‌ها» می‌نشست. این تست هر شکل را ثابت می‌کند:
 *
 *  موفق:    data.code=100 / data.code=101
 *  قطعی-ناموفق (حالا از هر دو شکل): data.code یا errors[].code در {-9,-10,-11}
 *    • آرایه‌ای:  {"data":{},"errors":[{"code":-11,"message":"…"}]}
 *    • شیئی:     {"data":{},"errors":{"code":-11}}
 *  نامشخص:   کد ناشناخته / data خالی / پاسخ غیر-JSON (null)
 *  جعل‌گریزی: Status=NOK + verify=100 → موفق (پاسخ سرور-به-سرور مقدم است)
 *  پارامترها: مبلغ ریالی (×10)، authority از gatewayRef مقدم بر query
 */
import type { AppConfig } from '#/infra/config/env'
import { ZarinpalAdapter } from '#/domain/payment/zarinpal.adapter'

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

/** آخرین درخواستی که آداپتور فرستاد — برای ادعاهای پارامتری */
let lastBody: Record<string, unknown> | null = null
let lastUrl = ''

type Responder = () => Response | Promise<Response>

function mockFetch(responder: Responder): void {
  lastBody = null
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
  gateway: { zarinpalSandbox: true, zarinpalMerchantId: 'test-merchant', timeoutMs: 2_000 },
} as unknown as AppConfig

const adapter = new ZarinpalAdapter(config)
const AUTH = 'A0000000000000000000000000000'
const amount = 150_000 // تومان

async function main(): Promise<void> {
  console.log('\n══ تست آداپتور زرین‌پال — شکل‌های پاسخ Verify ══\n')

  // ── موفق ──
  mockFetch(() => jsonResponse({ data: { code: 100 } }))
  ok('data.code=100 → success', (await adapter.verify({ gatewayRef: AUTH, amount, query: {} })).success)

  mockFetch(() => jsonResponse({ data: { code: 101 } }))
  ok('data.code=101 → success (قبلاً تاییدشده)', (await adapter.verify({ gatewayRef: AUTH, amount, query: {} })).success)

  // ── قطعی-ناموفق — شکلِ data.code (از قبل کار می‌کرد) ──
  mockFetch(() => jsonResponse({ data: { code: -11 } }))
  const r11 = await adapter.verify({ gatewayRef: AUTH, amount, query: {} })
  ok('data.code=-11 → FAILED قطعی (بدون indeterminate)', !r11.success && !r11.indeterminate)

  // ── قطعی-ناموفق — شکلِ errors آرایه‌ای (باگِ اصلی stage-74) ──
  mockFetch(() => jsonResponse({ data: {}, errors: [{ code: -11, message: 'Transaction not found' }] }))
  const rArr11 = await adapter.verify({ gatewayRef: AUTH, amount, query: {} })
  ok(
    'errors[0].code=-11 (آرایه) → FAILED قطعی — باگ اصلی رفع شد',
    !rArr11.success && !rArr11.indeterminate,
    JSON.stringify(rArr11),
  )

  mockFetch(() => jsonResponse({ data: {}, errors: [{ code: -9, message: 'amount mismatch' }] }))
  const rArr9 = await adapter.verify({ gatewayRef: AUTH, amount, query: {} })
  ok('errors[0].code=-9 (آرایه) → FAILED قطعی', !rArr9.success && !rArr9.indeterminate)

  mockFetch(() => jsonResponse({ data: {}, errors: [{ code: -10, message: 'merchant' }] }))
  const rArr10 = await adapter.verify({ gatewayRef: AUTH, amount, query: {} })
  ok('errors[0].code=-10 (آرایه) → FAILED قطعی', !rArr10.success && !rArr10.indeterminate)

  // ── قطعی-ناموفق — شکلِ errors شیئی ──
  mockFetch(() => jsonResponse({ data: {}, errors: { code: -11, message: 'not found' } }))
  const rObj11 = await adapter.verify({ gatewayRef: AUTH, amount, query: {} })
  ok(
    'errors.code=-11 (شیء) → FAILED قطعی',
    !rObj11.success && !rObj11.indeterminate,
    JSON.stringify(rObj11),
  )

  // ── نامشخص — دست‌نخورده (قانون پول) ──
  mockFetch(() => jsonResponse({ data: { code: -50 } }))
  const r50 = await adapter.verify({ gatewayRef: AUTH, amount, query: {} })
  ok('data.code=-50 (ناشناخته) → indeterminate (پول در خطر نیست)', !r50.success && r50.indeterminate === true)

  mockFetch(() => jsonResponse({ data: {} }))
  const rEmpty = await adapter.verify({ gatewayRef: AUTH, amount, query: {} })
  ok('data خالی بدون errors → indeterminate', !rEmpty.success && rEmpty.indeterminate === true)

  mockFetch(() => new Response('<html>شاپرک خطا</html>', { status: 502, headers: { 'content-type': 'text/html' } }))
  const rHtml = await adapter.verify({ gatewayRef: AUTH, amount, query: {} })
  ok('پاسخ HTML شاپرک → indeterminate (نه کرش)', !rHtml.success && rHtml.indeterminate === true)

  // ── جعل‌گریزی: Status=NOK جعلی نمی‌تواند پرداختِ واقعی را بشکند ──
  mockFetch(() => jsonResponse({ data: { code: 100 } }))
  const rFakeNok = await adapter.verify({
    gatewayRef: AUTH,
    amount,
    query: { Status: 'NOK', authority: 'X' },
  })
  ok(
    'Status=NOK + verify=100 → موفق (پاسخ Verify مقدم — ضد جعل)',
    rFakeNok.success,
  )

  mockFetch(() => jsonResponse({ data: {}, errors: [{ code: -11 }] }))
  const rRealNok = await adapter.verify({
    gatewayRef: AUTH,
    amount,
    query: { Status: 'NOK' },
  })
  ok(
    'Status=NOK + verify=-11 (errors) → FAILED قطعی (لغوی واقعی)',
    !rRealNok.success && !rRealNok.indeterminate,
  )

  // ── پارامترها ──
  mockFetch(() => jsonResponse({ data: { code: 100 } }))
  await adapter.verify({ gatewayRef: AUTH, amount, query: { authority: 'FROM_QUERY' } })
  ok(
    'authority از gatewayRef مقدم بر query است',
    (lastBody?.authority as string) === AUTH,
  )
  ok(
    'مبلغ به ریال (×10) فرستاده می‌شود',
    (lastBody?.amount as number) === amount * 10,
  )
  ok(
    'آدرس سندباکس v4 verify',
    lastUrl.includes('sandbox.zarinpal.com/pg/v4/payment/verify.json'),
  )

  // ── status کوچک (بعضی درگاه‌ها) ──
  mockFetch(() => jsonResponse({ data: { code: 100 } }))
  const rLower = await adapter.verify({ gatewayRef: AUTH, amount, query: { status: 'nok' } })
  ok('پارامتر status با حرف کوچک هم خوانده می‌شود (لاگ)', rLower.success)

  console.log(`\n══ نتیجه: ${pass} ✓ / ${fail} ✗ ══\n`)
  if (fail > 0) process.exit(1)
}

void main()
