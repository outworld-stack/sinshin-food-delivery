// src/../scripts/test-auth-session.ts
/**
 * تست عمیق «نوسازی نشست با ددلاین سرتاسری + آزادسازیِ تضمینیِ
 * refreshPromise» (stage-74).
 *
 *   bun scripts/test-auth-session.ts   (از apps/web)
 *
 * باگِ گزارش کارفرما (یافته‌ی ۴ + علتِ «فریز نیم‌ساعته»): تایمرِ refresh
 * بعد از headers پاک می‌شد؛ res.json() بی‌مرز بود. refreshPromise بین
 * همه‌ی درخواست‌های احراز مشترک است ⇒ یک گیرکردن = کلِ پنل فریز؛
 * کاربر باید اپ را می‌بست و باز می‌کرد (ری‌ستِ state ماژول).
 *
 * ثابت می‌کند (با سرورِ واقعی Bun.serve + شبیه‌سازیِ window):
 *  R1) refresh سالم ⇒ true + توکن ذخیره می‌شود
 *  R2) headers می‌رسد ولی بدنه گیر می‌کند ⇒ false در مهلت (نه گرهِ ابدی)
 *      — دقیقاً باگِ کارفرما
 *  R3) fetch اصلاً resolve نمی‌شود (سیاه‌چاله) ⇒ false در مهلت
 *  R4) بعد از هر شکست، refreshPromise «آزاد» است ⇒ درخواست بعدی تازه
 *      می‌زند (هسته‌ی ضد-فریز) + promise مشترک بین دو فراخوانی هم‌زمان
 *  R5) 429/5xx ⇒ false «بدون خروج» (توکن قبلی دست‌نخورده)
 *  R6) 401 قطعی ⇒ خروج (توکن پاک) — تنها مسیر مجازِ خروج
 *  R7) watchdog: چرخه‌ای که «چ론» settle نشود ⇒ false در ۲×مهلت+۵s
 *      (آزادسازی تضمینی حتی با باگِ آینده)
 */

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

// ── شبیه‌سازی window (ماژول در مرورگر اجرا می‌شود) ──
// فقط قبل از import نصب می‌کنیم — boot-block ماژول (tryRefresh اولیه)
// با window تعریف‌شده اجرا می‌شود ولی به سرورِ ما می‌رود.

