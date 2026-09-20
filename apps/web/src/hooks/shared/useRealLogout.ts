// src/hooks/shared/useRealLogout.ts
import { useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { logout as apiLogout } from '#/server/auth'
import { useToastStore } from '#/stores/toastStore'

/**
 * phase-3 — لاگ‌اوت «واقعی» (مرگ لاگ‌اوت دکوری):
 *  ۱) POST /auth/logout → سشن سمت سرور revoke + کوکی httpOnly پاک می‌شود
 *     (برای admin2: بستن سشن + لاگ فعالیت هم همین‌جا انجام می‌شود)
 *  ۲) onUnauthorized (داخل apiLogout) → توکن ماژول-گلوبال + authStore پاک
 *  ۳) queryClient.clear() → داده‌ی شخصی از کش نمی‌ماند
 *  ۴) navigate با replace — دکمه‌ی Back، صفحه‌ی قبلیِ احرازشده را برنمی‌گرداند
 */
export function useRealLogout(redirectTo: '/' | '/login' = '/') {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.showToast)

  return useCallback(async () => {
    // apiLogout هرگز throw نمی‌کند — حتی اگر سرور پایین بود،
    // مسیر catch داخلی‌اش onUnauthorized را صدا می‌زند (توکن + استور پاک)
    await apiLogout()
    // داده‌ی شخصی از کش نماند — کاربر بعدیِ همین تب چیزی نمی‌بیند
    queryClient.clear()
    showToast('با موفقیت خارج شدید')
    navigate({ to: redirectTo, replace: true })
  }, [navigate, queryClient, showToast, redirectTo])
}