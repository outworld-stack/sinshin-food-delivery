// src/routes/login.tsx
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useForm } from '@tanstack/react-form'
import { useState, useRef, useCallback, useEffect } from 'react'
import { z } from 'zod'
import { useMutation } from '@tanstack/react-query'
import { requestOtp, verifyOtp, checkIsNewUser } from '#/server/auth'
import { collectDeviceSignals } from '#/utils/deviceFingerprint'
import { useAuthStore } from '#/stores/authStore'
import { useToastStore } from '#/stores/toastStore'
import { getStoredRef, clearStoredRef } from '#/utils/referralCapture'
import { faNum } from '#/utils/format'
import { TermsModal } from '#/components/site/auth/TermsModal'
import { ChevronRight, Gift } from 'reicon-react'

export const Route = createFileRoute('/login')({
  validateSearch: z.object({ redirect: z.string().optional() }),
  component: LoginPage,
  // سئو-۲: صفحه‌ی ورود ارزش ایندکس ندارد و محتوایش برای گوگل نویز است.
  // (در robots.txt عمداً Disallow نشده تا گوگل بتواند این noindex را ببیند.)
  head: () => ({
    meta: [
      { title: 'ورود / ثبت‌نام | سین شین' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
})

function LoginPage() {
  const navigate = useNavigate()
  const router = useRouter()         
  const search = Route.useSearch()   
  const login = useAuthStore((s) => s.login)
  const showToast = useToastStore((s) => s.showToast)

  const [step, setStep] = useState<'phone' | 'otp'>('phone')
  const [phone, setPhone] = useState('')

  // ⬅ حذف شد: loading و serverError → از state خود میوتیشن‌ها مشتق می‌شن
  // ثبت‌نام: کاربر جدید؟ / قوانین؟ / کد معرف ذخیره‌شده؟
  const [isNewUser, setIsNewUser] = useState(false)
  const [needsTerms, setNeedsTerms] = useState(false)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [termsRead, setTermsRead] = useState(false)
  const [termsModalOpen, setTermsModalOpen] = useState(false)
  const [refCode, setRefCode] = useState<string | null>(null)
  const [resendIn, setResendIn] = useState(0)

  useEffect(() => {
    setRefCode(getStoredRef())
  }, []);

  useEffect(() => {
    if (resendIn <= 0) return
    const t = setTimeout(() => setResendIn(v => v - 1), 1000)
    return () => clearTimeout(t)
  }, [resendIn]);

  // --- میوتیشن‌ها: هر مرحله‌ی لاگین یک میوتیشن مستقل ---
  // isPending / isError / error خودشون مدیریت می‌شن — دیگه try/catch + setState نیست

  // ۱) چک سبک — بدون پیامک
  const checkUserMutation = useMutation({
    mutationFn: (input: string) => checkIsNewUser(input),
  })

  // ۲) ارسال OTP
  const sendOtpMutation = useMutation({
    mutationFn: (input: string) => requestOtp(input),
    onSuccess: (data) => {
      setStep('otp')
      setResendIn(data.cooldownSeconds) // ← از سرور، نه ۶۰
    },
  })

  // ۳) تأیید + لاگین — با device signals
  const verifyLoginMutation = useMutation({
    mutationFn: async (input: { phone: string; code: string }) => {
      const device = await collectDeviceSignals() // ← fingerprint دو-لایه
      const result = await verifyOtp({
        phone: input.phone,
        code: input.code,
        device,
        refCode: isNewUser ? refCode : undefined,
        termsAccepted: isNewUser ? termsAccepted : undefined,
      })
      return result
    },
  })


  // ⬅ loading: جمع isPending ها — نه useState دستی
  const loading =
    checkUserMutation.isPending
    || sendOtpMutation.isPending
    || verifyLoginMutation.isPending

  // ⬅ serverError: مشتق از error میوتیشن‌ها — نه useState دستی
  const serverError =
    verifyLoginMutation.error?.message
    ?? sendOtpMutation.error?.message
    ?? checkUserMutation.error?.message
    ?? ''

  const resetMutationErrors = useCallback(() => {
    checkUserMutation.reset()
    sendOtpMutation.reset()
    verifyLoginMutation.reset()
  }, [checkUserMutation, sendOtpMutation, verifyLoginMutation])

  const phoneInputRef = useRef<HTMLInputElement>(null)
  const codeInputRef = useRef<HTMLInputElement>(null)

  const handleGoBack = useCallback(() => {
    if (window.history.length > 1) {
      window.history.back()
    } else {
      navigate({ to: '/' })
    }
  }, [navigate]);

  // --- فرم شماره — اول چک کاربر جدید (بدون پیامک)، بعد ارسال ---
  const phoneForm = useForm({
    defaultValues: { phone: '' },
    onSubmit: async ({ value }) => {
      resetMutationErrors()
      setNeedsTerms(false)
      try {
        const check = await checkUserMutation.mutateAsync(value.phone)
        setIsNewUser(check.isNewUser)

        if (check.isNewUser && !termsAccepted) {
          setNeedsTerms(true)
          return
        }
        await sendOtpMutation.mutateAsync(value.phone)
        setPhone(value.phone)
      } catch { /* serverError */ }
    },
  })

  // --- فرم OTP + تشخیص نقش ---
  const otpForm = useForm({
    defaultValues: { code: '' },
    onSubmit: async ({ value }) => {
      resetMutationErrors()
      try {
        const result = await verifyLoginMutation.mutateAsync({ phone, code: value.code })
        const role = result.user.role

        if (role === 'admin') {
          login(true, 'admin')
          if (search.redirect) router.history.push(search.redirect)
          else navigate({ to: '/admin', replace: true })
        } else if (role === 'admin2') {
          login(true, 'admin2', result.user.id)
          if (result.queueCount && result.queueCount > 0) {
            showToast(`${result.queueCount} سفارش در صفِ حوزه‌ی شما به شما تحویل شد`)
          }
          if (search.redirect) router.history.push(search.redirect)
          else navigate({ to: '/admin/admin2/live-orders', replace: true })
        } else {
          login(true, 'user')
          if (result.isNewUser) {
            clearStoredRef()
            showToast('ثبت‌نام شما با موفقیت انجام شد! خوش آمدید 🎉')
          }
          if (search.redirect) router.history.push(search.redirect)
          else navigate({ to: '/products', replace: true })
        }
      } catch {
        // serverError
      }
    },
  })

  const handleResend = useCallback(async () => {
    if (loading || !phone) return
    sendOtpMutation.reset()
    try {
      await sendOtpMutation.mutateAsync(phone)
      otpForm.setFieldValue('code', '')
      showToast('کد جدید ارسال شد')
      codeInputRef.current?.focus()
    } catch {
      // serverError
    }
  }, [loading, phone, otpForm, showToast, sendOtpMutation])

  useEffect(() => {
    if (step === 'phone') phoneInputRef.current?.focus()
    else codeInputRef.current?.focus()
  }, [step])

  const handlePhoneInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    phoneForm.setFieldValue('phone', e.target.value.replace(/[^0-9]/g, ''))
  }, [phoneForm])

  const handleCodeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/[^0-9]/g, '')
    otpForm.setFieldValue('code', value)
    if (value.length === 4) {
      setTimeout(() => otpForm.handleSubmit(), 150)
    }
  }, [otpForm])

  const handleCodeKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      otpForm.handleSubmit()
    }
  }, [otpForm])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#1a0a0e] p-4">
      <div className="w-full max-w-md">

        <button
          type="button"
          onClick={handleGoBack}
          className="flex items-center gap-2 text-gray-600 dark:text-gray-300 hover:text-primary dark:hover:text-dark-primary transition font-DanaMedium mb-4 cursor-pointer w-fit"
        >
          <ChevronRight size={20} />
          بازگشت
        </button>

        <div className="bg-white dark:bg-[#2a1015] p-8 rounded-2xl shadow-xl border border-gray-100 dark:border-[#3a151c]">

          {step === 'phone' ? (
            <div>
              <h1 className="font-MorabbaBold text-2xl text-gray-900 dark:text-[#f5e0e6] mb-6 text-center">
                ورود / ثبت‌نام
              </h1>
              <form onSubmit={(e) => { e.preventDefault(); phoneForm.handleSubmit() }} className="space-y-6">
                <phoneForm.Field
                  name="phone"
                  validators={{
                    onChange: ({ value }) => {
                      if (!value) return 'شماره موبایل الزامی است.'
                      if (!/^09[0-9]{9}$/.test(value)) return 'فرمت شماره صحیح نیست (09xxxxxxxxx)'
                      return undefined
                    }
                  }}
                >
                  {(field) => (
                    <div>
                      <input
                        ref={phoneInputRef}
                        type="tel"
                        inputMode="numeric"
                        dir="ltr"
                        className="w-full text-center p-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border-2 border-gray-200 dark:border-[#3a151c] focus:border-primary dark:focus:border-dark-primary outline-none transition text-gray-900 dark:text-[#f5e0e6]"
                        placeholder="0912 345 6789"
                        value={field.state.value}
                        onChange={handlePhoneInput}
                      />
                      <p className="text-xs text-gray-400 text-center mt-3 font-DanaRegular">
                        در ورود شماره تلفن دقت کنید، چون قابل تغییر نیست.
                      </p>
                      {field.state.meta.errors.length > 0 && (
                        <p className="text-red-500 text-sm mt-2 text-center">{field.state.meta.errors[0]}</p>
                      )}
                    </div>
                  )}
                </phoneForm.Field>

                {/* ⬅ کاربر جدید: قوانین قبل از ارسال پیامک (صرفه‌جویی هزینه) */}
                {isNewUser && (
                  <div className="space-y-3">
                    {refCode && (
                      <div className="flex items-center gap-2 p-3 rounded-xl bg-primary/5 dark:bg-dark-primary/5 border border-primary/20 dark:border-dark-primary/20 text-sm text-primary dark:text-dark-primary font-DanaMedium">
                        <Gift size={16} className="shrink-0" />
                        <span>شما با کد معرف <span className="font-DanaDemiBold" dir="ltr">{refCode}</span> دعوت شده‌اید</span>
                      </div>
                    )}
                    <div className="p-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] space-y-3">
                      <label className={`flex items-start gap-2.5 ${termsRead ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
                        <input
                          type="checkbox"
                          checked={termsAccepted}
                          onChange={(e) => {
                            setTermsAccepted(e.target.checked)
                            if (e.target.checked) setNeedsTerms(false)
                          }}
                          disabled={!termsRead}
                          className="w-4 h-4 mt-0.5 accent-primary dark:accent-dark-primary cursor-pointer shrink-0 disabled:cursor-not-allowed"
                        />
                        <span className="text-xs text-gray-600 dark:text-gray-300 font-DanaMedium leading-relaxed">
                          <span className="font-DanaDemiBold">قوانین و شرایط سین‌شین</span> را خواندم و می‌پذیرم.
                        </span>
                      </label>

                      {!termsRead ? (
                        <button
                          type="button"
                          onClick={() => setTermsModalOpen(true)}
                          className="w-full py-2.5 rounded-xl bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary text-xs font-DanaDemiBold hover:bg-primary/20 dark:hover:bg-dark-primary/20 transition cursor-pointer"
                        >
                          مشاهده قوانین — تا انتهای متن اسکرول کنید
                        </button>
                      ) : (
                        <p className="text-[10px] text-green-500 font-DanaMedium">
                          قوانین مطالعه شد — می‌توانید تیک بزنید
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {serverError && <p className="text-red-500 text-center text-sm">{serverError}</p>}
                {needsTerms && !serverError && (
                  <p className="text-red-500 text-center text-sm">برای دریافت کد تأیید، ابتدا قوانین را مطالعه و بپذیرید.</p>
                )}

                <button
                  type="submit"
                  disabled={loading || (isNewUser && !termsAccepted)}
                  className="w-full py-3 rounded-xl bg-primary dark:bg-dark-primary text-white font-MorabbaMedium hover:opacity-90 transition disabled:opacity-50 cursor-pointer"
                >
                  {loading ? 'در حال بررسی...' : 'دریافت کد تایید'}
                </button>
              </form>
            </div>
          ) : (
            <div>
              <h1 className="font-MorabbaBold text-2xl text-gray-900 dark:text-[#f5e0e6] mb-2 text-center">
                کد تایید را وارد کنید
              </h1>
              <p className="text-gray-500 dark:text-gray-400 text-center text-sm mb-6">
                کد ارسال شده به <span dir="ltr">{phone}</span>
              </p>

              {/* بنر معرف — کاربر جدید (قوانین در مرحله قبل پذیرفته شده) */}
              {isNewUser && refCode && (
                <div className="flex items-center gap-2 p-3 mb-5 rounded-xl bg-primary/5 dark:bg-dark-primary/5 border border-primary/20 dark:border-dark-primary/20 text-sm text-primary dark:text-dark-primary font-DanaMedium">
                  <Gift size={16} className="shrink-0" />
                  <span>ثبت‌نام با کد معرف <span className="font-DanaDemiBold" dir="ltr">{refCode}</span></span>
                </div>
              )}

              <form onSubmit={(e) => { e.preventDefault(); otpForm.handleSubmit() }} className="space-y-6">
                <otpForm.Field
                  name="code"
                  validators={{
                    onChange: ({ value }) => {
                      if (!/^[0-9]{4}$/.test(value)) return 'کد باید ۴ رقم باشد.'
                      return undefined
                    }
                  }}
                >
                  {(field) => (
                    <div>
                      <input
                        ref={codeInputRef}
                        type="text"
                        inputMode="numeric"
                        dir="ltr"
                        maxLength={4}
                        autoComplete="one-time-code"
                        className="w-full text-center text-2xl tracking-[0.5em] p-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border-2 border-gray-200 dark:border-[#3a151c] focus:border-primary dark:focus:border-dark-primary outline-none transition text-gray-900 dark:text-[#f5e0e6]"
                        placeholder="• • • •"
                        value={field.state.value}
                        onChange={handleCodeChange}
                        onKeyDown={handleCodeKeyDown}
                      />
                      {field.state.meta.errors.length > 0 && (
                        <p className="text-red-500 text-sm mt-2 text-center">{field.state.meta.errors[0]}</p>
                      )}
                    </div>
                  )}
                </otpForm.Field>

                {serverError && <p className="text-red-500 text-center text-sm">{serverError}</p>}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 rounded-xl bg-primary dark:bg-dark-primary text-white font-MorabbaMedium hover:opacity-90 transition disabled:opacity-50 cursor-pointer"
                >
                  {loading ? 'در حال بررسی...' : (isNewUser ? 'ثبت‌نام و ورود' : 'تایید و ورود')}
                </button>

                <div className="text-center">
                  {resendIn > 0 ? (
                    <p className="text-xs text-gray-400 font-DanaMedium">
                      ارسال مجدد کد تا {faNum(resendIn)} ثانیه دیگر
                    </p>
                  ) : (
                    <button
                      type="button"
                      onClick={handleResend}
                      disabled={loading}
                      className="text-xs text-primary dark:text-dark-primary hover:underline cursor-pointer font-DanaMedium disabled:opacity-50"
                    >
                      ارسال مجدد کد
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => { setStep('phone'); resetMutationErrors() }}
                  className="w-full text-gray-500 dark:text-gray-400 text-sm hover:text-primary dark:hover:text-dark-primary transition cursor-pointer"
                >
                  تغییر شماره موبایل
                </button>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* مدال قوانین — اسکرول تا انتها اجباری */}
      <TermsModal
        isOpen={termsModalOpen}
        onClose={() => setTermsModalOpen(false)}
        onReadComplete={() => setTermsRead(true)}
      />
    </div>
  )
}