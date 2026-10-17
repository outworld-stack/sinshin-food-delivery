// src/../scripts/test-device-fingerprint.ts
/**
 * تست «هرگز-پرتاب-نکن» برای deviceFingerprint (stage-73 — یافته‌ی ۵).
 *
 *   bun scripts/test-device-fingerprint.ts   (از apps/web — یا: bun run test:device)
 *
 * چه می‌کند؟ DOM حداقلی را با «همه‌ی مخزن‌های پرتاب‌کننده» شبیه‌سازی
 * می‌کند — دقیقاً محیطِ مرورگرهایی که دسترسی storage را با exception رد
 * می‌کنند (Safari «Block All Cookies»، WebViewهای قفل‌شده):
 *  • localStorage / sessionStorage / document.cookie → SecurityError
 *  • crypto.randomUUID / crypto.subtle → تعریف‌نشده (زمینه‌ی ناامن)
 * و بعد ثابت می‌کند:
 *  T1) getClientId بدون پرتاب، با فرمت معتبر
 *  T2) collectDeviceSignals بدون پرتاب resolve می‌شود (OTP ارسال می‌شود!)
 *  T3) همه‌ی هش‌ها = مقدار missing ثابت (قرارداد سرور stage-70+)
 *  T4) MISSING_HASH_HEX دقیقاً sha256('sinshin-missing-v1') است (تطبیق node:crypto)
 *  T5) با storage سالم: clientId بین دو فراخوانی ماندگار است (evercookie-lite)
 *
 * بدون مرورگر واقعی — همان الگوی تست‌های deviceIdentity: شبیه‌سازیِ
 * مینیمالِ globalها روی Bun. ماژول globalها را «در لحظه‌ی فراخوانی»
 * می‌خواند (نه import) — پس نصب متوالی حالت‌ها کار می‌کند.
 */

// ── شبیه‌سازی DOM ─────────────────────────────────────────────────

function throwOnAccess(label: string): never {
  throw new Error(`SecurityError: ${label} access denied (stub)`)
}

/** context دوبعدیِ حداقلی برای canvas (همه‌ی متدها no-op) */
const ctx2d = new Proxy(
  {},
  {
    get: (_t, prop) => {
      if (typeof prop === 'string' && /^(fillText|fillRect|beginPath|arc|fill)$/.test(prop)) {
        return () => undefined
      }
      return undefined
    },
    set: () => true,
  },
)

/** عنصر canvas/span حداقلی */
function makeElement(tag: string): Record<string, unknown> {
  const style = { cssText: '' }
  if (tag === 'canvas') {
    return {
      width: 0,
      height: 0,
      style,
      getContext: (kind: string) => (kind === '2d' ? ctx2d : null),
      toDataURL: () => 'data:image/png;base64,STUB',
    }
  }
  // span (اندازه‌گیری فونت) — همه‌ی اندازه‌ها مساوی → صفر فونت → missing (D2)
  return {
    style,
    textContent: '',
    offsetWidth: 42,
    offsetHeight: 42,
    remove: () => undefined,
  }
}

/** document کاری (canvas/font مسیر سالم) */
const workingDocument = {
  createElement: (tag: string) => makeElement(tag),
  body: { appendChild: () => undefined },
  cookie: '',
}

/** globals مشترک — window/screen/navigator (در هر دو حالت) */
function installSharedGlobals(): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { devicePixelRatio: 2 }, // بدون OfflineAudioContext → audio = missing
  })
  // در مرورگر واقعی devicePixelRatio خودِ global است (window === globalThis)
  Object.defineProperty(globalThis, 'devicePixelRatio', { configurable: true, value: 2 })
  Object.defineProperty(globalThis, 'screen', {
    configurable: true,
    value: { width: 360, height: 800, colorDepth: 24 },
  })
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      userAgent:
        'Mozilla/5.0 (Linux; Android 14; SM-A556B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
      platform: 'Linux armv8l',
      language: 'fa-IR',
      hardwareConcurrency: 8,
      maxTouchPoints: 5,
      connection: { effectiveType: '4g' },
    },
  })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: workingDocument,
  })
}

/** محیط خصمانه: هر سه مخزن + document با SecurityError رد می‌شوند؛ crypto خالی */
function installHostileGlobals(): void {
  for (const globalName of ['localStorage', 'sessionStorage'] as const) {
    Object.defineProperty(globalThis, globalName, {
      configurable: true,
      get() {
        throwOnAccess(globalName)
      },
    })
  }
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    get() {
      throwOnAccess('document.cookie')
    },
  })
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {}, // نه randomUUID نه subtle — زمینه‌ی ناامن (HTTP غیر localhost)
  })
}

