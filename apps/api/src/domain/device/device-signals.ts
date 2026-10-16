//src/domain/device/device-signals.ts
import { sha256 } from '#/domain/shared/crypto'

/** سیگنال‌های ورودی از کلاینت — قرارداد بدنه‌ی درخواست تأیید OTP */
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
  /**
   * stage-70 — نوع/برند/مدل دستگاه (تشخیص سمت کلاینت، فقط نمایشی).
   * هرگز در fingerprint/امتیاز ریسک/سهمیه دخیل نیست — شبیه‌سازی/جعلش
   * اثر عملکردی ندارد و صرفاً نام ستون «نام دستگاه» را پر می‌کند.
   */
  deviceType?: string | null
  deviceBrand?: string | null
  deviceModel?: string | null
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

// ═══ stage-70 — پروتکل سیگنال ناموجود ═══
//
// پیشینه (اسکن راند ۷۰ / P1-۱): سه سیگنال GPU-محور در صورت خطا/عدم
// پشتیبانی مقدار یکسانِ 'unavailable' برمی‌گرداندند و SHA-256 همان رشته
// ارسال می‌شد؛ برابری این هش‌ها در similarity امتیاز مثبت می‌گرفت —
// 0.25+0.25+0.20 = 0.70 که «دقیقاً» آستانه‌ی پیش‌فرض لینک است. نتیجه:
// دستگاه‌های فیزیکی نامرتبط با APIهای محدودشده (مرورگرهای حریم‌خصوصی،
// WebViewها) به یکدیگر پیوند می‌خوردند و ثبت‌نام شماره‌ی جدید به‌اشتباه
// رد می‌شد.
//
// رفع (P1-۱ + D1 + D2): «نبودن سیگنال» از «برابری سیگنال» تفکیک شد —
// ۱) کلاینت جدید نشانگر sinshin-missing-v1 می‌فرستد؛ کلاینت قدیمیِ
//    کش‌شده هنوز 'unavailable' — هر دو اینجا «missing» شناخته می‌شوند.
// ۲) مقادیر degenerate (هش رشته‌ی خالی فونت / جمع صفر صدا) هم missing.
// ۳) similarity فقط روی سیگنال‌های «قابل مقایسه» (هر دو طرف واقعی)
//    امتیاز می‌دهد و برای ایجاد لینک، حداقل سیگنال قابل‌مقایسه لازم است.
// ۴) هش مرکبِ کیفیت‌پایین scopeش به clientId/شماره است تا دو دستگاهِ
//    ناشناس هرگز از طریق لایه‌ی ۲ یکی نشوند (ادغام کاذب D1).

const MISSING_SENTINELS = new Set<string>([
  sha256('sinshin-missing-v1'), // کلاینت stage-70+
  sha256('unavailable'), // کلاینت‌های قدیمی (کش JS) — دوره‌ی گذار
])
const DEGENERATE_HASHES = new Set<string>([
  sha256(''), // fonts: هیچ فونتی شناسایی نشد (anti-fingerprinting)
  sha256('0'), // audio: جمع صفر (resistFingerprinting)
])

/** آیا این هش عملاً «بی‌اطلاع» است؟ (نبود/پوچی سیگنال) */
export function isMissingHash(hash: string | null | undefined): boolean {
  if (!hash) return true
  return MISSING_SENTINELS.has(hash) || DEGENERATE_HASHES.has(hash)
}

/** شمار سیگنال‌های هشِ واقعاً موجود (missing نیستند) از ۴ سیگنال اصلی */
export function realSignalCount(s: Pick<SignalLike, 'canvasHash' | 'webglHash' | 'audioHash' | 'fontsHash'>): number {
  let n = 0
  if (!isMissingHash(s.canvasHash)) n++
  if (!isMissingHash(s.webglHash)) n++
  if (!isMissingHash(s.audioHash)) n++
  if (!isMissingHash(s.fontsHash)) n++
  return n
}

/**
 * حداقل سیگنال واقعی برای آنکه لایه‌ی ۲ (هش دقیق) و لایه‌ی ۳ (شباهت)
 * اصلاً معتبر شمرده شوند. زیر این حد، دستگاه «غیرقابل شناسایی» است و
 * فقط clientId می‌تواند آن را پیدا کند.
 */
export const MIN_REAL_HASH_SIGNALS = 2

