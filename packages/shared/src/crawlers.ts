// packages/shared/src/crawlers.ts

/**
 * سئو-۱: معافیت کرالرهای معتبر از دروازه‌ی جغرافیایی «فقط ایران».
 *
 * چرا؟ ربات‌های گوگل/بینگ از IPهای غیرایرانی کرال می‌کنند؛ بدون معافیت،
 * هر URL سایت برایشان ریدایرکت به /geo-blocked است → هیچ صفحه‌ای ایندکس
 * نمی‌شود. این تابع در «هر دو دروازه» استفاده می‌شود تا یک منبع حقیقت
 * داشته باشیم:
 *   • apps/web  src/server/geoGate.ts  (دروازه‌ی SSR — HTML صفحات)
 *   • apps/api  src/http/hooks/geo-gate.ts (هوک onRequest — /api/* برای رندر
 *     سمت کلاینتِ کرالرها، مثل Googlebot Web Rendering Service)
 *
 * User-Agent فقط یک نشانه‌ی قابل جعل است، نه تأیید هویت ربات. معافیت
 * جغرافیایی با isCrawlerGeoExemptRequest به خواندن محتوای عمومی محدود
 * می‌شود؛ مسیرهای خصوصی و تمام نوشتن‌ها همچنان گیت جغرافیایی دارند.
 * احراز هویت و مجوزهای API نیز مستقل از این نشانه همیشه لازم‌اند.
 *
 * افزودن ربات جدید: فقط یک توکن به آرایه‌ی زیر اضافه کنید.
 * توکنها را «کوتاه‌ترین رشته‌ی یکتای» آن ربات انتخاب کنید تا با UA
 * مرورگرهای واقعی تداخل پیدا نکند (مثلاً «Googlebot» نه «Google»).
 */
const TRUSTED_CRAWLER_UA_RE = new RegExp(
  [
    // ── موتورهای جست‌وجو (ایندکس صفحات) ──
    'Googlebot', // Google — همه‌ی variantها: -News/-Image/-Video/Smartphone…
    'Google-InspectionTool',
    'bingbot', // Microsoft Bing
    'DuckDuckBot', // DuckDuckGo
    'YandexBot', // یاندکس
    'Slurp', // Yahoo
    'Applebot', // اپل (Siri/Spotlight)
    'Baiduspider', // بایدو
    // ── بات‌های پیش‌نمایش لینک شبکه‌های اجتماعی (og:image) ──
    'facebookexternalhit', // فیسبوک
    'FacebookBot',
    'Twitterbot', // توییتر/X
    'TelegramBot', // پیش‌نمایش لینک در تلگرام
    'WhatsApp', // پیش‌نمایش لینک در واتساپ
    'Slackbot', // اسلک
    'Discordbot', // دیسکورد
    'LinkedInBot', // لینکدین
    'Pinterestbot', // پینترست
  ].join('|'),
  'i',
)

/**
 * آیا این User-Agent نشانه‌ی یکی از کرالرهای فهرست بالا را دارد؟
 * UA ناموجود/خالی → false (مسیر عادی؛ هیچ رفتاری تغییر نمی‌کند).
 */
export function isTrustedCrawlerUserAgent(ua: string | null | undefined): boolean {
  if (!ua) return false
  return TRUSTED_CRAWLER_UA_RE.test(ua)
}

const PUBLIC_WEB_PATHS = [
  /^\/$/,
  /^\/(?:products|articles)(?:\/[^/]+)?$/,
  /^\/(?:about|gallery|robots\.txt|sitemap\.xml)$/,
]

// Keep this list aligned with the anonymous read routes used to render public
// pages. A method check alone would also exempt private GETs and future routes.
const PUBLIC_API_PATHS = [
  /^\/api\/menu\/(?:restaurant-hours|mains|categories|featured-animation)$/,
  /^\/api\/menu\/mains\/[^/]+\/(?:products|categories)$/,
  /^\/api\/menu\/products\/[^/]+(?:\/similar)?$/,
  /^\/api\/articles(?:\/[^/]+)?$/,
  /^\/api\/(?:about|gallery)$/,
  /^\/api\/terms(?:\/\d+)?$/,
  /^\/api\/products\/[^/]+\/reviews$/,
  /^\/api\/orders\/restaurant-status$/,
  /^\/uploads\/[^/]+\.(?:png|webp)$/,
]

/** Only public GET/HEAD content can use the unverified crawler UA hint. */
export function isCrawlerGeoExemptRequest(
  request: Request,
  surface: 'web' | 'api',
): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false
  if (!isTrustedCrawlerUserAgent(request.headers.get('user-agent'))) return false
  const pathname = new URL(request.url).pathname.replace(/\/$/, '') || '/'
  return (surface === 'web' ? PUBLIC_WEB_PATHS : PUBLIC_API_PATHS).some((path) =>
    path.test(pathname),
  )
}