/** محیط سالم: storageهای حافظه‌ای کار می‌کنند */
function installWorkingGlobals(): void {
  const store = new Map<string, string>()
  const storageLike = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v)
    },
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storageLike })
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storageLike })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: workingDocument })
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} })
}

// ── اجرای تست‌ها ─────────────────────────────────────────────────

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

// ① globals مشترک (window/screen/navigator/document کاری)
installSharedGlobals()

const { getClientId, collectDeviceSignals } = await import('../src/utils/deviceFingerprint')
type Payload = import('../src/utils/deviceFingerprint').DeviceSignalsPayload

console.log('\n══ بخش ۱ — محیط خصمانه (همه‌ی storageها پرتاب می‌کنند) ══')

// ② حالت خصمانه: storageها + document + crypto همه می‌شکنند
installHostileGlobals()

let id: string | null = null
try {
  id = getClientId()
  ok('T1: getClientId با storageهای پرتاب‌کننده، بدون exception', true)
} catch (error) {
  ok('T1: getClientId با storageهای پرتاب‌کننده، بدون exception', false, String(error))
}
ok(
  'T1: خروجی فرمت معتبر دارد (قرارداد سرور: ≤۶۴ کاراکتر)',
  typeof id === 'string' && /^[0-9a-f-]{16,64}$/i.test(id),
  String(id),
)

let payload: Payload | null = null
try {
  payload = await collectDeviceSignals()
  ok('T2: collectDeviceSignals resolve شد — یعنی درخواست تأیید OTP زنده می‌ماند', true)
} catch (error) {
  ok('T2: collectDeviceSignals resolve شد — یعنی درخواست تأیید OTP زنده می‌ماند', false, String(error))
}

if (payload) {
  const MISSING = 'f020fbda2d9a8b1bdf1f7016373e52ecb26742cddd3a32f7cd7ee8f1a66c9bb5'
  ok(
    'T3: هر چهار هش = مقدار missing ثابت (قرارداد سرور stage-70+؛ الگوی ^[a-f0-9]{64}$)',
    [payload.canvasHash, payload.webglHash, payload.audioHash, payload.fontsHash].every(
      (h) => h === MISSING && /^[a-f0-9]{64}$/.test(h),
    ),
  )
  ok(
    'T3: clientId و screen/timezone/language همه مقدارِ سالم دارند',
    /^[0-9a-f-]{16,64}$/i.test(payload.clientId) &&
      payload.screen === '360x800x24@2' &&
      typeof payload.timezone === 'string' &&
      payload.timezone.length > 0 &&
      payload.language === 'fa-IR',
    JSON.stringify({ screen: payload.screen, tz: payload.timezone, lang: payload.language }),
  )
  ok(
    'T3: label و identity نمایشی هم ساختار دارند (بدون کرش)',
    typeof payload.label === 'string' && payload.label.length > 0,
    payload.label,
  )
}

console.log('\n══ بخش ۲ — تطبیق رمز missing با sha256 واقعی ══')

const nodeCrypto = await import('node:crypto')
const realMissing = nodeCrypto.createHash('sha256').update('sinshin-missing-v1').digest('hex')
const realUnavailable = nodeCrypto.createHash('sha256').update('unavailable').digest('hex')
ok(
  'T4: MISSING_HASH_HEX === sha256("sinshin-missing-v1") (تطبیق با node:crypto)',
  realMissing === 'f020fbda2d9a8b1bdf1f7016373e52ecb26742cddd3a32f7cd7ee8f1a66c9bb5',
  realMissing,
)
ok(
  'T4: sha256("unavailable") — کلاینت‌های قدیمیِ کش‌شده (دوره‌ی گذار stage-70)',
  realUnavailable === 'ba691ba042bcedd9a61a36f5969026bc95859dccdc7e47f24e6bce35673baf2f',
  realUnavailable,
)

console.log('\n══ بخش ۳ — محیط سالم (storage کار می‌کند) ══')

// ④ حالت سالم: ماندگاری clientId (evercookie-lite)
installWorkingGlobals()
const idA = getClientId()
const idB = getClientId()
ok('T5: با storage سالم، clientId بین فراخوانی‌ها ماندگار است', idA === idB && idA.length >= 16)

