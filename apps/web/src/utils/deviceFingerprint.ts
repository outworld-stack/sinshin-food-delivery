// src/utils/deviceFingerprint.ts
// جمع‌آوری سیگنال‌های دستگاه — دو لایه:
//   لایه ۱: clientId ماندگار (localStorage + کوکی + sessionStorage — evercookie-lite)
//   لایه ۲: هش‌های canvas/webgl/audio/fonts + سیگنال‌های خام
// خروجی دقیقاً قرارداد device در POST /api/auth/otp/verify است.
// رارد ۳۱ — label حالا نام و نسخه‌ی مرورگر را هم دارد (خواسته‌ی کاربر:
// «هنگام سنجش دیوایس، مرورگرش را هم بسنجه») — فقط نمایشی، صفر تغییر API.
//
// stage-70 — دو تغییر:
//   ۱) پروتکل سیگنال ناموجود: خطا/عدم پشتیبانی دیگر رشته‌ی 'unavailable'
//      (و هش مشترکش) نمی‌فرستد — نشانگر «sinshin-missing-v1» می‌رود تا
//      سمت سرور آن را «missing» بشناسد و هرگز امتیاز شباهت نگیرد (P1-۱:
//      هشِ یکسانِ unavailable بین دستگاه‌های نامرتبط لینک کاذب می‌ساخت).
//      مقادیر degenerate (فونت صفر/صدا صفر) هم missing می‌شوند (D2).
//   ۲) تشخیص نوع/برند/مدل دستگاه (deviceIdentity.ts) — فقط نمایشی.
//
// ═══ stage-73 (یافته‌ی ۵) — «هرگز پرتاب نکن» ═══
//
// پیشینه: خواندن localStorage/کوکی/sessionStorage در getClientId محافظت
// نبود. مرورگرهایی که دسترسی storage را با exception رد می‌کنند (Safari
// با «Block All Cookies»، Chrome با «Block third-party cookies» در برخی
// حالت‌ها، WebViewهای قفل‌شده) → SecurityError → کل collectDeviceSignals
// می‌شکست → درخواست تأیید OTP «هرگز» ارسال نمی‌شد و ورود آن کاربر
// بی‌دلیل قطع می‌شد.
//
// ریشه‌ای‌ترین رفع: «مسیر ورود، گروگانِ سیگنال‌های اختیاری نیست» —
//  • هر مخزن جداگانه best-effort خوانده می‌شود (خطا = null، نه پرتاب)؛
//  • randomUUID جایگزینِ Math.random برای زمینه‌های ناامن (HTTP غیر
//    localhost — crypto.randomUUID فقط secure-context است)؛
//  • sha256Hex بدون crypto.subtle (همان زمینه‌ها) → مقدار missing؛
//    سرورِ stage-70+ این مقدار را «بی‌اطلاع» می‌شناسد و مسیر lowq-scoped
//    (clientId/شماره) را می‌رود — ورود سالم می‌ماند، فقط سیگنال کم‌کیفیت؛
//  • Intl/زبان هم best-effort.
// نتیجه: collectDeviceSignals دیگر در هیچ مرورگری پرتاب نمی‌کند.

import { browserLabel } from '#/lib/browserSupport'
import { detectDeviceIdentity, readHighEntropy } from '#/utils/deviceIdentity'

const DID_KEY = 'sinshin_did'
/** نشانگر سیگنال ناموجود — سرور sha256 همین را «missing» می‌شناسد */
const MISSING_SIGNAL = 'sinshin-missing-v1'
/**
 * stage-73 — sha256('sinshin-missing-v1') از پیش‌محاسبه‌شده.
 * زمینه‌های ناامن (بدون crypto.subtle) مقدار سیگنال را نمی‌توانند هش
 * کنند؛ همه‌ی سیگنال‌ها این مقدار ثابت را می‌گیرند = «missing» برای
 * سرور (قرارداد stage-70). مقدار با sha256 خود Bun در تست‌ها تطبیق
 * داده شده (scripts/test-device-fingerprint.ts — بند T4).
 */
