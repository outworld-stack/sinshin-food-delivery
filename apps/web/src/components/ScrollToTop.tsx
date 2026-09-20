// src/components/ScrollToTop.tsx
import { useState, useEffect } from 'react';
import { useRouterState } from '@tanstack/react-router';

export function ScrollToTop() {
  const [isVisible, setIsVisible] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  
  // استفاده از Regex برای تشخیص دقیق صفحه جزئیات محصول (مثل /products/p-1)
  const isProductDetailPage = pathname.match(/^\/products\/[^/]+/);

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
  if (isProductDetailPage) return null;

  return (
    isVisible && (
      <button 
        onClick={scrollToTop}
        className="fixed bottom-6 left-6 z-50 p-3 rounded-full bg-primary dark:bg-dark-primary text-white shadow-lg hover:opacity-90 transition cursor-pointer"
        aria-label="بازگشت به بالا"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="18 15 12 9 6 15"></polyline>
        </svg>
      </button>
    )
  );
}