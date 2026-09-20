// src/routes/courier/route.tsx
import { createFileRoute, Outlet } from '@tanstack/react-router'

// مسیرهای پیک — بدون هدر/فوتر (برای گوشی خودِ پیک)
export const Route = createFileRoute('/courier')({
  component: () => <Outlet />,
})