// ═══ stage-80 — هوش جمعیّتی سیگنال (الگوی Fellegi–Sunter / anonymity-set) ═══
//
// پیشینه (تحقیقِ عمیقِ stage-80): امتیازِ شباهتِ ثابتِ وزن‌دار دو خطای
// شناخته‌شده‌ی صنعت را دارد (Arkose/ShieldLabs: «collision در برابر
// division»): دو دستگاهِ فیزیکیِ هم‌مدل (خروجی iOS روی سخت‌افزار یکسان
// واقعاً یکسان است — یافته‌ی ۳ از استیج ۷۳) با canvas/webgl/audio/fonts
// برابر به آستانه‌ی لینک (۰٫۷) می‌رسند → لینکِ کاذب → crowded-cluster
// (+15 ریسک) + قطعِ پاداشِ معرفی (referral) برای کاربرِ بی‌گناه.
//
// اصولِ الگوبرداری‌شده از پیاده‌سازی‌های پیشرفته:
//  ۱) Fellegi–Sunter (حلقه‌ی اتصالِ احتمالاتیِ رکورد، ۱۹۶۹): وزنِ
//     «توافقِ» هر فیلد باید تابعِ فراوانیِ مقدار در جمعیت باشد — توافقِ
//     مقدارِ کمیاب = شاهدِ قوی؛ توافقِ مقدارِ فراوان = نوفه (همان IDF).
//  ۲) anonymity-set: هنگامی که ده‌ها دستگاه مقدارِ یک سیگنال را شریک‌اند،
//     آن سیگنال «تمییزدهندگی»‌ی نزدیک صفر دارد — صرفِ برابری، نشانه‌ی
//     «یک دستگاه بودن» نیست.
//  ۳) tiered identity (FingerprintJS Pro / Castle): شناسه‌ی قطعی
//     (clientId) از شناسه‌ی احتمالاتی (شباهت) جدا نگه داشته می‌شود و
//     تصمیمِ سخت فقط با هم‌بستگیِ قوی گرفته می‌شود.
//
// رفعِ stage-80: وزنِ هر توافقِ هش‌محور در «آمارِ جمعیتِ همان لحظه» ضرب
// می‌شود (idfFactor): df ≤ 3 (جفتِ واقعی یا خانواده‌ی کوچک) = وزنِ کامل؛
// df بزرگ = سقفِ کسرِ 3/df — جمعیتِ هم‌مدل خودکار تخفیف می‌خورَند و
// لینکِ کاذبِ جمعیت‌محور عملاً غیرممکن می‌شود، بدون آنکه لینکِ واقعیِ
// جفتِ تازه (df=2) یا سردبودنِ دیتابیسِ کوچک آسیب ببیند.

/** سقفِ df که توافق هنوز «کمیاب» شمرده می‌شود — قابل تیون */
export const RARE_DF_CAP = 3

/** فراوانی‌وزنِ سیگنال — ۱ = کمیاب/تمییزدهنده، جمعیتِ بزرگ → تخفیف */
export function idfFactor(df: number): number {
  if (df <= RARE_DF_CAP) return 1
  return Math.min(1, RARE_DF_CAP / df)
}

/** شمارِ ردیف‌های devices که مقدارِ هر هش را شریک‌اند (شامل خودِ ما) */
export interface SignalPopulationStats {
  canvasDf: number
  webglDf: number
  audioDf: number
  fontsDf: number
}

// ── شباهت وزن‌دار ──
// سیگنال‌های GPU-محور وزن بیشتری دارند چون مرورگر/VPN عوض کنی هم ثابت می‌مانند.
const W = {
  canvas: 0.25,
  webgl: 0.25,
  audio: 0.2,
  fonts: 0.15,
  screen: 0.05,
  platform: 0.05,
  tzlang: 0.05,
} as const

export interface SimilarityResult {
  /** مجموع وزن سیگنال‌های برابر (هر دو طرف واقعی) */
  score: number
  /** مجموع وزن سیگنال‌هایی که در هر دو طرف قابل مقایسه‌اند */
  comparableWeight: number
  /** تعداد سیگنال‌های قابل مقایسه */
  comparableCount: number
  /**
   * stage-80 — امتیازِ جمعیت‌وزن‌دار: توافق‌های هش‌محور در idfFactor(df)
   * ضرب می‌شوند؛ بدون stats برابرِ score است (سازگاری‌ی کامل با
   * رفتارِ پیش از ۸۰). سیگنال‌های غیر-هش (screen/platform/tzlang) عمداً
   * بی‌تخفیف می‌مانند — اطلاع‌شان جمعیتی نیست.
   */
  weighted: number
  /** شمارِ هش‌های واقعاً برابر (canvas/webgl/audio/fonts) — شاهدِ GPU */
  agreeingHashes: number
}

