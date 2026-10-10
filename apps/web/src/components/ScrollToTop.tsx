// ═══════════════════════════════════════════════════════════════
// stage-55 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/components/ScrollToTop.tsx
// وضعیت: ویرایش فایل موجود (دو تغییر نقطه‌ای)
// تغییر: مخفی‌سازی روی /cart + آفست پایین امن (bottom-safe)
// ═══════════════════════════════════════════════════════════════

// src/components/ScrollToTop.tsx
import { useState, useEffect } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { useI18n } from '#/i18n';

export function ScrollToTop() {
  const { t } = useI18n()
  const [isVisible, setIsVisible] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // استفاده از Regex برای تشخیص دقیق صفحه جزئیات محصول (مثل /products/p-1)
  const isProductDetailPage = pathname.match(/^\/products\/[^/]+/);
  // stage-55 — روی /cart هم مخفی: نوار CTA سبد تمام عرض است و FAB روی دکمه می‌نشست
  const isCartPage = pathname === '/cart';

  const toggleVisibility = () => {
    if (window.pageYOffset > 300) {
      setIsVisible(true);
    } else {
      setIsVisible(false);
    }
  };

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  useEffect(() => {
    window.addEventListener('scroll', toggleVisibility);
    return () => window.removeEventListener('scroll', toggleVisibility);
  }, []);

  // اگر در صفحه جزئیات محصول بود، اصلاً دکمه را نشان نده
  // stage-55 — و روی /cart هم نه (نوار CTA موبایل آنجاست)
  if (isProductDetailPage || isCartPage) return null;

  return (
    isVisible && (
      <button
        onClick={scrollToTop}
        // stage-55 — آفست پایین امن iOS (home indicator) — bottom-safe در styles.css
        className="fixed bottom-safe left-6 z-50 p-3 rounded-full bg-primary dark:bg-dark-primary text-white shadow-lg hover:opacity-90 transition cursor-pointer"
        aria-label={t['common.scrollTop']}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="18 15 12 9 6 15"></polyline>
        </svg>
      </button>
    )
  );
}