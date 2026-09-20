// src/routes/courier/login.tsx
// پیک: شماره → OTP → توکن → سپس اسکن
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { requestCourierOtp, verifyCourierOtp } from '#/server/courier'
import { useToastStore } from '#/stores/toastStore'
import { setCourierToken } from '#/utils/courierSession'

export const Route = createFileRoute('/courier/login')({
  component: CourierLoginPage,
})

function CourierLoginPage() {
  const navigate = useNavigate()
  const showToast = useToastStore((s) => s.showToast)
  const [step, setStep] = useState<'phone' | 'otp'>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSendOtp = async () => {
    setLoading(true)
    try {
      await requestCourierOtp(phone)
      setStep('otp')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'خطا', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleVerify = async () => {
    setLoading(true)
    try {
      const res = await verifyCourierOtp({ phone, code })
      setCourierToken(res.token)
      showToast('احراز هویت موفق')
      navigate({ to: '/courier' })
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'خطا', 'error')
    } finally {
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
              dir="ltr"
              value={phone}
              onChange={e => setPhone(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="09xxxxxxxxx"
              className="w-full text-center p-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border-2 outline-none"
            />
            <button onClick={handleSendOtp} disabled={loading || phone.length !== 11} className="w-full py-3 rounded-xl bg-primary text-white font-bold disabled:opacity-50">
              {loading ? '...' : 'دریافت کد'}
            </button>
          </>
        ) : (
          <>
            <input
              type="text"
              dir="ltr"
              maxLength={4}
              value={code}
              onChange={e => setCode(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="کد ۴ رقمی"
              className="w-full text-center text-2xl p-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border-2 outline-none"
            />
            <button onClick={handleVerify} disabled={loading || code.length !== 4} className="w-full py-3 rounded-xl bg-primary text-white font-bold disabled:opacity-50">
              {loading ? '...' : 'تأیید'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}