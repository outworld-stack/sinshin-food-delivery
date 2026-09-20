export const formatPrice = (price: number) => {
  return price.toLocaleString('fa-IR');
};

export const formatTime = (date: Date | string) => {
  return new Date(date).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
};

// تابع فرمت کردن تاریخ شمسی (برای مقالات)
export const formatDate = (date: Date | string) => {
  try {
    return new Date(date).toLocaleDateString('fa-IR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return '';
  }
};

export const formatReferralId = (date: Date | string, phone: string) => {
  try {
    // تبدیل تاریخ به فرمت YYYYMMDD (بدون اسلش)
    const formattedDate = new Intl.DateTimeFormat('fa-IR-u-nu-latn', {
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date(date)).replace(/\//g, '');
    
    // ترکیب 3 رقم آخر شماره با تاریخ
    return `${phone.slice(-3)}-${formattedDate}`;
  } catch {
    return phone;
  }
};

export const faNum = (n: number): string => n.toLocaleString('fa-IR')