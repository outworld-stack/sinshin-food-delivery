// src/types/site/reviews.ts

// رارد ۴۷ — نظر تأییدشده محصول = قرارداد مشترک (کپی محلی حذف شد).
// نکته‌های صادقانه‌ی قرارداد: productName در اندپوینت عمومی همیشه null است
// (نام نمایشی از firstName/lastName ساخته می‌شود)، orderId خامِ UUID است و
// phone ماسک‌شده — قبلاً کپی محلی همه را دروغ می‌گفت.
import type { ProductReviewDto } from '@sinshin/shared'

export type ProductReview = ProductReviewDto