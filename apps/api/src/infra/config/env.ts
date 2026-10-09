// ═══════════════════════════════════════════════════════════════
// phase-2 — sinshin-food-delivery — SMS.ir + پوش نوتیفیکیشن + نشان
// مسیر مقصد: apps/api/src/infra/config/env.ts
// وضعیت: جایگزینی کامل فایل موجود (پایه: نسخه‌ی فاز-۱)
// ═══════════════════════════════════════════════════════════════

// src/infra/config/env.ts
import { normalizePhone } from '#/domain/shared/phone'

export type AppEnv = 'development' | 'production' | 'test'

export interface OtpConfig {
  ttlSeconds: number
  cooldownSeconds: number
  maxAttempts: number
  maxPerHourPerPhone: number
  maxPerDayPerPhone: number
}

/**
 * phase-2 — پیامک روی SMS.ir (verify API).
 * قرارداد قدیمی (SMS_BASE_URL / SMS_SENDER + متن آزاد) حذف شد:
 * SMS.ir فقط با «شناسه‌ی قالب + پارامترها» کار می‌کند و URL گزارش
 * را خودش از روی قالب می‌سازد (توکن TOKEN فقط از سمت بک‌اند می‌رود).
 */
export interface SmsConfig {
  provider: 'console' | 'real'
  /** x-api-key پنل SMS.ir */
  apiKey: string
  /** مهلت فراخوانی درگاه (میلی‌ثانیه) */
  timeoutMs: number
  /** شناسه‌ی قالب‌ها — همه از env (هرگز هاردکد نمی‌شوند) */
  templateOtp: number
  /** اختیاری — خالی = همان قالب otp برای پیک هم استفاده می‌شود */
  templateCourierOtp: number | null
  templateDailyReport: number
  templateWeeklyReport: number
  templateHealthAlert: number
}

/** phase-2 — سرویس‌های REST نشان (routing / matrix / reverse) — فقط سمت سرور */
export interface NeshanConfig {
  /** کلید «service» نشان — هرگز وارد باندل وب نمی‌شود */
  serviceApiKey: string
  timeoutMs: number
  /** TTL کش حافظه‌ای برای پاسخ‌های نشان (ثانیه) */
  cacheTtlSeconds: number
}

/** phase-2 — Web Push (VAPID) — سیستم پوش نوتیفیکیشن کاستوم */
export interface PushConfig {
  /** کلید عمومی — base64url (۶۵ بایت، با پیشوند 0x04) */
  vapidPublicKey: string
  /** کلید خصوصی — base64url (۳۲ بایت) */
  vapidPrivateKey: string
  /** شناسه‌ی تماس (mailto:) برای سرپیوش استاندارد VAPID */
  vapidSubject: string
  /** عمر پیام پوش روی سرور پوش مرورگر (ثانیه) */
  ttlSeconds: number
  /** سقف اشتراک پوش فعال هر کاربر — بیشترها غیرفعال می‌شوند */
  maxSubsPerUser: number
}

/** phase-2 — گزارش روزانه/هفتگی + بسته‌ی ZIP + لاگ‌های داکر */
export interface ReportConfig {
  /** عمر توکن لینک گزارش (ساعت) — پیش‌فرض ۲۴ */
  tokenTtlHours: number
  /** سقف جمع لاگ‌های داکر داخل بسته‌ی روزانه (مگابایت) */
  logsMaxMb: number
  /** جمع‌آوری لاگ داکر (نیاز به docker.sock) — خاموش = بسته بدون لاگ */
  dockerLogsEnabled: boolean
  /** بعد از آرشیو، لاگ کانتینرها truncate شود (پاک‌سازی سرور) */
  dockerLogsTruncate: boolean
  /** مسیر سوکت داکر داخل کانتینر */
  dockerSocket: string
}

export interface GatewayConfig {
  mode: 'mock' | 'direct' | 'indirect'
  zarinpalMerchantId: string
  /** رارد ۴۵ — سرویس تست رسمی زرین‌پال (sandbox.zarinpal.com)؛ در production ممنوع */
  zarinpalSandbox: boolean
  payirApiKey: string
  sepTerminalId: string
  mellatTerminalId: string
  mellatUserName: string
  mellatUserPassword: string
  /** رارد ۴۵ — مهلت هر فراخوانی HTTP به درگاه‌ها (میلی‌ثانیه) */
  timeoutMs: number
}

export interface RestaurantLocationConfig {
  lat: number
  lng: number
}

export interface DeviceConfig {
  linkThreshold: number
  autoblockScore: number
  referralBlockAfter: number
  similarityWindowDays: number
}