/**
 * stage-70 — شباهت فقط روی سیگنال‌های «قابل مقایسه»:
 *  - سیگنال missing (هر طرف) → نه امتیاز، نه شمرده شدن قابل‌مقایسه.
 *  - خروجی علاوه بر score، کیفیت مقایسه را هم برمی‌گرداند تا گاردِ
 *    حداقل سیگنال در لینک‌سازی اعمال شود.
 * stage-80 — پارامتر اختیاری stats: توافق‌های هش‌محور با فراوانیِ مقدار
 * در جمعیت تخفیف می‌خورند (idfFactor). بدون stats رفتار بایت‌به‌بایت
 * همانِ قبل است (weighted === score).
 */
export function signalSimilarity(
  a: SignalLike,
  b: SignalLike,
  stats?: SignalPopulationStats,
): SimilarityResult {
  let score = 0
  let weighted = 0
  let agreeingHashes = 0
  let comparableWeight = 0
  let comparableCount = 0

  const hashPair = (x: string, y: string, w: number, df: number): void => {
    if (isMissingHash(x) || isMissingHash(y)) return // missing ≠ برابر
    comparableWeight += w
    comparableCount++
    if (x === y) {
      score += w
      const fw = w * idfFactor(df)
      weighted += fw
      agreeingHashes++
    }
  }

  hashPair(a.canvasHash, b.canvasHash, W.canvas, stats?.canvasDf ?? 0)
  hashPair(a.webglHash, b.webglHash, W.webgl, stats?.webglDf ?? 0)
  hashPair(a.audioHash, b.audioHash, W.audio, stats?.audioDf ?? 0)
  hashPair(a.fontsHash, b.fontsHash, W.fonts, stats?.fontsDf ?? 0)
  if (a.screen && b.screen && a.screen === b.screen) {
    comparableWeight += W.screen
    comparableCount++
    score += W.screen
    weighted += W.screen
  } else if (a.screen && b.screen) {
    comparableWeight += W.screen
    comparableCount++
  }
  if (a.platform && b.platform) {
    comparableWeight += W.platform
    comparableCount++
    if (a.platform === b.platform) {
      score += W.platform
      weighted += W.platform
    }
  }
  if (a.timezone && b.timezone && a.language && b.language) {
    comparableWeight += W.tzlang
    comparableCount++
    if (a.timezone === b.timezone && a.language === b.language) {
      score += W.tzlang
      weighted += W.tzlang
    }
  }

  return { score, weighted, agreeingHashes, comparableWeight, comparableCount }
}

// ═══ stage-80 — تصمیم‌های سخت: هم‌بستگی + وراثتِ بلاک ═══

/**
 * آستانه‌ی «شاهدِ قوی» برای وراثتِ مسدودی از دستگاهِ مسدود (cluster-block
 * inherit) — بالاتر از آستانه‌ی لینکِ معمولی، با حداقلِ ۳ هشِ برابرِ واقعی
 * و وزنِ جمعیتیِ قوی. مطالعه‌ی ضد-مثبت: دستگاهِ بی‌گناهِ هم‌مدل فقط با
 * هش‌های فراوان (جمعیت) به این سطوح نمی‌رسد.
 */
export const EVADE_MIN_SCORE = 0.85
export const EVADE_MIN_WEIGHTED = 0.5
export const EVADE_MIN_HASH_SIGNALS = 3

/** شاهدِ قویِ «این همان دستگاهِ مسدود است» — دروازه‌ی وراثتِ بلاک */
export function strongEvasionMatch(sim: SimilarityResult): boolean {
  return (
    sim.score >= EVADE_MIN_SCORE &&
    sim.weighted >= EVADE_MIN_WEIGHTED &&
    sim.agreeingHashes >= EVADE_MIN_HASH_SIGNALS &&
    sim.comparableCount >= 4
  )
}

/**
 * فلگ‌های «قوی» — یا جعل‌پذیرند و پشتِ تشخیصِ دومرحله‌ای‌اند (canvas-drift)
 * یا امضای ابزارِ اتوماسیون‌اند (headless-ua). الگوی صنعتیِ graduated
 * response: تصمیمِ سختِ خودکار فقط با «یک شاهدِ قوی»، نه انبارِ شواهدِ
 * ضعیف (low-memory + mobile-no-touch + platform-mismatch + crowded-cluster
 * = ۸۰ روی دستگاهِ بی‌گناهِ قدیمی/عجیب هم جمع می‌شود).
 */
export const STRONG_RISK_FLAGS: ReadonlySet<string> = new Set([
  'headless-ua',
  'canvas-drift',
])

