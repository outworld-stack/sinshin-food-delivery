//src/http/schemas.ts
// اسکیماهای مشترک بدنه‌ی روت‌ها — منبع واحد رارد ۴۸ (اسکن A13).
// آیتم سبد و نوع تحویل قبلاً در سه بدنه (چک‌اوت، پیش‌نمایش، قیمت سبد)
// بازنویسی می‌شدند و یک دریفت خاموش هم داشتند: quantity در قیمت سبد
// t.Number بود (اعشار می‌پذیرفت) و در چک‌اوت t.Integer.

import { t } from 'elysia'

import { UUID_PATTERN } from '#/domain/shared/ids'

/** یک آیتم سبد — productId + سایز اختیاری + تعداد صحیح ۱ تا ۹۹ */
export const cartItemSchema = t.Object({
  productId: t.String({ pattern: UUID_PATTERN }),
  sizeId: t.Optional(t.Nullable(t.String({ pattern: UUID_PATTERN }))),
  quantity: t.Integer({ minimum: 1, maximum: 99 }),
})

/** نوع تحویل — سه مقدار دیتابیس */
export const deliveryTypeSchema = t.Union([
  t.Literal('DELIVERY'),
  t.Literal('PICKUP'),
  t.Literal('DINE_IN'),
])