const MISSING_HASH_HEX = 'f020fbda2d9a8b1bdf1f7016373e52ecb26742cddd3a32f7cd7ee8f1a66c9bb5'
const SIGNAL_TIMEOUT_MS = 1_500
let memoryClientId: string | null = null

/** Optional browser probes must never hold the OTP submission open. */
async function boundedHash(probe: Promise<string>): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      probe.catch(() => MISSING_HASH_HEX),
      new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve(MISSING_HASH_HEX), SIGNAL_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** خواندِ best-effort — خطای دسترسی = null، هرگز پرتاب (یافته‌ی ۵) */
function safeGet(read: () => string | null): string | null {
  try {
    return read()
  } catch {
    return null
  }
}

function readCookie(name: string): string | null {
  try {
    const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
    return m ? decodeURIComponent(m[1]) : null
  } catch {
    // document.cookie در حالت «Block All Cookies» با SecurityError رد می‌شود
    return null
  }
}

function writeCookie(name: string, value: string): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; max-age=31536000; path=/; samesite=lax`
}

/** UUID با fallback — زمینه‌ی ناامنِ crypto.randomUUID ندارد (stage-73) */
function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    /* زمینِ قفل‌شده — پایین بیا */
  }
  const hex = (n: number): string =>
    Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('')
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${hex(4)}-${hex(12)}`
}

/** لایه ۱ — uuid ماندگار؛ هر جای ممکنی ذخیره می‌شود تا پاک‌کردنش سخت باشد */
export function getClientId(): string {
  // stage-73 — هر مخزن «جداگانه» best-effort: رد شدنِ یکی (SecurityError
  // مرورگرهای قفل‌شده) مسیر ورود را متوقف نمی‌کند
  const id = [
    safeGet(() => localStorage.getItem(DID_KEY)),
    readCookie(DID_KEY),
    safeGet(() => sessionStorage.getItem(DID_KEY)),
    memoryClientId,
  ].find((value) => typeof value === 'string' && /^[0-9a-f-]{16,64}$/i.test(value))
  const finalId = id ?? randomId()
  memoryClientId = finalId
  // هر بار همه‌ی مخزن‌ها را تازه کن — یکی پاک شه، بقیه زنده‌اند
  try { localStorage.setItem(DID_KEY, finalId) } catch { /* حالت خصوصی */ }
  try { sessionStorage.setItem(DID_KEY, finalId) } catch { /* هیچ‌کاری نمی‌کند */ }
  try { writeCookie(DID_KEY, finalId) } catch { /* هیچ‌کاری نمی‌کند */ }
  return finalId
}

async function sha256Hex(input: string): Promise<string> {
  try {
    // زمینه‌ی ناامن (HTTP غیر localhost): crypto.subtle تعریف نشده —
    // مقدار missing ثابت (سرور آن را بی‌اطلاع می‌شناسد؛ ورود سالم می‌ماند)
    if (typeof crypto === 'undefined' || !crypto.subtle) return MISSING_HASH_HEX
    const data = new TextEncoder().encode(input)
    const digest = await crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  } catch {
    return MISSING_HASH_HEX
  }
}

// ── لایه ۲ — سیگنال‌ها ──

function canvasSignal(): string {
  try {
    const c = document.createElement('canvas')
    c.width = 240
    c.height = 60
    const ctx = c.getContext('2d')
    if (!ctx) return MISSING_SIGNAL
    ctx.textBaseline = 'top'
    ctx.font = '14px Arial'
    ctx.fillStyle = '#f60'
    ctx.fillRect(0, 0, 90, 30)
    ctx.fillStyle = '#069'
    ctx.fillText('Sinshin fp \u{1F355} \u06F1\u06F2\u06F3', 2, 12)
    ctx.fillStyle = 'rgba(102,204,0,0.7)'
    ctx.fillText('sinshin-fp', 4, 30)
    ctx.globalCompositeOperation = 'multiply'
    ctx.fillStyle = 'rgb(255,0,255)'
    ctx.beginPath(); ctx.arc(50, 50, 20, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = 'rgb(0,255,255)'
    ctx.beginPath(); ctx.arc(100, 50, 20, 0, Math.PI * 2); ctx.fill()
    return c.toDataURL()
  } catch {
    return MISSING_SIGNAL
  }
}

function webglSignal(): string {
  try {
    const c = document.createElement('canvas')
    const gl = (c.getContext('webgl') ?? c.getContext('experimental-webgl')) as WebGLRenderingContext | null
    if (!gl) return MISSING_SIGNAL
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    const vendor = ext ? String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)) : String(gl.getParameter(gl.VENDOR))
    const renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER))
    return `${vendor}~${renderer}~${gl.getParameter(gl.MAX_TEXTURE_SIZE)}~${gl.getParameter(gl.VERSION)}`
  } catch {
    return MISSING_SIGNAL
  }
}

