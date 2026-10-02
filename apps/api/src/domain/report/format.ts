//src/domain/report/format.ts
// قالب‌بندهای مشترک گزارش‌ها — منبع واحد رارد ۴۸ (اسکن A1).
// پیش از این، سه نسخه‌ی موازی از همین توابع در report.service و
// report-query.service و report-panel.routes زندگی می‌کردند و رفع
// «بازگشت وجه» (رارد ۱۱) فقط به یکی از آن‌ها رسیده بود.

import type { OrderBreakdown } from '@sinshin/shared'

/** عدد فارسی با جداکننده‌ی هزارگان */
export const faNum = (n: number) => n.toLocaleString('fa-IR')

/** تاریخ/ساعت کوتاه شمسی */
export const faDate = (d: Date) =>
  new Intl.DateTimeFormat('fa-IR', { dateStyle: 'short', timeStyle: 'short' }).format(d)

/** برچسب فارسی نوع تحویل */
export const faDelivery = (t: string) =>
  t === 'DELIVERY' ? 'ارسال با پیک' : t === 'PICKUP' ? 'بیرون‌بر' : 'سرو در سالن'

/**
 * برچسب فارسی وضعیت سفارش.
 * رارد ۱۱ (اسکن M-4): سفارش refunded قبلاً «پرداخت ناموفق» نشان داده
 * می‌شد (refund → status=CANCELED) — ابتدا paymentStatus چک می‌شود، بعد status.
 */
export const faStatus = (s: string, paymentStatus?: string | null) =>
  paymentStatus === 'REFUNDED' ? 'بازگشت وجه'
    : s === 'PAID' ? 'در انتظار تایید'
      : s === 'CONFIRMED' ? 'تایید شده'
        : s === 'ON_THE_WAY' ? 'در مسیر'
          : s === 'DELIVERED' ? 'تحویل شده'
            : s === 'CANCELED' ? 'پرداخت ناموفق'
              : 'در انتظار پرداخت'

/** حداقل شکلی از ردیف سفارش که جدول گزارش لازم دارد */
export interface ReportOrderLike {
  displayId: string
  deliveryType: string
  status: string
  paymentStatus?: string | null
  breakdown: OrderBreakdown
  createdAt: Date
}

/** حداقل شکلی از ردیف کاربر که جدول گزارش لازم دارد */
export interface ReportUserLike {
  phone: string
}

/** سرستون‌های مشترک جدول سفارشات (HTML گزارش cron، CSV و گزارش ادمین) */
export const ORDER_TABLE_HEAD = [
  'شناسه', 'نوع تحویل', 'وضعیت', 'مبلغ کل', 'پرداخت آنلاین', 'کیف پول',
  'تخفیف', 'ارسال', 'بسته‌بندی', 'مشتری', 'زمان ثبت',
]

/**
 * یک ردیف جدول سفارشات با ۱۱ ستون.
 * قالب‌بند اعداد و تاریخ پارامتری است: گزارش HTML/ادمین فارسی می‌سازد،
 * CSV خام (عدد خام + ISO) — منطق ستون‌بندی فقط اینجا زندگی می‌کند.
 */
export function orderRow(
  o: ReportOrderLike,
  u: ReportUserLike,
  fmt: { num: (n: number) => string; date: (d: Date) => string },
): string[] {
  return [
    o.displayId,
    faDelivery(o.deliveryType),
    faStatus(o.status, o.paymentStatus),
    fmt.num(o.breakdown.totalAmount),
    fmt.num(o.breakdown.amountPaidOnline),
    fmt.num(o.breakdown.walletDeduction),
    fmt.num(o.breakdown.discount),
    fmt.num(o.breakdown.deliveryFee),
    fmt.num(o.breakdown.packagingFee),
    u.phone,
    fmt.date(o.createdAt),
  ]
}