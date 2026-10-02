// ═══════════════════════════════════════════════════════════════
// round-34 — sinshin-food-delivery — فایل 7 از 49
// مسیر مقصد: apps/api/src/domain/shared/lang.ts
// وضعیت: فایل جدید
// کامیت پیشنهادی: stage thirty
// ═══════════════════════════════════════════════════════════════

// src/domain/shared/lang.ts
/**
 * round-34 — لایه‌ی محتوای دوزبانه (fa/ar).
 *
 * معماری:
 *  • همه‌ی ستون‌های عربی NULLable هستند — «عربی خالی» یعنی همان متن فارسی
 *    به کاربر نمایش داده می‌شود (fallback)، نه رشته‌ی خالی.
 *  • read-path عمومی: pickAr/pickArArr — معادلِ COALESCE(ar, fa) اما
 *    تایپ‌شده و در لایه‌ی نگاشت DTO (به‌جای SELECT سنگین per-query).
 *  • write-path ادمین: nullIfEmpty — رشته‌ی خالی/فاصله → NULL (حذف ترجمه).
 *  • arAuto (بج فرم ادمین): false = دستی، true = خودکار (رارد ۳۵ — مترجم
 *    آفلاین NLLB که مستقیم روی ردیف می‌نویسد). ذخیره‌ی دستیِ ادمین با هر
 *    مقدار عربیِ غیرخالی، پرچم را به false برمی‌گرداند.
 *
 * هدر درخواست: x-sinshin-lang: ar (فقط حالت عربی فرستاده می‌شود — fa
 * پیش‌فرض است و بدون هدر همان رفتار قبلی می‌ماند؛ کلاینت وب آن را از
 * کوکی sinshin-lang تزریق می‌کند، هم SSR هم مرورگر).
 */

import type { Lang } from '@sinshin/shared'

// رارد ۴۶ — تعریف Lang به قرارداد مشترک (@sinshin/shared) منتقل شد؛
// این re-export فقط برای پایداری مسیر import مصرف‌کننده‌های فعلی است.
export type { Lang }

/** هدرهای Elysia کلید lowercase دارند (مثل x-courier-token موجود) */
export function langFromHeaders(headers: Record<string, unknown>): Lang {
  return (headers as Record<string, string | undefined>)['x-sinshin-lang'] === 'ar' ? 'ar' : 'fa'
}

/** COALESCE(ar, fa) — رشته */
export function pickAr(lang: Lang, ar: string | null | undefined, fa: string): string {
  return lang === 'ar' && ar != null && ar !== '' ? ar : fa
}

/** COALESCE(ar, fa) — آرایه (مواد اولیه، قالب سایزها، ...) */
export function pickArArr<T>(lang: Lang, ar: T[] | null | undefined, fa: T[]): T[] {
  return lang === 'ar' && ar != null && ar.length > 0 ? ar : fa
}

/** write-path ادمین: '' یا فاصله → NULL (یعنی «ترجمه‌ ندارد، fallback فارسی») */
export function nullIfEmpty(v: string | null | undefined): string | null {
  const s = (v ?? '').trim()
  return s === '' ? null : s
}

/** آیا این رکورد هر مقدار عربی دستی دارد؟ (پرچم arAuto روی ذخیره‌ی دستی) */
export function hasAnyAr(...values: Array<string | null | undefined>): boolean {
  return values.some((v) => v != null && v !== '')
}

/** آیا کاربر عربی چیزی جز fallback فارسی می‌بیند؟ — بج «ترجمه ناقص» در پنل ادمین رارد ۳۵ */
export function arComplete(
  row: { ar: Array<string | null | undefined>; fa: Array<string | null | undefined> },
): boolean {
  return row.ar.every((a, i) => (row.fa[i] != null && row.fa[i] !== '' ? a != null && a !== '' : true))
}