// ═══════════════════════════════════════════════════════════════
// round-38 — sinshin-food-delivery — فایل 14 از 18
// مسیر مقصد: web/src/routes/login.tsx
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty-four
// ═══════════════════════════════════════════════════════════════

// src/routes/login.tsx

import { useForm } from '@tanstack/react-form'
import { useMutation } from '@tanstack/react-query'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight, Gift } from 'reicon-react'
import { z } from 'zod'
import { LangSwitcher } from '#/components/LangSwitcher'
import { TermsModal } from '#/components/site/auth/TermsModal'
import { I18nProvider, tpl, useI18n } from '#/i18n'
import { noindexHead } from '#/lib/seo'
import { checkIsNewUser, requestOtp, verifyOtp } from '#/server/auth'
import { useAuthStore } from '#/stores/authStore'
import { useToastStore } from '#/stores/toastStore'
import { collectDeviceSignals } from '#/utils/deviceFingerprint'
import { clearStoredRef, getStoredRef } from '#/utils/referralCapture'

export const Route = createFileRoute('/login')({
	validateSearch: z.object({ redirect: z.string().optional() }),
	component: LoginRoute,
	// سئو-۲: صفحه‌ی ورود ارزش ایندکس ندارد و محتوایش برای گوگل نویز است.
	// (در robots.txt عمداً Disallow نشده تا گوگل بتواند این noindex را ببیند.)
	// رارد ۳۸ — noindex با عنوان دوزبانه (تب مرورگر در حالت عربی عربی می‌ماند)
	head: noindexHead('login'),
})

// رارد ۳۱ — Provider در ریشه‌ی همین صفحه (نه ریشه‌ی اپ): ترجمه فقط به
// لایه‌های سایت/پنل کاربر می‌رسد؛ ادمین و پیک هرگز Provider نمی‌بینند.
function LoginRoute() {
	const { lang } = Route.useRouteContext()
	return (
		<I18nProvider initialLang={lang ?? 'fa'}>
			<LoginPage />
		</I18nProvider>
	)
}

