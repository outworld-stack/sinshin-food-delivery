// src/integrations/tanstack-query/root-provider.tsx
import {
  QueryClient,
  QueryCache,
  MutationCache,
  type QueryClientConfig,
} from '@tanstack/react-query'
import { useToastStore } from '#/stores/toastStore'

// تنظیمات مشترک — سرور و کلاینت هر دو از getContext می‌گیرن
const queryClientConfig: QueryClientConfig = {
  // ⬅ NEW: QueryCache سراسری — خطای هر کوئری یکجا لاگ می‌شه؛
  // نمایش خطا به کاربر همچنان بر عهده‌ی errorComponent خود روت‌هاست
  // (سلسله‌مراتب درست: کش = لایه داده، روت = لایه UI)
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (import.meta.env.DEV) {
        console.error(`[query ${JSON.stringify(query.queryKey)}]`, error)
      }
    },
  }),

  // ⬅ NEW: MutationCache سراسری — هیچ میوتیشنی دیگه بی‌صدا fail نمی‌شه.
  // قبلاً toggleUserStatus / toggleProductStatus و چند میوتیشن دیگر onError
  // نداشتند => خطای سرور = سکوت مطلق برای کاربر. حالا یک toast سراسری.
  // میوتیشن‌هایی که خطایشان را خودشان هندل می‌کنند، meta: { silent: true } می‌گذارند.
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (mutation.meta?.silent === true) return
      useToastStore.getState().showToast(error?.message || 'خطایی رخ داد', 'error')
    },
  }),

  defaultOptions: {
    queries: {
      // ⬅ مهم‌ترین تغییر پروژه: staleTime پیش‌فرض صفره!
      // یعنی هر mount جدید = ریفچ (user-profile در ۸ فایل mount می‌شه!)
      // ۳۰s دقیقاً با defaultPreloadStaleTime روتر هم‌ترازه تا preload دوباره فچ نکنه
      staleTime: 30_000,

      // بعد از unmount هم ۵ دقیقه کش می‌مونه → برگشت به صفحه‌ی قبلی آنی
      gcTime: 5 * 60_000,

      // خطای 4xx (اعتبارسنجی/مجوز) retry نمی‌شه — فقط خطای شبکه ۲ بار
      retry: (failureCount, error) => {
        const status = (error as Error & { status?: number }).status
        if (status !== undefined && status >= 400 && status < 500) return false
        return failureCount < 2
      },

      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
    mutations: {
      // ⬅ سفارش/پرداخت/لاگین هیچ‌وقت خودکار retry نشه — فقط با اکشن صریح کاربر
      retry: 0,
    },
  },
}

export function getContext() {
  const queryClient = new QueryClient(queryClientConfig)
  return {
    queryClient,
  }
}