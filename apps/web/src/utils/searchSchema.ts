// src/utils/searchSchema.ts
// هلپرهای اسکیمای search params — تایپ‌امن و مقاوم در برابر quirk های TanStack Router
import { z } from 'zod'

// TanStack Router مقادیر search را قبل از validateSearch با JSON.parse پیش‌پردازش
// می‌کند؛ یعنی «?search=100» به‌صورت number 100 می‌رسد، نه string '100'.
// z.string() ساده روی عدد fail می‌شود و .catch مقدار جستجو را بی‌صدا می‌اندازد.
// این هلپر عدد را به رشته تبدیل می‌کند تا جستجوی عددی (شناسه سفارش و...)
// بعد از رفرش/اشتراک‌گذاری لینک خالی نشود.
//
// رفتار:
//   100        → '100'      (عددِ JSON.parse شده)
//   'ord-1000' → 'ord-1000' (رشته معمولی — دست‌نخورده)
//   undefined  → ''         (فیلد غایب — default؛ و در تایپِ input اختیاری می‌ماند
//                            تا Link/navigate بدون search نشکند)
//   هر چیز خراب دیگر → ''   (URL دستکاری‌شده — catch)
export const searchTextField = z.preprocess(
  (v) => (typeof v === 'number' ? String(v) : v),
  z.string().catch(''),
).default('')

// ⬅ NEW: فیلد شماره صفحه — مشترک بین همه‌ی لیست‌های صفحه‌بندی‌شده‌ی پنل کاربر
// (کیف پول، سفارشات من و...) — الگوی adminUsersSearchSchemaهای دسته ۲
// quirk مهم: ?page=2 به‌صورت number 2 می‌رسد (JSON.parse روت)؛
// خراب / کمتر از ۱ → 1 (نه خطای روت)
export const pageField = z.number().int().min(1).catch(1).default(1)

// ⬅ NEW: فیلد تعداد آیتم در صفحه — پیش‌فرض را هر مصرف‌کننده تعیین می‌کند
// (کیف پول ۵، لیست‌های ادمین ۱۰ و...)؛ محدوده ۵ تا ۱۰۰
export const limitField = (def: number) =>
  z.number().int().min(5).max(100).catch(def).default(def)