let payload2: Payload | null = null
try {
  payload2 = await collectDeviceSignals()
  ok('T5: collectDeviceSignals در محیط سالم هم resolve شد', true)
} catch (error) {
  ok('T5: collectDeviceSignals در محیط سالم هم resolve شد', false, String(error))
}
if (payload2) {
  ok(
    'T5: clientId همان مقدار ماندگار است',
    payload2.clientId === idA,
    `${payload2.clientId} !== ${idA}`,
  )
}

console.log('\n══ Storage recovery and stalled browser probes ══')

installHostileGlobals()
ok('T6: blocked storage keeps a stable ID within the page', getClientId() === getClientId())

installSharedGlobals()
const cookieId = '12345678-1234-4234-abcd-123456789abc'
let localValue = 'corrupt-device-id'
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: () => localValue,
    setItem: (_key: string, value: string) => { localValue = value },
  },
})
workingDocument.cookie = `sinshin_did=${cookieId}`
ok('T6: invalid localStorage falls through to a valid cookie', getClientId() === cookieId)
ok('T6: the recovered device ID repairs localStorage', localValue === cookieId)

// Actual WebCrypto keeps working probes distinguishable from a stalled audio
// renderer. This reproduces browsers that suspend OfflineAudioContext.
Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
  subtle: { digest: async (_algorithm: string, data: Uint8Array) => nodeCrypto.createHash('sha256').update(data).digest() },
} })
class SuspendedAudioContext {
  destination = {}
  createOscillator() {
    return { type: '', frequency: { value: 0 }, connect() {}, start() {} }
  }
  createDynamicsCompressor() {
    return {
      threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 },
      attack: { value: 0 }, release: { value: 0 }, connect() {},
    }
  }
  startRendering() { return new Promise(() => {}) }
}
Object.defineProperty(window, 'OfflineAudioContext', { configurable: true, value: SuspendedAudioContext })
const started = Date.now()
const stalledAudio = await collectDeviceSignals()
ok('T7: suspended audio cannot hang OTP verification', Date.now() - started < 3_000)
ok('T7: only the stalled audio is replaced with missing data',
  stalledAudio.audioHash === realMissing && stalledAudio.canvasHash !== realMissing)

installSharedGlobals()
Object.defineProperty(globalThis, 'crypto', {
  configurable: true,
  value: { subtle: { digest: () => new Promise(() => {}) } },
})
const hashStarted = Date.now()
const stalledHash = await collectDeviceSignals()
ok('T8: stalled hashing cannot hang OTP verification', Date.now() - hashStarted < 3_000)
ok('T8: stalled hashes follow the server missing-signal protocol',
  [stalledHash.canvasHash, stalledHash.webglHash, stalledHash.audioHash, stalledHash.fontsHash]
    .every((hash) => hash === realMissing))

installSharedGlobals()
Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} })
for (const key of ['userAgent', 'platform', 'language', 'hardwareConcurrency', 'deviceMemory', 'maxTouchPoints', 'connection', 'userAgentData']) {
  Object.defineProperty(navigator, key, { configurable: true, get() { throwOnAccess(key) } })
}
const privateBrowser = await collectDeviceSignals()
ok('T9: denied navigator properties do not prevent verification',
  privateBrowser.platform === 'unknown' && privateBrowser.language === 'unknown' &&
  privateBrowser.hardwareConcurrency === null && privateBrowser.deviceMemory === null && privateBrowser.networkType === null)

installSharedGlobals()
Object.defineProperty(navigator, 'hardwareConcurrency', { value: 512 })
Object.defineProperty(navigator, 'deviceMemory', { value: 128 })
Object.defineProperty(navigator, 'userAgentData', { value: {
  getHighEntropyValues: async () => ({ model: 'Samsung '.repeat(30), platform: 'Android' }),
} })
const unusualBrowser = await collectDeviceSignals()
ok('T10: optional browser data stays within verification API limits',
  unusualBrowser.hardwareConcurrency === null && unusualBrowser.deviceMemory === null &&
  (unusualBrowser.deviceModel?.length ?? 0) <= 80 && unusualBrowser.label.length <= 100)

const { detectDeviceIdentity } = await import('../src/utils/deviceIdentity')
for (const [model, expected] of [
  ['SM-S916B', 'S23+'], ['SM-S926U1', 'S24+'], ['SM-S936W', 'S25+'],
  ['SM-S918U', 'S23 Ultra'], ['SM-A556B', 'A55'], ['SM-T970', 'T970'],
]) {
  ok(`T11: device model ${model} is displayed as ${expected}`,
    detectDeviceIdentity('Android Mobile', { model }).model === expected)
}

console.log(`\n══ نتیجه: ${pass} پاس / ${fail} خطا ══`)
if (fail > 0) process.exitCode = 1

export {}
