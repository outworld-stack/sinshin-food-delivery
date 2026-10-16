// ═══════════════════════════════════════════════════════════════
// stage-55 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/domain/shared/pg.ts
// وضعیت: فایل جدید
// تغییر: کمک‌تابع‌های مشترک پستگرس — DRY برای سه نیازی که تا
//        امروز در چند سرویس کپی‌شده یا غایب بود:
//        ۱) escapeLike/likePattern — escape کاراکترهای wildcard
//           جستجو (٪ _ \) تا کاربر با «%» کل جدول را اسکن نکند
//        ۲) isUniqueViolation — تشخیص خطای 23505 برای مسیرهای
//           هم‌زمان (قبلاً فقط در translation کپی شده بود)
//        ۳) maskPhone — ماسک شماره برای لاگ/نمای ادمین۲
//           (قبلاً فقط در review کپی شده بود)
// ═══════════════════════════════════════════════════════════════

//src/domain/shared/pg.ts

/**
 * escape کاراکترهای خاص الگوی LIKE — بدون این، کاربر با تایپ
 * «%» یا «_» الگوی جستجو را به اسکنِ کل جدول تبدیل می‌کند
 * (تزریق wildcard؛ نه SQLi ولی همان اثرِ DoS سبک).
 */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

/** الگوی «شاملِ عبارت» امن — %عبارتِ‌escape‌شده% */
export function likePattern(input: string): string {
  return `%${escapeLike(input.trim())}%`
}

/**
 * خطای یکتایی Postgres (رقابت هم‌زمان روی insert).
 *
 * stage-72 — رفع باگ واقعیِ تشخیص (کشفِ تست E2E): درایور Bun.sql کد PG را در
 * «errno» می‌گذارد (code = ERR_POSTGRES_SERVER_ERROR عمومی است) و drizzle هم
 * خطای درایور را داخل DrizzleQueryError.cause می‌پیچد. چکِ قبلیِ فقطِ
 * e.code==='23505' (قرارداد pg کلاسیک) در این استک هیچ‌وقت true نمی‌شد — یعنی
 * همه‌ی مسیرهای «رقابت هم‌زمان» (review/menu/coupon/auth/device) به‌صورت خام
 * ۵۰۰ می‌دادند. حالا هر سه شکل پوشش داده می‌شود: pg کلاسیک (code)، Bun.sql
 * مستقیم (errno) و wrapper درایور (cause.errno).
 */
export function isUniqueViolation(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false
  const hit = (x: object): boolean => {
    const err = x as { code?: unknown; errno?: unknown }
    return err.code === '23505' || err.errno === '23505' || err.errno === 23505
  }
  if (hit(e)) return true
  const cause = (e as { cause?: unknown }).cause
  return typeof cause === 'object' && cause !== null && hit(cause)
}

/** ماسک شماره برای نمایش/لاگ — شماره کامل فقط برای ادمین اصلی */
export function maskPhone(phone: string): string {
  return phone.length >= 7 ? `${phone.slice(0, 4)}***${phone.slice(-3)}` : '***'
}