/** round-19 — دیده‌بان سلامت: پیامک هنگام قطعی/برگشت db/redis/uploads */
export interface HealthAlertConfig {
  /** گیرنده‌ها؛ خالی = پشتیبان (SUPER_ADMIN_PHONES) */
  phones: string[]
  /** فاصلهٔ سنجش (ثانیه) */
  everySeconds: number
  /** یادآوری قطعیِ پایدار (دقیقه) */
  repeatMinutes: number
}

/** رارد ۴۵ — پالیسی‌های دروازه‌ی جغرافیایی (منابع بازه‌های IP) */
export interface GeoPolicyConfig {
  /** مهلت هر منبع (میلی‌ثانیه) */
  fetchTimeoutMs: number
  /** فاصله‌ی تلاش مجدد بعد از شکست همه‌ی منابع (میلی‌ثانیه) */
  retryMs: number
}

/** رارد ۴۵ — پالیسی‌های مغایرت‌گیری مالی (خواندن یک‌جای پرچم‌ها) */
export interface ReconcileConfig {
  /** چک‌هایی که اصلاح خودکار فعال دارند (پیش‌فرض هیچ‌کدام — فقط گزارش) */
  autoChecks: ReadonlySet<string>
  /** پنجره‌ی چک برداشت کیف پول (روز) */
  r3WindowDays: number
}

const DEV_JWT_SECRET = 'dev-only-insecure-secret'

/**
 * کانفیگ کلاس‌محور — شکست سریع در محیط عملیاتی.
 * پیش‌فرض‌ها برای اجرای بی‌دردسرِ محیط توسعه روی سیستم (localhost) چیده شده‌اند؛
 * داخل Docker با env_file مقادیر سرویس‌ها (postgres/redis) بازنویسی می‌شوند.
 *
 * phase-1: assertProdInvariants — جای‌نگهدارها، SMS_PROVIDER=console،
 * GATEWAY_MODE=mock، SUPER_ADMIN_PHONES خالی، SITE_URL غیر https و
 * UPLOAD_DIR نسبی بوت را می‌کُشند.
 * phase-2: کلیدهای VAPID و شناسه‌ی قالب‌های SMS.ir هم به همین گاردها اضافه شدند.
 */
export class AppConfig {
  readonly env: AppEnv
  readonly isProd: boolean
  readonly port: number
  readonly host: string
  readonly databaseUrl: string
  readonly redisUrl: string
  /** رارد ۴۵ — سقف اتصال‌های هم‌زمان هر نمونه‌ی API به پستگرس */
  readonly dbPoolMax: number
  readonly jwtSecret: string
  readonly siteUrl: string
  readonly uploadDir: string

  readonly sessionTtlDays: number
  readonly accessTokenTtlMinutes: number

  readonly superAdminPhones: string[]
  readonly deviceEnforcement: boolean
  readonly maxDevicesPerUser: number

  readonly sms: SmsConfig
  readonly otp: OtpConfig
  readonly gateway: GatewayConfig
  readonly device: DeviceConfig
  readonly healthAlert: HealthAlertConfig

  /** phase-2 — نشان / پوش / گزارش */
  readonly neshan: NeshanConfig
  readonly push: PushConfig
  readonly reports: ReportConfig

  readonly couponScanTime: string
  readonly couponNudgeTime: string

  readonly geoBypassIps: string[]

  /** رارد ۴۵ — پالیسی‌های دروازه‌ی جغرافیایی */
  readonly geo: GeoPolicyConfig

  /** رارد ۴۵ — درصد سود معرف از پرداخت آنلاینِ غذاها (۰ تا ۱۰۰) */
  readonly referralPercent: number

  /** رارد ۴۵ — پالیسی‌های مغایرت‌گیری مالی */
  readonly reconcile: ReconcileConfig

  /** round-35 — آدرس سرویس مترجم آفلاین (NLLB) در شبکه داخلی compose */
  readonly translatorUrl: string
  /** phase-1/M15 — راز مشترک api ↔ مترجم (هدر x-translator-token) */
  readonly translatorToken: string

  /** round-13 — مختصات رستوران (مبدأ محاسبه‌ی هزینه‌ی ارسال) از env */
  readonly restaurantLocation: RestaurantLocationConfig | null

