// src/routes/courier/route.tsx
import { createFileRoute, Outlet } from '@tanstack/react-router'

// مسیرهای پیک — بدون هدر/فوتر (برای گوشی خودِ پیک)
// سئو-۲: noindex در لایه‌ی والد — روی همه‌ی صفحات /courier اعمال می‌شود
// (اسکن/لاگین پیک محتوای ایندکس‌پذیری ندارد)
export const Route = createFileRoute('/courier')({
  component: () => <Outlet />,
  head: () => ({
    meta: [{ name: 'robots', content: 'noindex, nofollow' }],
  }),
})