/**
 * آیا این امتیاز/فلگ‌ها «واجدِ مسدودسازیِ خودکار» است؟
 *  - requireStrong=false → رفتارِ پیش از stage-80 (فقط آستانه‌ی امتیاز)
 *  - requireStrong=true (پیش‌فرض) → علاوه بر آستانه، حداقل یک فلگِ قوی
 */
export function autoBlockEligible(
  score: number,
  flags: readonly string[],
  requireStrong: boolean,
): boolean {
  if (score <= 0) return false
  if (!requireStrong) return true
  return flags.some((f) => STRONG_RISK_FLAGS.has(f))
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
 * FP_HASH = sha256(ترتیب مرتب‌شده‌ی همه‌ی سیگنال‌ها + خانواده‌ی مرورگر
 * + «شماره‌ی درخواست‌کننده»).
 * نسخه‌ی مرورگر عمداً حذف است — آپدیت مرورگر نباید هویت دستگاه را عوض کند.
 *
 * stage-70 (D1) — کیفیت پایین: اگر کمتر از MIN_REAL_HASH_SIGNALS سیگنال
 * واقعی باشد، هش مرکبِ عمومی «دو دستگاه ناشناسِ مشابه» را یکی می‌کرد
 * (ادغام کاذب). چنین دستگاهی فقط با scope پایدار شناسایی می‌شود:
 *  - با clientId → همان مرورگر؛
 *  - بدون clientId → همان شماره (ادغام بین‌کاربر ممنوع).
 *
 * ═══ stage-73 (یافته‌های ۳ و ۴) — scope شماره در مسیر «کامل» هم ═══
 *
 * پیشینه: هشِ کاملِ بی‌scope با ایندکس یکتای devices.fingerprint_hash،
 * دو دستگاهِ «فیزیکیِ متفاوت» با مشخصات یکسان (مثلاً دو آیفونِ هم‌مدل/
 * هم‌نسخه در یک شهر: canvas/webgl/audio/fonts و screen/tz/lang/hw/mem/
 * touch/UA همه برابر — خروجی مرورگرهای iOS روی سخت‌افزار یکسان واقعاً
 * یکسان است) را به «یک ردیف مشترک» فشرده می‌کرد. نتیجه: ثبت‌نامِ
 * کاربر دوم به ردیف مالِ کاربر اول می‌خورد → PHONE_LIMIT_BLOCKEDِ کاذب
 * یا آلودگی هویت/خوشه — چون fingerprint وب شناسه‌ی قطعی سخت‌افزار نیست.
 *
 * رفع: شماره‌ی درخواست‌کننده وارد کانونِ هش می‌شود. معنای جدید لایه ۲:
 * «همین سیگنال‌ها + همین شماره» = همان ردیف. یعنی:
 *  • کاربرِ خودِ شماره، بعد از پاک‌شدن storage (clientId تازه) → همان
 *    ردیفش پیدا می‌شود (ادامه‌ی همان تاریخچه/سهمیه)؛
 *  • شماره‌ی «متفاوت» هرگز ردیفِ شماره‌ی دیگر را نمی‌رباید — غریبه‌ای با
 *    سخت‌افزار مشابه، ردیفِ تازه + لینکِ شباهت می‌گیرد (سیگنال نرم، نه
 *    رد قطعی) و متخلفِ پاک‌کننده‌ی storage هم همین‌طور (سیاستِ انتخابیِ
 *    کارفرما: «سخت فقط روی پروفایل مرورگر» + «نرم روی خوشه»).
 * لایه ۱ (clientId) همچنان قوی‌ترین است و مستقل از شماره ردیف را
 * پیدا می‌کند — سهم چند-کاربره روی یک دستگاهِ با-storage دست‌نخورده.
 */
export function compositeFingerprintHash(
  s: DeviceSignals,
  userAgent: string | null,
  phone: string,
): string {
  if (realSignalCount(s) < MIN_REAL_HASH_SIGNALS) {
    const scope = s.clientId ? `cid:${s.clientId}` : `phone:${phone}`
    return sha256(`lowq|${scope}`)
  }
  const canon = [
    `ph:${phone}`,
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
  /** شماره‌های متمایز خوشه (شامل فعلی) — فقط سیگنال ریسک/معرف */
  clusterPhoneCount: number
  /**
   * clientId یکی ولی canvas دو بار پشت‌سرهم عوض شده و webgl/audio ثابت —
   * نشانه‌ی جعلِ فعال (farbling پایدار). stage-70: یک تغییرِ تک‌رویداد
   * (آپدیت مرورگر/درایور GPU) دیگر پرچم نمی‌زند (D3).
   */
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
