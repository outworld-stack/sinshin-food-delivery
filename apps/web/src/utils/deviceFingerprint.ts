// src/utils/deviceFingerprint.ts
// جمع‌آوری سیگنال‌های دستگاه — دو لایه:
//   لایه ۱: clientId ماندگار (localStorage + cookie + sessionStorage — evercookie-lite)
//   لایه ۲: هش‌های canvas/webgl/audio/fonts + سیگنال‌های خام
// خروجی دقیقاً قرارداد device در POST /api/auth/otp/verify است.

const DID_KEY = 'sinshin_did'

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return m ? decodeURIComponent(m[1]) : null
}

function writeCookie(name: string, value: string): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; max-age=31536000; path=/; samesite=lax`
}

/** لایه ۱ — uuid ماندگار؛ هر جای ممکنی ذخیره می‌شود تا پاک‌کردنش سخت باشد */
export function getClientId(): string {
  let id = localStorage.getItem(DID_KEY) ?? readCookie(DID_KEY) ?? sessionStorage.getItem(DID_KEY)
  if (!id || !/^[0-9a-f-]{16,64}$/i.test(id)) {
    id = crypto.randomUUID()
  }
  // هر بار همه‌ی مخزن‌ها را تازه کن — یکی پاک شه، بقیه زنده‌اند
  try { localStorage.setItem(DID_KEY, id) } catch { /* private mode */ }
  try { sessionStorage.setItem(DID_KEY, id) } catch { /* noop */ }
  try { writeCookie(DID_KEY, id) } catch { /* noop */ }
  return id
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// ── لایه ۲ — سیگنال‌ها ──

function canvasSignal(): string {
  try {
    const c = document.createElement('canvas')
    c.width = 240
    c.height = 60
    const ctx = c.getContext('2d')
    if (!ctx) return 'unavailable'
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
    return 'unavailable'
  }
}

function webglSignal(): string {
  try {
    const c = document.createElement('canvas')
    const gl = (c.getContext('webgl') ?? c.getContext('experimental-webgl')) as WebGLRenderingContext | null
    if (!gl) return 'unavailable'
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    const vendor = ext ? String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)) : String(gl.getParameter(gl.VENDOR))
    const renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER))
    return `${vendor}~${renderer}~${gl.getParameter(gl.MAX_TEXTURE_SIZE)}~${gl.getParameter(gl.VERSION)}`
  } catch {
    return 'unavailable'
  }
}

async function audioSignal(): Promise<string> {
  try {
    const Ctx =
      window.OfflineAudioContext ??
      (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext
    if (!Ctx) return 'unavailable'
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
    return sum.toString()
  } catch {
    return 'unavailable'
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
    return found.join(',')
  } catch {
    return 'unavailable'
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
}

/** جمع‌آوری کامل — قبل از فراخوانی verify */
export async function collectDeviceSignals(): Promise<DeviceSignalsPayload> {
  const [canvasHash, webglHash, audioHash, fontsHash] = await Promise.all([
    sha256Hex(canvasSignal()),
    sha256Hex(webglSignal()),
    audioSignal().then(sha256Hex),
    sha256Hex(fontSignal()),
  ])

  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string }
    deviceMemory?: number
    connection?: { effectiveType?: string }
  }
  const platform = nav.userAgentData?.platform ?? nav.platform ?? 'unknown'

  return {
    clientId: getClientId(),
    canvasHash,
    webglHash,
    audioHash,
    fontsHash,
    screen: `${screen.width}x${screen.height}x${screen.colorDepth}@${devicePixelRatio}`,
    platform,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'unknown',
    language: navigator.language ?? 'unknown',
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    deviceMemory: nav.deviceMemory ?? null,
    touch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
    networkType: nav.connection?.effectiveType ?? null,
    label: `${platform} · ${screen.width}x${screen.height}`,
  }
}