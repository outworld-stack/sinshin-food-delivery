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