// packages/shared/src/crawlers.ts

/**
 * سئو-۱: معافیت کرالرهای معتبر از دروازه‌ی جغرافیایی «فقط ایران».
 *
 * چرا؟ ربات‌های گوگل/بینگ از IPهای غیرایرانی کرال می‌کنند؛ بدون معافیت،
 * هر URL سایت برایشان ریدایرکت به /geo-blocked است → هیچ صفحه‌ای ایندکس
 * نمی‌شود. این تابع در «هر دو دروازه» استفاده می‌شود تا یک منبع حقیقت
 * داشته باشیم:
 *   • apps/web  src/server/geoGate.ts  (دروازه‌ی SSR — HTML صفحات)
 *   • apps/api  src/app.ts             (هوک onRequest — /api/* برای رندر
 *     سمت کلاینتِ کرالرها، مثل Googlebot Web Rendering Service)
 *
 * چرا فقط User-Agent و نه reverse-DNS؟
 * این دروازه «سیاست دسترسی به محتوا» است، نه مرز امنیتی — امنیت واقعی
 * (احراز، پرداخت، پنل‌ها) در لایه‌ی API auth است و برای همه یکسان می‌ماند.
 * کسی که UA را جعل کند فقط به «محتوای عمومی‌ای که هر کاربر ایرانی می‌بیند»
 * می‌رسد. در مقابل، راستی‌آزمایی rDNS وابستگی DNS و حالت‌های شکست جدید
 * می‌سازد که در بدترین حالت همان گوگل‌بات واقعی را می‌بندند — دقیقاً
 * فاجعه‌ای که این معافیت برای جلوگیری از آن ساخته شده.
 *
 * افزودن ربات جدید: فقط یک token به آرایه‌ی زیر اضافه کنید.
 * tokenها را «کوتاه‌ترین رشته‌ی یکتای» آن ربات انتخاب کنید تا با UA
 * مرورگرهای واقعی تداخل پیدا نکند (مثلاً «Googlebot» نه «Google»).
 */
const TRUSTED_CRAWLER_UA_RE = new RegExp(
  [
    // ── موتورهای جست‌وجو (ایندکس صفحات) ──
    'Googlebot', // Google — همه‌ی variantها: -News/-Image/-Video/Smartphone…
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
 * آیا این User-Agent متعلق به کرالرِ معتبرِ فهرست بالا است؟
 * UA ناموجود/خالی → false (مسیر عادی؛ هیچ رفتاری تغییر نمی‌کند).
 */
export function isTrustedCrawlerUserAgent(ua: string | null | undefined): boolean {
  if (!ua) return false
  return TRUSTED_CRAWLER_UA_RE.test(ua)
}