  constructor(source: Record<string, string | undefined> = Bun.env) {
    const str = (key: string, fallback = ''): string => {
      const v = source[key]?.trim()
      return v === undefined || v === '' ? fallback : v
    }
    const num = (key: string, fallback: number): number => {
      const n = Number(source[key])
      return Number.isFinite(n) && n > 0 ? n : fallback
    }
    const int = (key: string, fallback: number): number => {
      const raw = source[key]?.trim()
      if (raw === undefined || raw === '') return fallback
      const n = Number(raw)
      return Number.isInteger(n) && n > 0 ? n : fallback
    }
    const bool = (key: string, fallback: boolean): boolean => {
      const v = source[key]?.trim().toLowerCase()
      if (v === 'on' || v === 'true' || v === '1') return true
      if (v === 'off' || v === 'false' || v === '0') return false
      return fallback
    }
    /** شناسه‌ی قالب SMS.ir — عدد صحیح مثبت یا null (قالب اختیاری) */
    const templateId = (key: string): number | null => {
      const raw = source[key]?.trim()
      if (raw === undefined || raw === '') return null
      const n = Number(raw)
      return Number.isInteger(n) && n > 0 ? n : null
    }
    /** لیست شمارهٔ موبایل جدا شده با کاما — نرمال‌شده، بدون تهی */
    const phoneList = (key: string): string[] =>
      str(key)
        .split(',')
        .map((p) => normalizePhone(p))
        .filter((p): p is string => p !== null)

    const envRaw = str('APP_ENV', 'development').toLowerCase()
    this.env = (['development', 'production', 'test'] as const).includes(
      envRaw as AppEnv,
    )
      ? (envRaw as AppEnv)
      : 'development'
    this.isProd = this.env === 'production'

    this.port = num('PORT', 3000)
    this.host = str('HOST', '0.0.0.0')
    this.databaseUrl = str(
      'DATABASE_URL',
      'postgres://sinshin:sinshin_local@localhost:5432/sinshin',
    )
    this.redisUrl = str('REDIS_URL', 'redis://localhost:6379')
    this.dbPoolMax = num('DB_POOL_MAX', 10)

    this.jwtSecret = str('JWT_SECRET', DEV_JWT_SECRET)
    this.siteUrl = str('SITE_URL', 'http://localhost:3001').replace(/\/+$/, '')
    this.uploadDir = str('UPLOAD_DIR', './uploads')

    this.sessionTtlDays = num('SESSION_TTL_DAYS', 30)
    this.accessTokenTtlMinutes = num('ACCESS_TOKEN_TTL_MINUTES', 15)

    this.superAdminPhones = phoneList('SUPER_ADMIN_PHONES')

    const enforcementRaw = (source['DEVICE_ENFORCEMENT'] ?? '').trim()
    this.deviceEnforcement =
      enforcementRaw !== '' ? bool('DEVICE_ENFORCEMENT', true) : this.isProd
    this.maxDevicesPerUser = num('MAX_DEVICES_PER_USER', 5)

    // ── phase-2 — SMS.ir ──
    const smsProvider = str('SMS_PROVIDER', 'console').toLowerCase()
    this.sms = {
      provider: smsProvider === 'real' ? 'real' : 'console',
      apiKey: str('SMS_IR_API_KEY'),
      timeoutMs: num('SMS_TIMEOUT_MS', 10_000),
      templateOtp: templateId('SMS_TEMPLATE_ID_OTP') ?? 0,
      templateCourierOtp: templateId('SMS_TEMPLATE_ID_COURIER_OTP'),
      templateDailyReport: templateId('SMS_TEMPLATE_ID_DAILY') ?? 0,
      templateWeeklyReport: templateId('SMS_TEMPLATE_ID_WEEKLY') ?? 0,
      templateHealthAlert: templateId('SMS_TEMPLATE_ID_HEALTH') ?? 0,
    }

    // نرخ‌ها طبق قرارداد فرانت: ۶۰ ثانیه فاصله، ۳ تلاش
    this.otp = {
      ttlSeconds: num('OTP_TTL_SECONDS', 120),
      cooldownSeconds: num('OTP_COOLDOWN_SECONDS', 60),
      maxAttempts: num('OTP_MAX_ATTEMPTS', 3),
      maxPerHourPerPhone: num('OTP_MAX_PER_HOUR', 5),
      maxPerDayPerPhone: num('OTP_MAX_PER_DAY', 20),
    }

    const gwMode = str('GATEWAY_MODE', 'mock').toLowerCase()
    this.gateway = {
      mode: gwMode === 'direct' || gwMode === 'indirect' ? gwMode : 'mock',
      zarinpalMerchantId: str('ZARINPAL_MERCHANT_ID'),
      zarinpalSandbox: bool('ZARINPAL_SANDBOX', false),
      payirApiKey: str('PAYIR_API_KEY'),
      sepTerminalId: str('SEP_TERMINAL_ID'),
      mellatTerminalId: str('MELLAT_TERMINAL_ID'),
      mellatUserName: str('MELLAT_USERNAME'),
      mellatUserPassword: str('MELLAT_PASSWORD'),
      timeoutMs: num('PAYMENT_TIMEOUT_MS', 15_000),
    }

    this.device = {
      linkThreshold: Number(source['DEVICE_LINK_THRESHOLD']) || 0.7,
      autoblockScore: Number(source['DEVICE_AUTOBLOCK_SCORE']) || 80,
      referralBlockAfter: Number(source['DEVICE_REFERRAL_BLOCK_AFTER']) || 3,
      similarityWindowDays: Number(source['DEVICE_SIMILARITY_WINDOW_DAYS']) || 7,
    }

    // round-19 — بدون HEALTH_ALERT_PHONES، ادمین‌های اصلی گیرنده‌اند
    const alertPhones = phoneList('HEALTH_ALERT_PHONES')
    this.healthAlert = {
      phones: alertPhones.length > 0 ? alertPhones : this.superAdminPhones,
      everySeconds: num('HEALTH_ALERT_EVERY_SECONDS', 60),
      repeatMinutes: num('HEALTH_ALERT_REPEAT_MINUTES', 60),
    }

    // ── phase-2 — نشان (سرویس‌ها؛ فقط سمت سرور) ──
    this.neshan = {
      serviceApiKey: str('NESHAN_SERVICE_API_KEY'),
      timeoutMs: num('NESHAN_TIMEOUT_MS', 10_000),
      cacheTtlSeconds: num('NESHAN_CACHE_TTL_SECONDS', 300),
    }

    // ── phase-2 — Web Push (VAPID) ──
    this.push = {
      vapidPublicKey: str('VAPID_PUBLIC_KEY'),
      vapidPrivateKey: str('VAPID_PRIVATE_KEY'),
      vapidSubject: str('VAPID_SUBJECT', 'mailto:admin@sinshin-foodpark.ir'),
      ttlSeconds: num('PUSH_TTL_SECONDS', 86_400),
      maxSubsPerUser: int('PUSH_MAX_SUBS_PER_USER', 5),
    }

    // ── phase-2 — گزارش‌ها + لاگ داکر ──
    this.reports = {
      tokenTtlHours: num('REPORT_TOKEN_TTL_HOURS', 24),
      logsMaxMb: num('REPORT_LOGS_MAX_MB', 20),
      dockerLogsEnabled: bool('DOCKER_LOGS_ENABLED', true),
      dockerLogsTruncate: bool('DOCKER_LOGS_TRUNCATE', true),
      dockerSocket: str('DOCKER_SOCKET', '/var/run/docker.sock'),
    }

    this.couponScanTime = str('COUPON_SCAN_TIME', '02:00')
    this.couponNudgeTime = str('COUPON_NUDGE_TIME', '11:00')

    this.geoBypassIps = str('GEO_BYPASS_IPS')
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p.length > 0)

