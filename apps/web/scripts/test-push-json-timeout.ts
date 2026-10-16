// src/../scripts/test-push-json-timeout.ts
/**
 * تست عمیق «مهلتِ خواندنِ بدنه» در مسیر پوش (stage-77 — PWA P2-1).
 *
 *   bun scripts/test-push-json-timeout.ts   (از apps/web)
 *
 * کلاسِ باگِ stage-74 (فریز نیم‌ساعته‌ی ادمین) در «آخرین» مسیرِ fetchِ
 * بی‌سقفِ بدنه: withTimeout فقط خودِ fetch (تا رسیدنِ headers) را می‌بست؛
 * res.json() بی‌مرز بود — سیاه‌چاله‌ی «headers آمد ولی بدنه هرگز» یعنی
 * enablePush/reconcile برای همیشه معلق و بنرِ PushAutoPrompt در فازِ busy
 * (دکمه‌ی رد پنهان) گیر می‌کند.
 *
 *  PJ1) بدنه‌ی گیرکرده (سرور واقعی: headers فوری، بدنه هرگز) ⇒
 *       readJsonWithTimeout در بودجه ⇒ fallback
 *  PJ2) JSON سالم ⇒ همان مقدار (بدون تاخیرِ نامطلوب)
 *  PJ3) JSON خراب (بدنه‌ی غیر-JSON) ⇒ fallback (نه throw)
 *  PJ4) مهلتِ بیشتر از زمانِ واقعیِ بدنه ⇒ مقدار درست می‌آید
 */
import { readJsonWithTimeout } from '../src/lib/push-subscription'

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
  // ── سرور آزمون: سه مسیر ──
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname
      if (path === '/black-hole') {
        // headers + «نصفِ» JSON فوری؛ بقیه هرگز — دقیقاً سیاه‌چاله‌ی
        // گزارش‌شده (headers آمد ولی بدنه ناتمام گیر کرد)
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"ok'))
              /* ادامه هرگز نمی‌آید */
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (path === '/slow-body') {
        // بدنه بعد از ۳۰۰ms کامل می‌شود
        const body = new ReadableStream({
          async start(controller) {
            await wait(300)
            controller.enqueue(new TextEncoder().encode('{"ok":true}'))
            controller.close()
          },
        })
        return new Response(body, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (path === '/bad-json') {
        return new Response('<<not-json>>', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } })
    },
  })
  const base = `http://localhost:${server.port}`

  // ── PJ1: بدنه‌ی گیرکرده ⇒ fallback در بودجه ──
  {
    const res = await fetch(`${base}/black-hole`)
    ok('PJ1 (پیش): headers رسید (status 200)', res.status === 200)
    const t0 = Date.now()
    const v = await readJsonWithTimeout<{ ok?: boolean }>(res, 400, { ok: false })
    const dt = Date.now() - t0
    ok('PJ1: بدنه‌ی گیرکرده ⇒ fallback (نه معلقِ ابدی)', v.ok === false, JSON.stringify(v))
    ok('PJ1: در بودجه برگشت (~۴۰۰ms)', dt >= 350 && dt < 1_500, `dt=${dt}ms`)
  }

  // ── PJ2: JSON سالم ──
  {
    const res = await fetch(`${base}/ok`)
    const v = await readJsonWithTimeout<{ ok?: boolean }>(res, 2_000, { ok: false })
    ok('PJ2: JSON سالم ⇒ مقدار واقعی', v.ok === true, JSON.stringify(v))
  }

  // ── PJ3: JSON خراب ⇒ fallback ──
  {
    const res = await fetch(`${base}/bad-json`)
    const v = await readJsonWithTimeout<{ ok?: boolean }>(res, 2_000, { ok: false })
    ok('PJ3: بدنه‌ی غیر-JSON ⇒ fallback (نه throw)', v.ok === false, JSON.stringify(v))
  }

  // ── PJ4: بدنه‌ی کندِ «داخلِ» بودجه ──
  {
    const res = await fetch(`${base}/slow-body`)
    const v = await readJsonWithTimeout<{ ok?: boolean }>(res, 2_000, { ok: false })
    ok('PJ4: بدنه‌ی ۳۰۰ms با بودجه‌ی ۲s ⇒ مقدار واقعی', v.ok === true, JSON.stringify(v))
  }

  server.stop(true)
  console.log(`\n══ نتیجه: ${pass} ✓ / ${fail} ✗ ══\n`)
  if (fail > 0) process.exit(1)
}

void main()
