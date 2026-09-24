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

export interface SmsConfig {
  provider: 'console' | 'real'
  baseUrl: string
  apiKey: string
  sender: string
}

export interface GatewayConfig {
  mode: 'mock' | 'direct' | 'indirect'
  zarinpalMerchantId: string
  zarinpalCallback: string
  payirApiKey: string
  sepTerminalId: string
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
  /** گیرنده‌ها؛ خالی = fallback به SUPER_ADMIN_PHONES */
  phones: string[]
  /** فاصلهٔ سنجش (ثانیه) */
  everySeconds: number
  /** یادآوری قطعیِ پایدار (دقیقه) */
  repeatMinutes: number
}

const DEV_JWT_SECRET = 'dev-only-insecure-secret'

/**
 * کانفیگ کلاس‌محور — fail-fast در production.
 * پیش‌فرض‌ها برای اجرای بی‌دردسر dev روی سیستم (localhost) چیده شده‌اند؛
 * داخل Docker با env_file مقادیر سرویس‌ها (postgres/redis) override می‌شوند.
 *
 * phase-1: assertProdInvariants — قبلاً فقط DEV-JWT چک می‌شد؛ حالا
 * placeholder ها، SMS_PROVIDER=console (باگ 🔴۱)، GATEWAY_MODE=mock (باگ 🔴۳)،
 * SUPER_ADMIN_PHONES خالی، SITE_URL غیر https و UPLOAD_DIR نسبی هم بوت را می‌کُشند.
 */
export class AppConfig {
  readonly env: AppEnv
  readonly isProd: boolean
  readonly port: number
  readonly host: string
  readonly logLevel: string

  readonly databaseUrl: string
  readonly redisUrl: string
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

  readonly couponScanTime: string
  readonly couponNudgeTime: string

  readonly geoBypassIps: string[]

  /** round-13 — مختصات رستوران (مبدأ محاسبه‌ی هزینه‌ی ارسال) از env؛ فقط وقتی هر دو مقدار معتبر باشند */
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
    const bool = (key: string, fallback: boolean): boolean => {
      const v = source[key]?.trim().toLowerCase()
      if (v === 'on' || v === 'true' || v === '1') return true
      if (v === 'off' || v === 'false' || v === '0') return false
      return fallback
    }
    /** لیست شمارهٔ موبایل جدا شده با کاما — نرمال‌شده، بدون تهی (SUPER_ADMIN و HEALTH_ALERT) */
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
    this.logLevel = str('LOG_LEVEL', this.isProd ? 'info' : 'debug')

    this.databaseUrl = str(
      'DATABASE_URL',
      'postgres://sinshin:sinshin_local@localhost:5432/sinshin',
    )
    this.redisUrl = str('REDIS_URL', 'redis://localhost:6379')

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

    const smsProvider = str('SMS_PROVIDER', 'console').toLowerCase()
    this.sms = {
      provider: smsProvider === 'real' ? 'real' : 'console',
      baseUrl: str('SMS_BASE_URL'),
      apiKey: str('SMS_API_KEY'),
      sender: str('SMS_SENDER'),
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
      zarinpalCallback: str('ZARINPAL_CALLBACK'),
      payirApiKey: str('PAYIR_API_KEY'),
      sepTerminalId: str('SEP_TERMINAL_ID'),
    }

    this.device = {
      linkThreshold: Number(source['DEVICE_LINK_THRESHOLD']) || 0.7,
      autoblockScore: Number(source['DEVICE_AUTOBLOCK_SCORE']) || 80,
      referralBlockAfter: Number(source['DEVICE_REFERRAL_BLOCK_AFTER']) || 3,
      similarityWindowDays: Number(source['DEVICE_SIMILARITY_WINDOW_DAYS']) || 7,
    }

    // round-19 — بدون HEALTH_ALERT_PHONES، ادمین‌های اصلی گیرنده‌اند (بدون کانفیگ اضافه)
    const alertPhones = phoneList('HEALTH_ALERT_PHONES')
    this.healthAlert = {
      phones: alertPhones.length > 0 ? alertPhones : this.superAdminPhones,
      everySeconds: num('HEALTH_ALERT_EVERY_SECONDS', 60),
      repeatMinutes: num('HEALTH_ALERT_REPEAT_MINUTES', 60),
    }

    this.couponScanTime = str('COUPON_SCAN_TIME', '02:00')
    this.couponNudgeTime = str('COUPON_NUDGE_TIME', '11:00')

    this.geoBypassIps = str('GEO_BYPASS_IPS')
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p.length > 0)

    // round-13 — RESTAURANT_LAT / RESTAURANT_LNG — مبدأ ناحیه‌های ارسال.
    // هر دو باید finite و در بازه‌ی معتبر باشند؛ وگرنه null (می‌رود سراغ تنظیمات DB).
    const lat = Number(source['RESTAURANT_LAT'])
    const lng = Number(source['RESTAURANT_LNG'])
    this.restaurantLocation =
      Number.isFinite(lat) && Number.isFinite(lng) &&
      Math.abs(lat) <= 90 && Math.abs(lng) <= 180
        ? { lat, lng }
        : null

    // ── phase-1: جایگزین چک قبلی (که فقط DEV-JWT می‌گرفت) ──
    this.assertProdInvariants()
  }

  // ═══════════ phase-1: production fail-fast — کرش بوت عمدی است ═══════════
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

    // ── SMS: باگ 🔴۱ — کد OTP در پاسخ API ──
    if (this.sms.provider !== 'real') {
      problems.push('SMS_PROVIDER=console در production ممنوع است (کد ورود پیامک نمی‌شود).')
    } else if (!this.sms.baseUrl || !this.sms.apiKey || !this.sms.sender) {
      problems.push('SMS_PROVIDER=real اما SMS_BASE_URL / SMS_API_KEY / SMS_SENDER ناقص‌اند.')
    }

    // ── درگاه پرداخت: باگ 🔴۳ — سفارش رایگان با MOCK ──
    if (this.gateway.mode === 'mock') {
      problems.push('GATEWAY_MODE=mock در production ممنوع است (پرداخت صفر تومانی).')
    }

    // ── ادمین ──
    if (this.superAdminPhones.length === 0) {
      problems.push('SUPER_ADMIN_PHONES خالی است — دسترسی پنل از دست می‌رود.')
    }

    // ── HTTPS: کوکی امن و callback درگاه‌ها (فاز ۲) ──
    if (!this.siteUrl.startsWith('https://')) {
      problems.push(`SITE_URL باید https باشد (فعلی: ${this.siteUrl}).`)
    }

    // ── آپلود ──
    if (!this.uploadDir.startsWith('/')) {
      problems.push('UPLOAD_DIR باید مسیر مطلق باشد (مثلاً /data/uploads).')
    }

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