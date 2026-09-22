//src/domain/shared/brand.ts
/**
 * Nominal (branded) types — zero-cost type-level IDs.
 * یک UserId به OrderId قابل انتساب نیست حتی اگر هر دو string باشند.
 * قانون: cast فقط در مرز serde (HTTP در، DB بیرون) با asX های زیر.
 *
 * stage-15 — تعریف‌های محلی حذف شدند: باقی‌ماندن کپی محلی کنارِ
 * re-export باعث می‌شد UserId این ماژول با UserId قراردادهای @sinshin/shared
 * «هم‌نام اما ناسازگار» شود (دو unique symbol جدا). حالا منبع واحد است.
 */
export * from '@sinshin/shared'
