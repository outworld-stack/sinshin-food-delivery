// src/routes/courier/login.tsx
// پیک: شماره → OTP → توکن → سپس اسکن
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { requestCourierOtp, verifyCourierOtp } from '#/server/courier'
import { useToastStore } from '#/stores/toastStore'
import { setCourierToken } from '#/utils/courierSession'
import { isValidIranPhone, sanitizePhone } from '#/utils/phone'

export const Route = createFileRoute('/courier/login')({
  validateSearch: z.object({ orderId: z.string().regex(/^ord-[a-z0-9]{8}$/).optional().catch(undefined) }),
  component: CourierLoginPage,
})

function CourierLoginPage() {
  const navigate = useNavigate()
  const { orderId } = Route.useSearch()
  const showToast = useToastStore((s) => s.showToast)
  const [step, setStep] = useState<'phone' | 'otp'>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const busy = useRef(false)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((seconds) => Math.max(0, seconds - 1)), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  const handleSendOtp = async () => {
    if (busy.current || cooldown > 0 || !isValidIranPhone(phone)) return
    busy.current = true
    setLoading(true)
    try {
      const result = await requestCourierOtp(phone)
      setCooldown(result.cooldownSeconds)
      setCode('')
      setStep('otp')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'خطا', 'error')
    } finally {
      busy.current = false
      setLoading(false)
    }
  }

  const handleVerify = async () => {
    if (busy.current || !/^[0-9]{6}$/.test(code)) return
    busy.current = true
    setLoading(true)
    try {
      const res = await verifyCourierOtp({ phone, code })
      setCourierToken(res.token)
      showToast('احراز هویت موفق')
      if (orderId) await navigate({ to: '/courier/scan/$orderId', params: { orderId }, replace: true })
      else await navigate({ to: '/courier', replace: true })
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'خطا', 'error')
    } finally {
      busy.current = false
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="bg-white dark:bg-[#2a1015] p-8 rounded-2xl shadow-xl w-full max-w-md space-y-4">
        <h1 className="font-MorabbaBold text-2xl text-center">ورود پیک</h1>
        {step === 'phone' ? (
          <>
            <input
              type="tel"
              autoComplete="tel-national"
              aria-label="شماره موبایل پیک"
              maxLength={11}
              disabled={loading}
              dir="ltr"
              value={phone}
              onChange={e => setPhone(sanitizePhone(e.target.value))}
              placeholder="09xxxxxxxxx"
              className="w-full text-center p-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border-2 outline-none"
            />
            <button onClick={handleSendOtp} disabled={loading || cooldown > 0 || !isValidIranPhone(phone)} className="w-full py-3 rounded-xl bg-primary text-white font-bold disabled:opacity-50">
              {loading ? '...' : 'دریافت کد'}
            </button>
          </>
        ) : (
          <>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-label="کد تأیید پیک"
              disabled={loading}
              dir="ltr"
              maxLength={6}
              value={code}
              onChange={e => setCode(sanitizePhone(e.target.value))}
              placeholder="کد ۶ رقمی"
              className="w-full text-center text-2xl p-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border-2 outline-none"
            />
            <button onClick={handleVerify} disabled={loading || code.length !== 6} className="w-full py-3 rounded-xl bg-primary text-white font-bold disabled:opacity-50">
              {loading ? '...' : 'تأیید'}
            </button>
            <button onClick={handleSendOtp} disabled={loading || cooldown > 0} className="w-full text-sm text-primary disabled:opacity-50">
              {cooldown > 0 ? `ارسال دوباره تا ${cooldown} ثانیه دیگر` : 'ارسال دوباره کد'}
            </button>
            <button onClick={() => { setStep('phone'); setCode('') }} disabled={loading} className="w-full text-sm text-gray-500">
              تغییر شماره موبایل
            </button>
          </>
        )}
      </div>
    </div>
  )
}
