// ═══════════════════════════════════════════════════════════════
// phase-2 — sinshin-food-delivery — SMS.ir + پوش نوتیفیکیشن + نشان
// مسیر مقصد: apps/api/src/infra/config/env.ts
// وضعیت: جایگزینی کامل فایل موجود (پایه: نسخه‌ی فاز-۱)
// ═══════════════════════════════════════════════════════════════

// ═══ stage-67 — ویرایش نقطه‌ای: نرمال‌سازی زمان‌های کرون کوپن ═══
// قبلاً مقدار خراب (مثل COUPON_NUDGE_TIME=14:00 یا «99» خام) بی‌صدا
// می‌گذشت و جاب یادآور «هرگز» ارسال نمی‌کرد (ددلاین ۱۳:۰۰ تهران در
// خود جاب است). حالا: قالب HH:MM چک می‌شود؛ یادآورِ ≥ ۱۳:۰۰ با
// هشدارِ پرصدای بوت به ۱۱:۰۰ برمی‌گردد؛ اسکنِ دیرتر از یادآور با
// هشدار به ۰۲:۰۰ برمی‌گردد (ساعتِ ارسالِ امروز گذشته — ردیف مرده نساز).

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
  /** stage-60 — سقف شماره‌های متمایزِ مجاز برای هر دستگاه؛ ۰ = خاموش.
   *  stage-62 — پیش‌فرض ۱: هر دستگاه (ویندوز/اندروید/اپل) فقط یک ثبت‌نام؛
   *  ورود با شماره‌های «از قبل ثبت‌نام‌شده» همیشه آزاد است (گارد فقط در
   *  مسیر کاربرِ جدید فعال می‌شود). */
  maxPhonesPerDevice: number
  /**
   * stage-80 — الگوی graduated response: مسدودسازیِ خودکار فقط با
   * «یک فلگِ قوی» (canvas-drift دومرحله‌ای / headless-ua) فعال می‌شود؛
   * انبارِ شواهدِ ضعیف (low-memory + mobile-no-touch + platform-mismatch
   * + crowded-cluster = ۸۰) فقط پرچمِ بازبینی می‌ماند (AUTO_BLOCK_DEFERRED).
   * false = رفتارِ پیش از ۸۰ (فقط آستانه‌ی امتیاز).
   */
  autoblockRequireStrong: boolean
  /**
   * stage-80 — وراثتِ مسدودی (cluster-block-inherit): ثبت‌نامِ موفق از
   * ردیفِ تازه‌ای که «به‌شدت و با وزنِ جمعیتیِ قوی» به دستگاهِ مسدود
   * می‌خورد (مکانیسمِ فرار: پاک‌کردن storage + تغییر جزئی FP) ⇒ همان
   * ردیفِ تازه هم بلاک می‌شود (ثبت‌نام کامل، دستگاه مرده — همان فلسفه‌ی
   * auto-block/permit-burn). سوپاپِ رسمیِ آزادسازی: مجوزِ ۷۹.
   * false = خاموش (رفتارِ پیش از ۸۰).
   */
  clusterBlockInherit: boolean
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
  /** Payment initiation window in minutes; expiry still requires PSP verification. */
  readonly pendingOrderExpiryMinutes: number
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
      // stage-58 — پی‌ایر حذف شد (PAYIR_API_KEY دیگر خوانده نمی‌شود)؛
      // درگاه‌های پشتیبانی‌شده: ملت/زرین‌پال/سامان
      sepTerminalId: str('SEP_TERMINAL_ID'),
      mellatTerminalId: str('MELLAT_TERMINAL_ID'),
      mellatUserName: str('MELLAT_USERNAME'),
      mellatUserPassword: str('MELLAT_PASSWORD'),
      timeoutMs: num('PAYMENT_TIMEOUT_MS', 15_000),
    }

    // Invalid durations must not immediately expire orders or disable the
    // deadline with Infinity. Limit the configurable window to one day.
    const pendingExpiry = Number(source['PENDING_ORDER_EXPIRY_MINUTES']?.trim())
    this.pendingOrderExpiryMinutes = Number.isInteger(pendingExpiry) && pendingExpiry >= 1 && pendingExpiry <= 1440
      ? pendingExpiry : 10

    // stage-60 — سقف شماره‌های هر دستگاه؛ الگوی Number(x) || default عددِ صفر
    // را می‌بلعد، پس جداگانه parse می‌شود. stage-62 — پیش‌فرض ۱:
    // هر دستگاه فقط یک ثبت‌نام (لاگین شماره‌های موجود همیشه آزاد)؛
    // خالی/NaN/منفی → پیش‌فرض ۱، صفر → خاموش
    const maxPhonesRaw = source['DEVICE_MAX_PHONES_PER_DEVICE']?.trim()
    const maxPhones = maxPhonesRaw ? Number(maxPhonesRaw) : NaN
    this.device = {
      linkThreshold: Number(source['DEVICE_LINK_THRESHOLD']) || 0.7,
      autoblockScore: Number(source['DEVICE_AUTOBLOCK_SCORE']) || 80,
      referralBlockAfter: Number(source['DEVICE_REFERRAL_BLOCK_AFTER']) || 3,
      similarityWindowDays: Number(source['DEVICE_SIMILARITY_WINDOW_DAYS']) || 7,
      maxPhonesPerDevice: Number.isFinite(maxPhones) && maxPhones >= 0 ? maxPhones : 1,
      // stage-80 — پیش‌فرضِ روشن: هر دو به‌سختی تصمیمِ سخت می‌گیرند؛ false = برگشتِ رفتارِ قبل
      autoblockRequireStrong: bool('DEVICE_AUTOBLOCK_REQUIRE_STRONG', true),
      clusterBlockInherit: bool('DEVICE_CLUSTER_BLOCK_INHERIT', true),
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

    // stage-67 — نرمال‌سازی زمان‌های کرون کوپن (کامنت سربرگ):
    //  • قالب HH:MM نبود → پیش‌فرض + هشدار
    //  • یادآور ≥ ۱۳:۰۰ → ۱۱:۰۰ + هشدار (ددلاین ۱۳ در جاب یادآور است؛
    //    مقدار بزرگ‌تر یعنی «هرگز ارسال نشو» — قبلاً بی‌صدا بود)
    //  • اسکن ≥ یادآور → ۰۲:۰۰ + هشدار (نامزدهای امروز دیرتر از ارسال
    //    ساخته می‌شدند و هیچ‌وقت فرستاده نمی‌شدند — ردیف مرده)
    this.couponScanTime = normalizeDailyTime(
      str('COUPON_SCAN_TIME', '02:00'),
      '02:00',
      'COUPON_SCAN_TIME',
    )
    let nudgeTime = normalizeDailyTime(
      str('COUPON_NUDGE_TIME', '11:00'),
      '11:00',
      'COUPON_NUDGE_TIME',
    )
    const nudgeHour = Number.parseInt(nudgeTime.slice(0, 2), 10)
    if (nudgeHour >= 13) {
      console.warn(
        `[env] COUPON_NUDGE_TIME="${nudgeTime}" بعد از ددلاین ۱۳:۰۰ تهران است — ` +
          `یادآور هرگز ارسال نمی‌شد؛ به "11:00" برگشت (stage-67).`,
      )
      nudgeTime = '11:00'
    }
    if (this.couponScanTime >= nudgeTime) {
      // stage-72 (P2-۱۸) — قبلاً scan فقط به '02:00' ریست می‌شد؛ وقتی
      // NUDGE_TIME ≤ 02:00 بود این ریست «بی‌اثر» بود (scan همچنان بعد از
      // nudge می‌ماند) و نامزدها هرگز same-day ارسال نمی‌شدند. حالا scan
      // واقعاً قبل از nudge می‌نشیند (۳۰ دقیقه قبل، کف ۰۰:۰۰)؛ فقط اگر خودِ
      // nudge آن‌قدر زود باشد که هیچ scanای نمی‌تواند قبلش باشد (≤ ۰۰:۳۰)،
      // nudge به پیش‌فرض برمی‌گردد.
      if (nudgeTime <= '00:30') {
        console.warn(
          `[env] COUPON_NUDGE_TIME="${nudgeTime}" آن‌قدر زود است که اسکنِ همان روز قبلش ممکن نیست؛ ` +
            `به "11:00" برگشت (stage-72).`,
        )
        nudgeTime = '11:00'
      } else {
        const nudgeMinutes =
          Number.parseInt(nudgeTime.slice(0, 2), 10) * 60 + Number.parseInt(nudgeTime.slice(3, 5), 10)
        const scanMinutes = Math.max(0, nudgeMinutes - 30)
        const scanTime = `${String(Math.floor(scanMinutes / 60)).padStart(2, '0')}:${String(scanMinutes % 60).padStart(2, '0')}`
        console.warn(
          `[env] COUPON_SCAN_TIME="${this.couponScanTime}" بعد از COUPON_NUDGE_TIME="${nudgeTime}" است — ` +
            `نامزدهای امروز بعد از ارسال ساخته می‌شدند و فرستاده نمی‌شدند؛ اسکن به "${scanTime}" برگشت (stage-72).`,
        )
        this.couponScanTime = scanTime
      }
    }
    this.couponNudgeTime = nudgeTime

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
// ── stage-67 — هلپر نرمال‌سازی «HH:MM» برای زمان‌های کرون روزانه ──
// قالب درست → همان مقدار؛ خراب/خالی → پیش‌فرض با هشدار پرصدا (بوت).
// مقایسه‌ی رشته‌ای HH:MM صفر-پَد شده ترتیب زمانی درست می‌دهد.
const DAILY_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

function normalizeDailyTime(raw: string, fallback: string, envKey: string): string {
  const v = raw.trim()
  if (DAILY_TIME_RE.test(v)) return v
  console.warn(
    `[env] ${envKey}="${raw}" قالب HH:MM ندارد (مثال درست: "11:00") — ` +
      `پیش‌فرض "${fallback}" استفاده می‌شود (stage-67).`,
  )
  return fallback
}
