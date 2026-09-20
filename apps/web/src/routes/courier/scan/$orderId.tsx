// src/routes/courier/scan/$orderId.tsx
// صفحه‌ی اسکن پیک — QR را باز می‌کند، شروع تحویل می‌زند، صفحه باز می‌ماند
// و موقعیت گوشی را پیوسته برای مشتری می‌فرستد (طرح پرسش ۵)
import { createFileRoute, Link } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { courierScan, updateCourierLocation } from '#/server/courier'
import { useToastStore } from '#/stores/toastStore'
import { Bicycle, Check, Play, Pin, X } from 'reicon-react'
import { getCourierToken } from '#/utils/courierSession'

export const Route = createFileRoute('/courier/scan/$orderId')({
  // پیکِ تخصیص‌یافته از پارامتر آدرس می‌آید (QR امنیتی)
  validateSearch: z.object({ courier: z.string().optional() }),
  component: CourierScanPage,
})

type Phase = 'idle' | 'scanning' | 'tracking' | 'error'

function CourierScanPage() {
  const { orderId } = Route.useParams()


  const showToast = useToastStore((s) => s.showToast)
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState('')
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null)
  const [sentCount, setSentCount] = useState(0)

  const watchIdRef = useRef<number | null>(null)
  const lastSentRef = useRef(0)

  // پاک‌سازی وقتی صفحه بسته می‌شود
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current)
    }
  }, [])

  // شروع: ثبت رسیدن + روشن‌کردن استریم موقعیت
  const handleStart = useCallback(async () => {
    setPhase('scanning')
    setMessage('')
    try {
      // phase-5: منبع واحد توکن پیک — نشست خودِ پیک (OTP).
      // قبلاً اسکن از ?courier= می‌خواند و موقعیت از sessionStorage — دو منبع متفاوت!
      const res = await courierScan({ orderId, courierToken: getCourierToken() })
      if (!res.success) {
        setPhase('error')
        setMessage(res.message ?? 'اسکن ناموفق بود')
        return
      }
      showToast('رسیدن شما ثبت شد — سفارش «در مسیر» است')
      setPhase('tracking')

      if (!('geolocation' in navigator)) {
        setMessage('مرورگر شما موقعیت را پشتیبانی نمی‌کند')
        return
      }
      watchIdRef.current = navigator.geolocation.watchPosition(
        async (pos) => {
          const { latitude, longitude } = pos.coords
          setPosition({ lat: latitude, lng: longitude })
          // ارسال حداکثر هر ۵ ثانیه
          const now = Date.now()
          if (now - lastSentRef.current > 5000) {
            lastSentRef.current = now
            try {
              await updateCourierLocation({ orderId, courierToken: getCourierToken() ?? '', lat: latitude, lng: longitude })
              setSentCount(c => c + 1)
            } catch (err) {
              // phase-5: خطای ارسال موقعیت دیگر بی‌صدا نیست —
              // «نشست پیک منقضی شده» باید دیده شود تا پیک بداند دوباره وارد شود
              setMessage(err instanceof Error ? err.message : 'خطا در ارسال موقعیت')
            }
          }
        },
        (err) => {
          setMessage('دسترسی به موقعیت رد شد: ' + err.message)
        },
        { enableHighAccuracy: true, maximumAge: 3000 },
      )
    } catch (err: unknown) {
      setPhase('error')
      setMessage(err instanceof Error ? err.message : 'خطا')
    }
  }, [orderId, showToast])

  // توقف ارسال
  const handleStop = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
    setPhase('idle')
    showToast('ارسال موقعیت متوقف شد')
  }, [showToast])

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#1a0a0e] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white dark:bg-[#2a1015] p-8 rounded-2xl shadow-xl border border-gray-100 dark:border-[#3a151c] space-y-6">

          <div className="text-center">
            <span className="w-16 h-16 rounded-2xl bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary flex items-center justify-center mx-auto mb-4">
              <Bicycle size={32} />
            </span>
            <h1 className="font-MorabbaBold text-2xl text-gray-900 dark:text-white">پیک سین‌شین</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 font-DanaMedium mt-1">
              سفارش <span className="font-DanaDemiBold" dir="ltr">{orderId}</span>
            </p>
          </div>

          {phase === 'idle' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-500 dark:text-gray-400 font-DanaMedium text-center leading-relaxed">
                با زدن دکمه، رسیدن شما به رستوران ثبت می‌شود و سفارش «در مسیر» می‌شود.
                سپس موقعیت گوشی شما تا پایان تحویل برای مشتری ارسال می‌شود.
              </p>
              <button
                type="button"
                onClick={handleStart}
                className="w-full py-4 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaDemiBold text-lg hover:opacity-90 transition cursor-pointer flex items-center justify-center gap-2"
              >
                <Play size={20} />
                شروع تحویل
              </button>
            </div>
          )}

          {phase === 'scanning' && (
            <div className="text-center py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4"></div>
              <p className="text-sm text-gray-500 font-DanaMedium">در حال ثبت رسیدن…</p>
            </div>
          )}

          {phase === 'tracking' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-4 rounded-xl bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20">
                <Check size={20} className="text-green-500 shrink-0" />
                <p className="text-sm text-green-600 dark:text-green-400 font-DanaMedium">
                  سفارش «در مسیر» است — موقعیت شما برای مشتری ارسال می‌شود
                </p>
              </div>

              <div className="p-4 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] space-y-2">
                <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 font-DanaMedium">
                  <Pin size={14} className="text-primary dark:text-dark-primary" />
                  موقعیت فعلی:
                </div>
                <p className="text-sm font-DanaDemiBold text-gray-800 dark:text-white" dir="ltr">
                  {position ? `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}` : 'در انتظار GPS…'}
                </p>
                <p className="text-xs text-gray-400 font-DanaMedium">
                  ارسال‌های موفق: {sentCount.toLocaleString('fa-IR')} · حداکثر هر ۵ ثانیه
                </p>
              </div>

              {message && (
                <p className="text-xs text-orange-500 font-DanaMedium text-center">{message}</p>
              )}

              <button
                type="button"
                onClick={handleStop}
                className="w-full py-3 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 font-DanaMedium hover:bg-gray-200 dark:hover:bg-[#3a151c] transition cursor-pointer flex items-center justify-center gap-2"
              >
                <X size={16} />
                توقف ارسال موقعیت
              </button>
            </div>
          )}

          {phase === 'error' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20">
                <p className="text-sm text-red-600 dark:text-red-400 font-DanaMedium text-center">{message}</p>
              </div>
              <button
                type="button"
                onClick={() => setPhase('idle')}
                className="w-full py-3 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaDemiBold hover:opacity-90 transition cursor-pointer"
              >
                تلاش مجدد
              </button>
              <Link
                to="/courier/login"
                className="block text-center text-sm text-primary dark:text-dark-primary font-DanaMedium hover:underline"
              >
                ورود / احراز هویت پیک
              </Link>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}