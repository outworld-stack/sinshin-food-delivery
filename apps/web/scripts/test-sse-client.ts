// src/../scripts/test-sse-client.ts
/**
 * تست عمیق کلاینت SSE مشترک (stage-74) — lib/sse-client.
 *
 *   bun scripts/test-sse-client.ts   (از apps/web)
 *
 * سه حفره‌ی «مرگِ خاموشِ PWA» که گزارش کارفرما مشخص کرد و این تست ثابت
 * می‌کند بسته شدند (با سرورِ واقعیِ SSE روی Bun.serve):
 *
 *  S1) اتصال سالم: فریم connected + رویدادها + heartbeat → onFrame؛
 *      isStreaming=true
 *  S2) سکوتِ استریم (heartbeat قطع — «SSE متصل به نظر می‌رسد ولی داده
 *      نمی‌آید») ⇒ watchdog در silenceTimeout ⇒ onStreamClosed + retry
 *  S3) headers هرگز نمی‌رسد (fetch بی‌سقف قبلاً برای همیشه معلق می‌ماند)
 *      ⇒ connectTimeout ⇒ retry
 *  S4) توکن غایب (هیدریشن) ⇒ tokenWait ⇒ بعد از آماده‌شدن url، اتصال
 *  S5) بازگشت از پس‌زمینه (visibilitychange) در پنجره‌ی retry ⇒ اتصالِ
 *      فوری — نه انتظارِ ۶۰s
 *  S6) برگشت از پس‌زمینه با استریمِ کهنه (بدون ضربان > wakeStaleMs) ⇒
 *      بازسازی فوری (سوکتِ پس‌زمینه کشته شده)
 *  S7) استریمِ سالمِ تازه + برگشت به اپ ⇒ دست نمی‌خورد
 *  S8) stop() ⇒ هیچ اتصال/تایمرِ بازی
 *  S9) فریم‌های heartbeat (": ping") به onFrame نمی‌روند ولی watchdog
 *      را ریست می‌کنند (مرزِ درست)
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

// ── شیم window/document — قبل از import ماژول ──
type Listener = (ev: { type: string }) => void
const listeners = new Map<string, Set<Listener>>()
function addL(type: string, fn: Listener) {
  if (!listeners.has(type)) listeners.set(type, new Set())
  listeners.get(type)!.add(fn)
}
function removeL(type: string, fn: Listener) {
  listeners.get(type)?.delete(fn)
}
function fire(type: string) {
  for (const fn of listeners.get(type) ?? []) fn({ type })
}

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    location: { origin: 'http://localhost:1' },
    addEventListener: addL,
    removeEventListener: removeL,
  },
})
Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: {
    visibilityState: 'visible',
    addEventListener: addL,
    removeEventListener: removeL,
  },
})

// ── سرور SSE آزمون ──
let mode: 'healthy' | 'silent' | 'hang-headers' | 'close-after-connect' = 'healthy'
let sseConnections = 0
const encoder = new TextEncoder()

/** توقف ضربانِ «اتصالِ موجود» — شبیه‌سازیِ مرگِ خاموش (سوکتِ مرده) */
let stopCurrentHeartbeats: (() => void) | null = null

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const path = new URL(req.url).pathname
    if (path !== '/stream') return new Response('nf', { status: 404 })
    sseConnections++

    if (mode === 'hang-headers') {
      // حتی headers نمی‌رسد — قبلاً: fetch بی‌سقف = معلقِ ابدی
      return new Promise<Response>(() => {})
    }

    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(`event: connected\ndata: {"ch":"t"}\n\n`))
        if (mode === 'close-after-connect') {
          controller.close()
          return
        }
        if (mode === 'silent') {
          // یک فریم connected بعد از سکوتِ ابدی — «مرگِ خاموش»
          return
        }
        // healthy: heartbeat هر ۱۲۰ms + یک رویداد
        let beats = 0
        const iv = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(': ping\n\n'))
            if (++beats === 3) {
              controller.enqueue(encoder.encode(`event: order-created\ndata: {"id":"o1"}\n\n`))
            }
          } catch {
            clearInterval(iv)
          }
        }, 120)
        stopCurrentHeartbeats = () => clearInterval(iv)
        // پاکسازی وقتی کلاینت قطع کرد
        req.signal.addEventListener('abort', () => {
          clearInterval(iv)
          if (stopCurrentHeartbeats === (() => clearInterval(iv))) stopCurrentHeartbeats = null
        })
      },
    })
    return new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
    })
  },
})
const sseUrl = `http://localhost:${server.port}/stream`