function LoginPage() {
	const navigate = useNavigate()
	const router = useRouter()
	const search = Route.useSearch()
	const login = useAuthStore((s) => s.login)
	const showToast = useToastStore((s) => s.showToast)
	// رارد ۳۱ — دیکشنری دوزبانه + فرمترهای عدد/تاریخ زبان‌آگاه
	const { t, fmt } = useI18n()

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
	}, [])

	useEffect(() => {
		if (resendIn <= 0) return
		const timer = setTimeout(() => setResendIn((v) => v - 1), 1000)
		return () => clearTimeout(timer)
	}, [resendIn])

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
		checkUserMutation.isPending ||
		sendOtpMutation.isPending ||
		verifyLoginMutation.isPending

	// ⬅ serverError: مشتق از error میوتیشن‌ها — نه useState دستی
	const serverError =
		verifyLoginMutation.error?.message ??
		sendOtpMutation.error?.message ??
		checkUserMutation.error?.message ??
		''

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
	}, [navigate])

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
			} catch {
				/* serverError */
			}
		},
	})

	// --- فرم OTP + تشخیص نقش ---
	const otpForm = useForm({
		defaultValues: { code: '' },
		onSubmit: async ({ value }) => {
			resetMutationErrors()
			try {
				const result = await verifyLoginMutation.mutateAsync({
					phone,
					code: value.code,
				})
				const role = result.user.role

				if (role === 'admin') {
					login(true, 'admin')
					if (search.redirect) router.history.push(search.redirect)
					else navigate({ to: '/admin', replace: true })
				} else if (role === 'admin2') {
					login(true, 'admin2', result.user.id)
					if (result.queueCount && result.queueCount > 0) {
						showToast(
							tpl(t['login.queueToast'], { n: fmt.num(result.queueCount) }),
						)
					}
					if (search.redirect) router.history.push(search.redirect)
					else navigate({ to: '/admin/admin2/live-orders', replace: true })
				} else {
					login(true, 'user')
					if (result.isNewUser) {
						clearStoredRef()
						showToast(t['login.welcomeToast'])
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
			showToast(t['login.newCodeToast'])
			codeInputRef.current?.focus()
		} catch {
			// serverError
		}
	}, [loading, phone, otpForm, showToast, sendOtpMutation, t])

	useEffect(() => {
		if (step === 'phone') phoneInputRef.current?.focus()
		else codeInputRef.current?.focus()
	}, [step])

	const handlePhoneInput = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			phoneForm.setFieldValue('phone', e.target.value.replace(/[^0-9]/g, ''))
		},
		[phoneForm],
	)

	const handleCodeChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const value = e.target.value.replace(/[^0-9]/g, '')
			otpForm.setFieldValue('code', value)
			if (value.length === 6) {
				setTimeout(() => otpForm.handleSubmit(), 150)
			}
		},
		[otpForm],
	)

	const handleCodeKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLInputElement>) => {
			if (e.key === 'Enter') {
				e.preventDefault()
				otpForm.handleSubmit()
			}
		},
		[otpForm],
	)

	return (
		<div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#1a0a0e] p-4">
			{/* سوییچر زبان — گوشه‌ی چپ‌بالا؛ کارت وسط صفحه است و تداخلی ندارد */}
			<LangSwitcher className="fixed top-6 left-6 z-50" />

			<div className="w-full max-w-md">
				<button
					type="button"
					onClick={handleGoBack}
					className="flex items-center gap-2 text-gray-600 dark:text-gray-300 hover:text-primary dark:hover:text-dark-primary transition font-DanaMedium mb-4 cursor-pointer w-fit"
				>
					<ChevronRight size={20} />
					{t['login.back']}
				</button>

				<div className="bg-white dark:bg-[#2a1015] p-8 rounded-2xl shadow-xl border border-gray-100 dark:border-[#3a151c]">
					{step === 'phone' ? (
						<div>
							<h1 className="font-MorabbaBold text-2xl text-gray-900 dark:text-[#f5e0e6] mb-6 text-center">
								{t['login.title']}
							</h1>
							<form
								onSubmit={(e) => {
									e.preventDefault()
									phoneForm.handleSubmit()
								}}
								className="space-y-6"
							>
								<phoneForm.Field
									name="phone"
									validators={{
										onChange: ({ value }) => {
											if (!value) return t['login.phoneRequired']
											if (!/^09[0-9]{9}$/.test(value))
												return t['login.phoneFormat']
											return undefined
										},
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
												{t['login.phoneHint']}
											</p>
											{field.state.meta.errors.length > 0 && (
												<p className="text-red-500 text-sm mt-2 text-center">
													{field.state.meta.errors[0]}
												</p>
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
												<span>
													{t['login.refInvited']}{' '}
													<span className="font-DanaDemiBold" dir="ltr">
														{refCode}
													</span>{' '}
													{t['login.refInvitedSuffix']}
												</span>
											</div>
										)}
										<div className="p-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] space-y-3">
											<label
												className={`flex items-start gap-2.5 ${termsRead ? 'cursor-pointer' : 'cursor-not-allowed'}`}
											>
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
													<span className="font-DanaDemiBold">
														{t['login.termsLabel']}
													</span>{' '}
													{t['login.termsRest']}
												</span>
											</label>

											{!termsRead ? (
												<button
													type="button"
													onClick={() => setTermsModalOpen(true)}
													className="w-full py-2.5 rounded-xl bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary text-xs font-DanaDemiBold hover:bg-primary/20 dark:hover:bg-dark-primary/20 transition cursor-pointer"
												>
													{t['login.viewTerms']}
												</button>
											) : (
												<p className="text-[10px] text-green-500 font-DanaMedium">
													{t['login.termsReadOk']}
												</p>
											)}
										</div>
									</div>
								)}

								{serverError && (
									<p className="text-red-500 text-center text-sm">
										{serverError}
									</p>
								)}
								{needsTerms && !serverError && (
									<p className="text-red-500 text-center text-sm">
										{t['login.termsRequired']}
									</p>
								)}

								<button
									type="submit"
									disabled={loading || (isNewUser && !termsAccepted)}
									className="w-full py-3 rounded-xl bg-primary dark:bg-dark-primary text-white font-MorabbaMedium hover:opacity-90 transition disabled:opacity-50 cursor-pointer"
								>
									{loading ? t['login.checking'] : t['login.sendCode']}
								</button>
							</form>
						</div>
					) : (
						<div>
							<h1 className="font-MorabbaBold text-2xl text-gray-900 dark:text-[#f5e0e6] mb-2 text-center">
								{t['login.otpTitle']}
							</h1>
							<p className="text-gray-500 dark:text-gray-400 text-center text-sm mb-6">
								{t['login.otpSentTo']} <span dir="ltr">{phone}</span>
							</p>

							{/* بنر معرف — کاربر جدید (قوانین در مرحله قبل پذیرفته شده) */}
							{isNewUser && refCode && (
								<div className="flex items-center gap-2 p-3 mb-5 rounded-xl bg-primary/5 dark:bg-dark-primary/5 border border-primary/20 dark:border-dark-primary/20 text-sm text-primary dark:text-dark-primary font-DanaMedium">
									<Gift size={16} className="shrink-0" />
									<span>
										{t['login.refSignup']}{' '}
										<span className="font-DanaDemiBold" dir="ltr">
											{refCode}
										</span>
									</span>
								</div>
							)}

							<form
								onSubmit={(e) => {
									e.preventDefault()
									otpForm.handleSubmit()
								}}
								className="space-y-6"
							>
								<otpForm.Field
									name="code"
									validators={{
										onChange: ({ value }) => {
											if (!/^[0-9]{6}$/.test(value)) return t['login.codeRule']
											return undefined
										},
									}}
								>
									{(field) => (
										<div>
											<input
												ref={codeInputRef}
												type="text"
												inputMode="numeric"
												dir="ltr"
												maxLength={6}
												autoComplete="one-time-code"
												className="w-full text-center text-2xl tracking-[0.5em] p-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border-2 border-gray-200 dark:border-[#3a151c] focus:border-primary dark:focus:border-dark-primary outline-none transition text-gray-900 dark:text-[#f5e0e6]"
												placeholder="• • • • • •"
												value={field.state.value}
												onChange={handleCodeChange}
												onKeyDown={handleCodeKeyDown}
											/>
											{field.state.meta.errors.length > 0 && (
												<p className="text-red-500 text-sm mt-2 text-center">
													{field.state.meta.errors[0]}
												</p>
											)}
										</div>
									)}
								</otpForm.Field>

								{serverError && (
									<p className="text-red-500 text-center text-sm">
										{serverError}
									</p>
								)}

								<button
									type="submit"
									disabled={loading}
									className="w-full py-3 rounded-xl bg-primary dark:bg-dark-primary text-white font-MorabbaMedium hover:opacity-90 transition disabled:opacity-50 cursor-pointer"
								>
									{loading
										? t['login.checking']
										: isNewUser
											? t['login.signup']
											: t['login.verify']}
								</button>

								<div className="text-center">
									{resendIn > 0 ? (
										<p className="text-xs text-gray-400 font-DanaMedium">
											{tpl(t['login.resendIn'], { n: fmt.num(resendIn) })}
										</p>
									) : (
										<button
											type="button"
											onClick={handleResend}
											disabled={loading}
											className="text-xs text-primary dark:text-dark-primary hover:underline cursor-pointer font-DanaMedium disabled:opacity-50"
										>
											{t['login.resend']}
										</button>
									)}
								</div>

								<button
									type="button"
									onClick={() => {
										setStep('phone')
										resetMutationErrors()
									}}
									className="w-full text-gray-500 dark:text-gray-400 text-sm hover:text-primary dark:hover:text-dark-primary transition cursor-pointer"
								>
									{t['login.changePhone']}
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