async function audioSignal(): Promise<string> {
  try {
    const Ctx =
      window.OfflineAudioContext ??
      (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext
    if (!Ctx) return MISSING_SIGNAL
    const ctx = new Ctx(1, 44100, 44100)
    const osc = ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = 10000
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -50
    comp.knee.value = 40
    comp.ratio.value = 12
    comp.attack.value = 0
    comp.release.value = 0.25
    osc.connect(comp)
    comp.connect(ctx.destination)
    osc.start(0)
    const buffer = await ctx.startRendering()
    const data = buffer.getChannelData(0)
    let sum = 0
    for (let i = 4500; i < 5000; i++) sum += Math.abs(data[i])
    // D2 — جمع صفر = anti-fingerprinting (بی‌اطلاع)؛ نه سیگنال واقعی
    if (!Number.isFinite(sum) || sum === 0) return MISSING_SIGNAL
    return sum.toString()
  } catch {
    return MISSING_SIGNAL
  }
}

const FONT_LIST = [
  'Arial', 'Arial Black', 'Arial Narrow', 'Bahnschrift', 'Calibri', 'Cambria', 'Candara',
  'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Courier New', 'Ebrima',
  'Franklin Gothic Medium', 'Gabriola', 'Georgia', 'Impact', 'Javanese Text',
  'Lucida Console', 'Lucida Sans Unicode', 'Malgun Gothic', 'Marlett', 'Microsoft Himalaya',
  'Microsoft JhengHei', 'Microsoft Sans Serif', 'Microsoft YaHei', 'MingLiU-ExtB',
  'Mongolian Baiti', 'MS Gothic', 'MV Boli', 'Myanmar Text', 'Nirmala UI',
  'Palatino Linotype', 'Segoe Print', 'Segoe Script', 'Segoe UI', 'Segoe UI Emoji',
  'Segoe UI Historic', 'Segoe UI Symbol', 'SimSun', 'Sitka', 'Sylfaen', 'Symbol',
  'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Webdings', 'Wingdings',
  'Yu Gothic', 'Noto Naskh Arabic', 'Noto Sans Arabic', 'Noto Sans', 'Noto Sans JP',
  'Noto Sans KR', 'Noto Sans SC', 'Noto Sans TC', 'Noto Serif', 'Roboto',
  'Vazirmatn', 'IRANSans', 'Dana',
]

function fontSignal(): string {
  try {
    const probe = 'mmmmmmmmmmlli Ww@#%\u06F4\u06F5'
    const measure = (font: string): { w: number; h: number } => {
      const s = document.createElement('span')
      s.style.cssText = `position:absolute;left:-9999px;top:-9999px;font-size:72px;font-family:${font};white-space:nowrap;`
      s.textContent = probe
      document.body.appendChild(s)
      const r = { w: s.offsetWidth, h: s.offsetHeight }
      s.remove()
      return r
    }
    const base = measure('monospace')
    const found: string[] = []
    for (const f of FONT_LIST) {
      const m = measure(`"${f}",monospace`)
      if (m.w !== base.w || m.h !== base.h) found.push(f)
    }
    // D2 — صفر فونت = همه‌ی اندازه‌ها مساوی (anti-fp) → بی‌اطلاع
    if (found.length === 0) return MISSING_SIGNAL
    return found.join(',')
  } catch {
    return MISSING_SIGNAL
  }
}

export interface DeviceSignalsPayload {
  clientId: string
  canvasHash: string
  webglHash: string
  audioHash: string
  fontsHash: string
  screen: string
  platform: string
  timezone: string
  language: string
  hardwareConcurrency: number | null
  deviceMemory: number | null
  touch: boolean
  networkType: string | null
  label: string
  /** stage-70 — فقط نمایشی (پنل ادمین/پروفایل) */
  deviceType: 'mobile' | 'tablet' | 'desktop'
  deviceBrand: string | null
  deviceModel: string | null
}

/** مقدار رشته‌ایِ best-effort — خطا/خالی = fallback (stage-73) */
function safeStr(read: () => string, fallback: string): string {
  try {
    const v = read()
    return v || fallback
  } catch {
    return fallback
  }
}

function safeValue<T>(read: () => T, fallback: T): T {
  try { return read() } catch { return fallback }
}

/** جمع‌آوری کامل — قبل از فراخوانیِ تایید
 * stage-73: این تابع دیگر «هرگز» پرتاب نمی‌کند — هر سیگنالِ شکست‌خورده
 * به missing/مقدار پیش‌فرض تنزل می‌کند تا مسیر تأیید OTP سالم بماند. */
export async function collectDeviceSignals(): Promise<DeviceSignalsPayload> {
  const [canvasHash, webglHash, audioHash, fontsHash, highEntropy] = await Promise.all([
    boundedHash(sha256Hex(canvasSignal())),
    boundedHash(sha256Hex(webglSignal())),
    boundedHash(audioSignal().then(sha256Hex)),
    boundedHash(sha256Hex(fontSignal())),
    readHighEntropy(),
  ])

  const nav = safeValue(() => navigator, {} as Navigator) as Navigator & {
    userAgentData?: { platform?: string }
    deviceMemory?: number
    connection?: { effectiveType?: string }
  }
  const platform = safeStr(() => nav.userAgentData?.platform ?? nav.platform ?? '', 'unknown')
  // رارد ۳۱ — «Windows · 1920x1080 · Chrome 141» به‌جای «Windows · 1920x1080»؛
  // ادمین در فهرست دستگاه‌های کاربر می‌بیند کاربر با چه مرورگری آمده
  const userAgent = safeStr(() => nav.userAgent, '')
  const maxTouchPoints = safeValue(() => nav.maxTouchPoints, 0)
  const browser = browserLabel(userAgent)

  // stage-70 — برند/مدل/نوع دستگاه (فقط نمایشی)
  // stage-72 (P2-۲۳) — maxTouchPoints برای آیپدِ دسکتاپ‌مود (UA مک)
  const identity = detectDeviceIdentity(userAgent, highEntropy, maxTouchPoints)

  const screenDesc = safeStr(
    () => `${screen.width}x${screen.height}x${screen.colorDepth}@${devicePixelRatio}`,
    'unknown',
  )
  const timezone = safeStr(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    'unknown',
  )
  const language = safeStr(() => nav.language, 'unknown')
  const cores = safeValue(() => nav.hardwareConcurrency, 0)
  const memory = safeValue(() => nav.deviceMemory, undefined)

  return {
    clientId: getClientId(),
    canvasHash,
    webglHash,
    audioHash,
    fontsHash,
    screen: screenDesc,
    platform: platform.slice(0, 60),
    timezone: timezone.slice(0, 60),
    language: language.slice(0, 20),
    hardwareConcurrency: Number.isInteger(cores) && cores >= 1 && cores <= 256 ? cores : null,
    deviceMemory: typeof memory === 'number' && Number.isFinite(memory) && memory >= 0 && memory <= 64 ? memory : null,
    touch: safeValue(() => 'ontouchstart' in window, false) || maxTouchPoints > 0,
    networkType: safeValue(() => nav.connection?.effectiveType?.slice(0, 20) ?? null, null),
    label: (browser
      ? `${platform} · ${safeStr(() => `${screen.width}x${screen.height}`, '?')} · ${browser}`
      : `${platform} · ${safeStr(() => `${screen.width}x${screen.height}`, '?')}`).slice(0, 100),
    deviceType: identity.type,
    deviceBrand: identity.brand?.slice(0, 30) ?? null,
    deviceModel: identity.model?.slice(0, 80) ?? null,
  }
}