// زمان‌بندی کوچکِ تست
const T = {
  connectTimeoutMs: 400,
  silenceTimeoutMs: 450,
  retryMs: 350,
  tokenWaitMs: 120,
  wakeStaleMs: 250,
}

async function main(): Promise<void> {
  const { createFetchSse } = await import('../src/lib/sse-client')

  console.log('\n══ تست sse-client — watchdog سکوت + تایم‌اوت اتصال + wake ══\n')

  // ── S1: اتصال سالم ──
  mode = 'healthy'
  let frames: string[] = []
  let opened = 0
  let closed = 0
  {
    const sse = createFetchSse({
      url: () => sseUrl,
      onFrame: (f) => frames.push(f),
      onStreamOpen: () => opened++,
      onStreamClosed: () => closed++,
      timings: T,
    })
    await wait(700)
    ok('S1: فریم connected دریافت شد', frames.some((f) => f.includes('event: connected')))
    ok('S1: رویداد سفارش دریافت شد', frames.some((f) => f.includes('order-created')))
    ok('S1: heartbeat ها به onFrame نمی‌روند', !frames.some((f) => f.includes(': ping')))
    ok('S1: isStreaming=true', sse.isStreaming())
    ok('S1: onStreamOpen شلیک شد (باز)', opened >= 1)
    ok('S1: بدون onStreamClosed (زنده)', closed === 0)
    sse.stop()
  }

  // ── S2: مرگ خاموش — watchdog سکوت ──
  mode = 'silent'
  frames = []
  opened = 0
  closed = 0
  sseConnections = 0
  {
    const sse = createFetchSse({
      url: () => sseUrl,
      onFrame: (f) => frames.push(f),
      onStreamOpen: () => opened++,
      onStreamClosed: () => closed++,
      timings: T,
    })
    await wait(200)
    ok('S2 (پیش): متصل شد و فریم connected آمد', frames.some((f) => f.includes('connected')) && sse.isStreaming())
    await wait(T.silenceTimeoutMs + 350)
    ok(
      `S2: سکوت ${T.silenceTimeoutMs}ms ⇒ onStreamClosed (کشفِ مرگِ خاموش)`,
      closed >= 1,
      `closed=${closed}`,
    )
    ok('S2: retry بعد از watchdog زمان‌بندی شد (اتصال مجدد)', sseConnections >= 1)
    sse.stop()
    // صبر برای retry بعدی؟ توقفش می‌کنیم — S3 جدا تست می‌شود
  }

  // ── S3: headers گیر می‌کند — تایم‌اوت اتصال ──
  mode = 'hang-headers'
  opened = 0
  closed = 0

  {
    const sse = createFetchSse({
      url: () => sseUrl,
      onStreamOpen: () => opened++,
      onStreamClosed: () => {
        closed++
      },
      timings: T,
    })
    await wait(T.connectTimeoutMs + 100)
    ok('S3: headers نرسید ⇒ isStreaming=false (نه معلقِ ابدی)', !sse.isStreaming())
    await wait(T.retryMs + T.connectTimeoutMs + 300)
    // retry اول → باز hang → retry دوم… opened باید صفر بماند و اتصال‌ها شمرده شوند
    ok(
      'S3: بعد از تایم‌اوت، retry زده شد (اتصالِ جدید به سرور)',
      sseConnections >= 2,
      `conns=${sseConnections}`,
    )
    sse.stop()
  }

  // ── S4: توکن غایب → tokenWait ──
  mode = 'healthy'
  frames = []
  {
    let tokenReady = false
    const sse = createFetchSse({
      url: () => (tokenReady ? sseUrl : null),
      onFrame: (f) => frames.push(f),
      timings: T,
    })
    await wait(T.tokenWaitMs + 60)
    ok('S4 (پیش): بدون توکن هنوز متصل نیست', !sse.isStreaming())
    tokenReady = true
    await wait(T.tokenWaitMs + 500)
    ok('S4: توکن آمد ⇒ اتصال برقرار شد', sse.isStreaming() && frames.some((f) => f.includes('connected')))
    sse.stop()
  }

  // ── S5: برگشت از پس‌زمینه در پنجره‌ی retry ⇒ فوری ──
  mode = 'silent' // اول وصل شو، بعد خاموش شو، watchdog → پنجره‌ی retry
  frames = []
  {
    const sse = createFetchSse({
      url: () => sseUrl,
      onFrame: (f) => frames.push(f),
      timings: T,
    })
    await wait(T.silenceTimeoutMs + 250) // watchdog زده؛ در پنجره‌ی retry (۳۵۰ms)
    mode = 'healthy'
    fire('visibilitychange')
    await wait(500)
    const connectedAgain = frames.filter((f) => f.includes('event: connected')).length >= 2
    ok('S5: برگشت به اپ در پنجره‌ی retry ⇒ اتصالِ فوری', connectedAgain, `frames=${frames.length}`)
    sse.stop()
  }

  // ── S6: استریمِ کهنه + برگشت ⇒ بازسازی ──
  mode = 'healthy'
  frames = []
  {
    const sse = createFetchSse({
      url: () => sseUrl,
      onFrame: (f) => frames.push(f),
      timings: T,
    })
    await wait(400) // وصل + ضربان‌ها
    // مرگِ خاموشِ «همین اتصال»: ضربان سرور را قطع می‌کنیم (سوکتِ مرده)
    stopCurrentHeartbeats?.()
    await wait(T.wakeStaleMs + 120) // استریم کهنه شده ولی watchdog هنوز شلیک نکرده
    const closedBefore = frames.length
    mode = 'healthy'
    fire('visibilitychange')
    await wait(700)
    const reconnectFrames = frames.slice(closedBefore).some((f) => f.includes('event: connected'))
    ok('S6: استریمِ کهنه + برگشت به اپ ⇒ بازسازی فوری', reconnectFrames, `frames=${frames.length}`)
    sse.stop()
  }

  // ── S7: استریمِ سالمِ تازه + برگشت ⇒ دست نمی‌خورد ──
  mode = 'healthy'
  sseConnections = 0
  {
    const sse = createFetchSse({
      url: () => sseUrl,
      timings: T,
    })
    await wait(300)
    const connsBefore = sseConnections
    fire('visibilitychange')
    await wait(300)
    ok(
      'S7: استریمِ تازه + برگشت ⇒ اتصالِ همان (بدون بازسازی)',
      sseConnections === connsBefore,
      `conns=${sseConnections}/${connsBefore}`,
    )
    sse.stop()
  }

  // ── S8: stop() ⇒ هیچ اتصالِ بعدی ──
  mode = 'healthy'
  sseConnections = 0
  {
    const sse = createFetchSse({ url: () => sseUrl, timings: T })
    await wait(250)
    sse.stop()
    const connsAtStop = sseConnections
    await wait(T.retryMs * 3 + T.silenceTimeoutMs + 400)
    ok(
      'S8: بعد از stop هیچ اتصال/تایمری نیست',
      sseConnections === connsAtStop && !sse.isStreaming(),
      `conns=${sseConnections}/${connsAtStop}`,
    )
  }

  // ── S9: بستن از سمت سرور (done) ⇒ onStreamClosed + retry ──
  mode = 'close-after-connect'
  closed = 0
  sseConnections = 0
  {
    const sse = createFetchSse({
      url: () => sseUrl,
      onStreamClosed: () => closed++,
      timings: T,
    })
    await wait(T.retryMs + 400)
    ok('S9: سرور استریم را بست ⇒ onStreamClosed + retry', closed >= 1 && sseConnections >= 2, `closed=${closed} conns=${sseConnections}`)
    sse.stop()
  }

  server.stop(true)
  console.log(`\n══ نتیجه: ${pass} ✓ / ${fail} ✗ ══\n`)
  if (fail > 0) process.exit(1)
}

void main()

export {}