    this.geo = {
      fetchTimeoutMs: num('GEO_FETCH_TIMEOUT_MS', 10_000),
      retryMs: num('GEO_RETRY_MINUTES', 15) * 60_000,
    }

    const referralRaw = Number(source['REFERRAL_PERCENT'])
    this.referralPercent =
      Number.isInteger(referralRaw) && referralRaw >= 0 && referralRaw <= 100
        ? referralRaw
        : 10

    const autoChecks = new Set<string>()
    for (let i = 1; i <= 10; i++) {
      if (bool(`RECONCILE_AUTO_R${i}`, false)) autoChecks.add(`R${i}`)
    }
    const r3Raw = Number(source['RECONCILE_R3_WINDOW_DAYS'])
    this.reconcile = {
      autoChecks,
      r3WindowDays: Number.isInteger(r3Raw) && r3Raw >= 1 ? r3Raw : 120,
    }

    this.translatorUrl = str('TRANSLATOR_URL', 'http://translator:8300').replace(/\/+$/, '')
    this.translatorToken = str('TRANSLATOR_TOKEN')

    const lat = Number(source['RESTAURANT_LAT'])
    const lng = Number(source['RESTAURANT_LNG'])
    this.restaurantLocation =
      Number.isFinite(lat) && Number.isFinite(lng) &&
      Math.abs(lat) <= 90 && Math.abs(lng) <= 180
        ? { lat, lng }
        : null

