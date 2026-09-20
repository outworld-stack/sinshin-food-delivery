// src/server/guards.ts
import { z } from 'zod'

// نقش ارسالی از کلاینت — فاز موک.
// TODO(بک‌اند): خواندن نقش از کوکی نشست به جای اتکا به مقدار کلاینت
export const roleSchema = z.enum(['admin', 'admin2', 'user'])

/** فقط ادمین اصلی مجاز است؛ در غیر این صورت خطا */
export function assertMainAdmin(role: unknown): asserts role is 'admin' {
  if (role !== 'admin') {
    throw new Error('این عملیات فقط برای مدیر اصلی مجاز است.')
  }
}