// src/../scripts/test-fetch-timeout.ts
/**
 * تست عمیق «سقفِ زمانیِ fetch تا پایانِ خواندن بدنه» (stage-74).
 *
 *   bun scripts/test-fetch-timeout.ts   (از apps/web)
 *
 * باگِ گزارش کارفرما (یافته‌ی ۳): تایمرِ مهلت بلافاصله بعد از «رسیدنِ
 * headers» پاک می‌شد؛ خواندنِ بدنه بی‌مرز می‌ماند — سروری که headers را
 * بفرستد و بدنه را برای همیشه نگه دارد، درخواست را «برای همیشه معلق»
 * می‌کرد (نصفِ ریشه‌ی فریز PWA).
 *
 * این تست با سرورِ واقعی (Bun.serve) چهار حالت را ثابت می‌کند:
 *  T1) headers فوری + بدنه‌ی گیرکرده ⇒ fetchWithTimeout در مهلت reject
 *      می‌شود (TimeoutError) — نه معلقِ ابدی
 *  T2) سرور سالم ⇒ resolve عادی؛ عددِ درست
 *  T3) سیگنالِ بیرونی (SSR abort) وسطِ خواندنِ بدنه ⇒ reject با reason
 *  T4) بدنه‌ی کند ولی داخلِ مهلت ⇒ resolve (مهلت عادلانه است)
 *  T5) آبجکتِ Response هنوز Response است (treaty/Eden سالم)
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

async function main(): Promise<void> {
  const { fetchWithTimeout } = await import('../src/lib/api-fetch')

  // ── سرورهای آزمون ──
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname

      if (path === '/hang-body') {
        // headers فوری؛ بدنه هرگز کامل نمی‌شود
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"partial":'))
            // هرگز close نمی‌شود — گیرِ ابدی
          },
        })
        return new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } })
      }

      if (path === '/slow-body') {
        // بدنه‌ی کند ولی داخل مهلتِ ۱.۲s
        const stream = new ReadableStream({
          async start(controller) {
            const enc = new TextEncoder()
            controller.enqueue(enc.encode('{"n":'))
            await wait(150)
            controller.enqueue(enc.encode('42}'))
            controller.close()
          },
        })
        return new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } })
      }

      if (path === '/ok') {
        return Response.json({ hello: 'world' })
      }

      return new Response('not found', { status: 404 })
    },
  })
  const base = `http://localhost:${server.port}`

  console.log('\n══ تست fetchWithTimeout — سقف تا پایانِ خواندن بدنه ══\n')

  // T1 — باگ اصلی: headers می‌رسد، بدنه گیر می‌کند
  {
    const t0 = Date.now()
    let rejected = false
    let errMsg = ''
    try {
      const res = await fetchWithTimeout(`${base}/hang-body`, {}, { timeoutMs: 400 })
      // اگر fetch resolve شد، بدنه باید تحتِ همان مهلت reject شود:
      await res.text()
    } catch (e) {
      rejected = true
      errMsg = (e as Error).name + ': ' + String((e as Error).message).slice(0, 40)
    }
    const dt = Date.now() - t0
    ok(
      'T1: بدنه‌ی گیرکرده ⇒ reject در مهلت (نه معلقِ ابدی)',
      rejected && dt < 1_500,
      `rejected=${rejected} dt=${dt}ms err=${errMsg}`,
    )
  }

  // T2 — سرور سالم
  {
    let val = ''
    try {
      const res = await fetchWithTimeout(`${base}/ok`, {}, { timeoutMs: 800 })
      val = String((await res.json() as { hello: string }).hello)
    } catch {
      val = 'THREW'
    }
    ok('T2: سرور سالم ⇒ resolve + بدنه‌ی درست', val === 'world', `val=${val}`)
  }

  // T3 — سیگنال بیرونی (SSR) وسطِ خواندنِ بدنه
  {
    const external = new AbortController()
    let rejected = false
    let reason = ''
    try {
      const res = await fetchWithTimeout(`${base}/hang-body`, {
        signal: external.signal,
      }, { timeoutMs: 5_000 })
      const p = res.text()
      await wait(120)
      external.abort(new Error('SSR deadline'))
      await p
    } catch (e) {
      rejected = true
      reason = String((e as Error).message).slice(0, 30)
    }
    ok(
      'T3: abort بیرونی وسطِ بدنه ⇒ reject (زنجیره‌ی سیگنال سالم)',
      rejected && reason.includes('SSR'),
      `rejected=${rejected} reason=${reason}`,
    )
  }

  // T4 — بدنه‌ی کند ولی داخلِ مهلت ⇒ نباید اشتباهی قطع شود
  {
    let val = -1
    try {
      const res = await fetchWithTimeout(`${base}/slow-body`, {}, { timeoutMs: 1_200 })
      val = (await res.json() as { n: number }).n
    } catch {
      val = -1
    }
    ok('T4: بدنه‌ی کندِ داخلِ مهلت ⇒ resolve (مهلت عادلانه)', val === 42, `val=${val}`)
  }

  // T5 — همچنان Response واقعی (برای Eden treaty)
  {
    let isResponse = false
    let status = 0
    try {
      const res = await fetchWithTimeout(`${base}/ok`, {}, { timeoutMs: 800 })
      isResponse = res instanceof Response
      status = res.status
      await res.json()
    } catch {
      /* T2 پوشش می‌دهد */
    }
    ok('T5: خروجی همچنان instanceof Response (treaty سالم)', isResponse && status === 200)
  }

  server.stop(true)
  console.log(`\n══ نتیجه: ${pass} ✓ / ${fail} ✗ ══\n`)
  if (fail > 0) process.exit(1)
}

void main()

export {}
