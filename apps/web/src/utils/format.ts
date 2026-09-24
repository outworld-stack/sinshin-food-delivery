export const formatPrice = (price: number) => {
  return price.toLocaleString('fa-IR');
};

// round-16 — گارد واقعی «Invalid Date»: new Date(undefined) پرتاب نمی‌کند،
// رشتهٔ «Invalid Date» برمی‌گرداند؛ try/catch قبلی کور بود.
const safeDate = (date: Date | string): Date | null => {
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const formatTime = (date: Date | string) => {
  const d = safeDate(date);
  return d ? d.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }) : '—';
};

// تابع فرمت کردن تاریخ شمسی (برای مقالات)
export const formatDate = (date: Date | string) => {
  const d = safeDate(date);
  return d
    ? d.toLocaleDateString('fa-IR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '—';
};

export const formatReferralId = (date: Date | string, phone: string) => {
  const d = safeDate(date);
  if (!d) return phone;
  try {
    // تبدیل تاریخ به فرمت YYYYMMDD (بدون اسلش)
    const formattedDate = new Intl.DateTimeFormat('fa-IR-u-nu-latn', {
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(d).replace(/\//g, '');

    // ترکیب 3 رقم آخر شماره با تاریخ
    return `${phone.slice(-3)}-${formattedDate}`;
  } catch {
    return phone;
  }
};

export const faNum = (n: number): string => n.toLocaleString('fa-IR')

// ── round-18 — مانیتورینگ سیستم (داشبورد ادمین) ──

/** مدت از میلی‌ثانیه — سطل‌های خوانا: «۲۵۰ م‌ث» / «۳٫۲ ثانیه» / «۴۵ دقیقه» / «۳۰ ساعت» / «۶ روز» */
export const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${faNum(Math.round(ms))} م‌ث`
  const seconds = ms / 1000
  if (seconds < 10) return `${faNum(Math.round(seconds * 10) / 10)} ثانیه`
  if (seconds < 60) return `${faNum(Math.round(seconds))} ثانیه`
  const minutes = seconds / 60
  if (minutes < 60) return `${faNum(Math.round(minutes))} دقیقه`
  const hours = minutes / 60
  if (hours < 48) return `${faNum(Math.round(hours))} ساعت`
  return `${faNum(Math.round(hours / 24))} روز`
}

/** زمان نسبی برای «آخرین اجرا» — «همین حالا» / «۵ دقیقه پیش» / «۲ روز پیش» */
export const formatRelative = (date: Date | string): string => {
  const d = safeDate(date)
  if (!d) return '—'
  const seconds = Math.round((Date.now() - d.getTime()) / 1000)
  if (seconds < 45) return 'همین حالا'
  if (seconds < 3600) return `${faNum(Math.max(1, Math.round(seconds / 60)))} دقیقه پیش`
  if (seconds < 86400) return `${faNum(Math.round(seconds / 3600))} ساعت پیش`
  return `${faNum(Math.round(seconds / 86400))} روز پیش`
}