// ═══════════════════════════════════════════════════════════════
// stage-56 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/domain/shared/ids.ts
// تغییر: SLUG_OR_ID_PATTERN — الگوی پارامتر «UUID یا slug محصول» برای
//        GET /menu/products/:id (مجموعه‌ی کاراکترهای slug زیرمجموعه‌ی UUID است)
// ═══════════════════════════════════════════════════════════════

//src/domain/shared/ids.ts
// الگوهای شناسه‌ها — منبع واحد رارد ۴۸ (اسکن A4).
// پیش از این، همین دو الگو در ~۲۵ اعلانِ پراکنده در ~۲۰ فایل زندگی می‌کردند؛
// یک تایپوی کوچک در هر کپی، اعتبارسنجی همان مسیر را بی‌صدا ضعیف می‌کرد.

/** الگای رشته‌ای UUID نسخه ۴ — برای اسکیمای روت‌ها (t.String({ pattern })) */
export const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

/** همان الگو به شکل عبارت باقاعده — برای گاردهای داخل سرویس‌ها */
export const UUID_RE = new RegExp(UUID_PATTERN)

/** الگای رشته‌ای شناسه‌ی نمایشی سفارش (ord-XXXXXXXX) */
export const DISPLAY_PATTERN = '^ord-[a-z0-9]{8}$'

/** همان الگو به شکل عبارت باقاعده */
export const DISPLAY_RE = new RegExp(DISPLAY_PATTERN)

/** آیا این رشته یک شناسه‌ی نمایشی سفارش است؟ */
export const isDisplayId = (v: string) => DISPLAY_RE.test(v)
/**
 * stage-56 — الگوی «UUID یا slug محصول» برای پارامتر :id روت جزئیات منو.
 * کاراکترهای slug (a-z0-9-) زیرمجموعه‌ی کاراکترهای UUID هستند؛ سرویس با
 * UUID_RE دقیق تشخیص می‌دهد کدام مسیر است (id یا slug). حروف بزرگ رد
 * می‌شوند (لینک‌های سایت همیشه کوچک‌اند).
 */
export const SLUG_OR_ID_PATTERN = '^[a-z0-9-]{1,80}$'