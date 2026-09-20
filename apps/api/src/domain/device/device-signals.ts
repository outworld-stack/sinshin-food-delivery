//src/domain/device/device-signals.ts
import { sha256 } from '#/domain/shared/crypto'

/** سیگنال‌های ورودی از کلاینت — قرارداد payload تأیید OTP */
export interface DeviceSignals {
  /** لایه ۱ — uuid ماندگار کلاینت */
  clientId?: string | null
  canvasHash: string
  webglHash: string
  audioHash: string
  fontsHash: string
  screen?: string | null
  platform?: string | null
  timezone?: string | null
  language?: string | null
  hardwareConcurrency?: number | null
  /** GB — navigator.deviceMemory */
  deviceMemory?: number | null
  touch?: boolean | null
  networkType?: string | null
  label?: string | null
  /** از هدر سرور می‌آید، نه کلاینت */
  userAgent?: string | null
}

/** فیلدهای مقایسه‌شونده — ردیف devices هم این شکل را دارد */
interface SignalLike {
  canvasHash: string
  webglHash: string
  audioHash: string
  fontsHash: string
  screen?: string | null
  platform?: string | null
  timezone?: string | null
  language?: string | null
}

// ── شباهت وزن‌دار ──
// GPU-heavy ها سنگین‌اند چون مرورگر/VPN عوض کنی هم ثابت می‌مانند.
const W = {
  canvas: 0.25,
  webgl: 0.25,
  audio: 0.2,
  fonts: 0.15,
  screen: 0.05,
  platform: 0.05,
  tzlang: 0.05,
} as const

export function signalSimilarity(a: SignalLike, b: SignalLike): number {
  let s = 0
  if (a.canvasHash === b.canvasHash) s += W.canvas
  if (a.webglHash === b.webglHash) s += W.webgl
  if (a.audioHash === b.audioHash) s += W.audio
  if (a.fontsHash === b.fontsHash) s += W.fonts
  if (a.screen && a.screen === b.screen) s += W.screen
  if (a.platform && a.platform === b.platform) s += W.platform
  if (a.timezone && a.timezone === b.timezone && a.language && a.language === b.language) {
    s += W.tzlang
  }
  return s
}

// ── هش مرکب ──

/** خانواده‌ی مرورگر از UA — بدون نسخه (نسخه با هر آپدیت عوض می‌شود و FP را می‌شکند) */
export function uaFamily(ua: string | null | undefined): string {
  if (!ua) return '-'
  if (/edg\//i.test(ua)) return 'Edge'
  if (/samsungbrowser/i.test(ua)) return 'Samsung'
  if (/opr\/|opera/i.test(ua)) return 'Opera'
  if (/firefox|fxios/i.test(ua)) return 'Firefox'
  if (/chrome|crios/i.test(ua)) return 'Chrome'
  if (/safari/i.test(ua)) return 'Safari'
  return 'Other'
}

/**
 * FP_HASH = sha256(ترکیب مرتب‌شده‌ی همه‌ی سیگنال‌ها + خانواده‌ی مرورگر).
 * نسخه‌ی مرورگر عمداً حذف است — آپدیت مرورگر نباید هویت دستگاه را عوض کند.
 */
export function compositeFingerprintHash(s: DeviceSignals, userAgent: string | null): string {
  const canon = [
    s.canvasHash,
    s.webglHash,
    s.audioHash,
    s.fontsHash,
    s.screen ?? '-',
    s.platform ?? '-',
    s.timezone ?? '-',
    s.language ?? '-',
    s.hardwareConcurrency ?? '-',
    s.deviceMemory ?? '-',
    s.touch ? '1' : '0',
    s.networkType ?? '-',
    uaFamily(userAgent),
  ].join('|')
  return sha256(canon)
}

// ── امتیاز ریسک ──

const HEADLESS_RE = /headlesschrome|phantomjs|electron\/|nightmare|selenium|puppeteer|playwright|pyppeteer/i

function detectOs(source: string | null | undefined): string | null {
  if (!source) return null
  const s = source.toLowerCase()
  if (s.includes('windows')) return 'windows'
  if (s.includes('android')) return 'android'
  if (/iphone|ipad|ios/.test(s)) return 'ios'
  if (/mac os|macintosh/.test(s)) return 'mac'
  if (s.includes('linux')) return 'linux'
  return null
}

export interface RiskInput {
  signals: DeviceSignals
  userAgent: string | null
  /** شماره‌های متمایز خوشه (شامل فعلی) */
  clusterPhoneCount: number
  /** clientId یکی ولی canvas عوض شده و webgl/audio ثابت — نشانه‌ی spoofing */
  canvasDrift: boolean
}

export function computeRiskScore(input: RiskInput): { score: number; flags: string[] } {
  const flags: string[] = []
  let score = 0

  if (input.signals.deviceMemory != null && input.signals.deviceMemory <= 2) {
    score += 25
    flags.push('low-memory')
  }
  if (input.userAgent && HEADLESS_RE.test(input.userAgent)) {
    score += 35
    flags.push('headless-ua')
  }
  const mobileUa = /android|iphone|ipad|mobile/i.test(input.userAgent ?? '')
  if (mobileUa && input.signals.touch === false) {
    score += 20
    flags.push('mobile-no-touch')
  }
  const uaOs = detectOs(input.userAgent)
  const platformOs = detectOs(input.signals.platform)
  if (uaOs && platformOs && uaOs !== platformOs) {
    score += 20
    flags.push('platform-mismatch')
  }
  if (input.clusterPhoneCount >= 4) {
    score += 15
    flags.push('crowded-cluster')
  }
  if (input.canvasDrift) {
    score += 25
    flags.push('canvas-drift')
  }

  return { score: Math.min(100, score), flags }
}