let route = '/ok' // مسیر رفتاریِ سرور برای /api/auth/refresh
let refreshHits = 0 // شمارش درخواست‌های واقعی به /api/auth/refresh

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const path = new URL(req.url).pathname
    if (path !== '/api/auth/refresh') return new Response('nf', { status: 404 })
    refreshHits++

    if (route === '/ok') {
      return Response.json({ accessToken: 'TOKEN-NEW-1' })
    }
    if (route === '/hang-body') {
      // headers فوری؛ بدنه هرگز
      const stream = new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('{"access'))
          // هرگز close
        },
      })
      return new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (route === '/hang-forever') {
      // حتی headers نمی‌رسد
      return new Promise<Response>(() => {
        /* برای همیشه معلق */
      })
    }
    if (route === '/429') {
      return new Response(JSON.stringify({ error: { message: 'too many' } }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (route === '/401') {
      return new Response(JSON.stringify({ error: { message: 'نشست مرده' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response('?', { status: 500 })
  },
})

// window/لوکیشن شبیه‌سازی — قبل از import ماژول
const origin = `http://localhost:${server.port}`
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { location: { origin } },
})

async function main(): Promise<void> {
  // مهاجرت import بعد از نصبِ window — بوتِ tryRefresh اولیه به /ok می‌رود
  route = '/ok'
  const mod = await import('../src/lib/auth-session')
  const { tryRefresh, getAccessToken, setAccessToken, clearAccessToken, _setRefreshTimeoutForTest } = mod
  await wait(80) // بوتِ اولیه settle شود

  _setRefreshTimeoutForTest(300) // مهلتِ هر تلاش = ۳۰۰ms
  const watchdogBudget = 300 * 2 + 5_000

  console.log('\n══ تست auth-session — ددلاین سرتاسری + آزادسازی تضمینی ══\n')

  // R1 — سالم
  route = '/ok'
  clearAccessToken()
  {
    const r = await tryRefresh()
    ok('R1: refresh سالم ⇒ true', r === true)
    ok('R1: توکن تازه ذخیره شد', getAccessToken() === 'TOKEN-NEW-1')
  }

  // R2 — باگ اصلی: headers می‌رسد، بدنه گیر می‌کند
  route = '/hang-body'
  clearAccessToken()
  {
    const t0 = Date.now()
    const r = await tryRefresh()
    const dt = Date.now() - t0
    ok(
      'R2: بدنه‌ی گیرکرده ⇒ false در مهلت (نه گرهِ ابدی) — باگِ فریز',
      r === false && dt < 2_000,
      `r=${r} dt=${dt}ms`,
    )
    ok('R2: توکن خالی ماند (شکست نرم)', getAccessToken() === null)
  }

  // R3 — سیاه‌چاله‌ی کامل
  route = '/hang-forever'
  {
    const t0 = Date.now()
    const r = await tryRefresh()
    const dt = Date.now() - t0
    ok('R3: fetch بی‌پاسخ ⇒ false در مهلت', r === false && dt < 2_000, `r=${r} dt=${dt}ms`)
  }

  // R4 — آزادسازی: promise مشترک + درخواست بعدی تازه
  route = '/hang-forever'
  {
    refreshHits = 0
    const p1 = tryRefresh()
    const p2 = tryRefresh()
    const [r1, r2] = await Promise.all([p1, p2])
    ok('R4: هر دو false (یک گیر، نه دو)', r1 === false && r2 === false)
    ok('R4: دو فراخوانی هم‌زمان ⇒ فقط یک درخواست به سرور (پیوند)', refreshHits === 1, `hits=${refreshHits}`)
    // حالا مسیر سالم — باید «تازه» resolve شود (نه promise قبلی)
    route = '/ok'
    const t0 = Date.now()
    const r3 = await tryRefresh()
    const dt = Date.now() - t0
    ok('R4: بعد از شکست، refresh بعدی تازه می‌زند (آزاد شد)', r3 === true && dt < 1_500, `r=${r3} dt=${dt}ms`)
  }

  // R5 — 429: false بدون خروج
  route = '/429'
  setAccessToken('TOKEN-BEFORE-429')
  {
    const r = await tryRefresh()
    ok('R5: 429 ⇒ false بدون خروج (توکن ماند)', r === false && getAccessToken() === 'TOKEN-BEFORE-429')
  }

  // R6 — 401 قطعی: خروج
  route = '/401'
  {
    const r = await tryRefresh()
    ok('R6: 401 قطعی ⇒ false + خروج (توکن پاک)', r === false && getAccessToken() === null)
  }

  // R7 — watchdog واقعی: fetch ای که حتی abort را هم نادیده می‌گیرد
  // (شبیه‌سازیِ «باگِ آینده» — چرخه‌ای که تایمرهای خودش را هم رد می‌کند).
  // فقط watchdog تضمین می‌کند refreshPromise در بودجه settle شود.
  {
    const realFetch = globalThis.fetch
    ;(globalThis as Record<string, unknown>).fetch = () =>
      new Promise<Response>(() => {
        /* هرگز settle؛ abort هم بی‌اثر — باگِ فرضی */
      })
    const t0 = Date.now()
    const r = await tryRefresh()
    const dt = Date.now() - t0
    ;(globalThis as Record<string, unknown>).fetch = realFetch
    ok(
      `R7: watchdog ⇒ false در بودجه (${watchdogBudget}ms) — آزادسازی تضمینی`,
      r === false && dt >= watchdogBudget - 150 && dt < watchdogBudget + 3_000,
      `r=${r} dt=${dt}ms budget=${watchdogBudget}ms`,
    )
    // بعد از watchdog هم آزاد است؟
    route = '/ok'
    const rAfter = await tryRefresh()
    ok('R7: بعد از watchdog، refresh بعدی تازه می‌زند (آزاد شد)', rAfter === true)
  }

  server.stop(true)
  console.log(`\n══ نتیجه: ${pass} ✓ / ${fail} ✗ ══\n`)
  if (fail > 0) process.exit(1)
}

void main()

export {}