    // ── شکست سریع — کرش بوت عمدی است ──
    this.assertProdInvariants()
  }

  // ═══════════ شکست سریع در محیط عملیاتی — کرش بوت عمدی است ═══════════
  private assertProdInvariants(): void {
    if (!this.isProd) return

    const problems: string[] = []

    // ── JWT ──
    if (this.jwtSecret.length < 32) {
      problems.push('JWT_SECRET باید حداقل ۳۲ کاراکتر باشد (openssl rand -base64 48).')
    }
    const placeholders = [DEV_JWT_SECRET, 'REPLACE_ME_WITH_RANDOM_48BYTE_SECRET']
    if (placeholders.includes(this.jwtSecret)) {
      problems.push('JWT_SECRET مقدار placeholder/شناخته‌شده است — مقدار تصادفی واقعی بگذار.')
    }

    // ── SMS.ir (phase-2): قالب‌ها اجباری‌اند — پیامک بدون قالب عملاً غیرممکن است ──
    if (this.sms.provider !== 'real') {
      problems.push('SMS_PROVIDER=console در production ممنوع است (کد ورود پیامک نمی‌شود).')
    } else {
      if (!this.sms.apiKey) {
        problems.push('SMS_PROVIDER=real اما SMS_IR_API_KEY خالی است (کلید پنل SMS.ir).')
      }
      const missing: string[] = []
      if (this.sms.templateOtp === 0) missing.push('SMS_TEMPLATE_ID_OTP')
      if (this.sms.templateDailyReport === 0) missing.push('SMS_TEMPLATE_ID_DAILY')
      if (this.sms.templateWeeklyReport === 0) missing.push('SMS_TEMPLATE_ID_WEEKLY')
      if (this.sms.templateHealthAlert === 0) missing.push('SMS_TEMPLATE_ID_HEALTH')
      if (missing.length > 0) {
        problems.push(
          `شناسه‌ی قالب‌های SMS.ir ناقص است: ${missing.join(' , ')} — همه باید در .env باشند.`,
        )
      }
      if (this.sms.templateCourierOtp === null) {
        // هشدار سخت نیست — fallback به قالب otp کار می‌کند؛ فقط لاگ
        console.warn(
          '[config] SMS_TEMPLATE_ID_COURIER_OTP تنظیم نشده — پیامک OTP پیک از قالب otp استفاده می‌کند.',
        )
      }
    }

    // ── پوش نوتیفیکیشن (phase-2): بدون کلید VAPID پوش کار نمی‌کند ──
    if (!this.push.vapidPublicKey || !this.push.vapidPrivateKey) {
      problems.push(
        'کلیدهای VAPID خالی‌اند — با «bun scripts/generate-vapid-keys.ts» بساز و در .env بگذار (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).',
      )
    } else if (
      this.push.vapidPublicKey.length < 40 || this.push.vapidPrivateKey.length < 30
    ) {
      problems.push('کلیدهای VAPID ساختار معتبر ندارند — دوباره با اسکریپت بساز.')
    }

    // ── درگاه پرداخت: باگ 🔴۳ — سفارش رایگان با MOCK ──
    if (this.gateway.mode === 'mock') {
      problems.push('GATEWAY_MODE=mock در production ممنوع است (پرداخت صفر تومانی).')
    }

    // ── رارد ۴۵ — سندباکس زرین‌پال در production یعنی پرداخت آزمایشی ──
    if (this.gateway.zarinpalSandbox) {
      problems.push('ZARINPAL_SANDBOX در production ممنوع است (پرداخت سندباکس واقعی نیست).')
    }

    // ── ادمین ──
    if (this.superAdminPhones.length === 0) {
      problems.push('SUPER_ADMIN_PHONES خالی است — دسترسی پنل از دست می‌رود.')
    }

    // ── HTTPS ──
    if (!this.siteUrl.startsWith('https://')) {
      problems.push(`SITE_URL باید https باشد (فعلی: ${this.siteUrl}).`)
    }

    // ── آپلود ──
    if (!this.uploadDir.startsWith('/')) {
      problems.push('UPLOAD_DIR باید مسیر مطلق باشد (مثلاً /data/uploads).')
    }

    // نکته: کلید نشان (NESHAN_SERVICE_API_KEY) و docker.sock «اختیاری»‌اند —
    // بدون نشان سایت با فاصله‌ی هوایی کار می‌کند؛ بدون سوکت، بسته‌ی روزانه
    // بدون فایل لاگ ارسال می‌شود. بوت هرگز به‌خاطر آن‌ها نمی‌میرد.

    if (problems.length) {
      throw new Error(
        '[config] production fail-fast — این مقادیر قبل از بوت درست شوند:\n' +
        problems.map((p) => `  • ${p}`).join('\n'),
      )
    }
  }

  isSuperAdmin(phone: string): boolean {
    return this.superAdminPhones.includes(phone)
  }
}
