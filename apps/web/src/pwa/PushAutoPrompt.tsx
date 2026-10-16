// ═══════════════════════════════════════════════════════════════
// stage-69 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/pwa/PushAutoPrompt.tsx
// ویرایش نقطه‌ای (اسکن post-s67 — F1/F2):
//   F1 — بنر شناور (fixed bottom-24) دکمه‌ی «دریافت کد تایید» لاگین را
//        می‌پوشاند (کلیک intercepted در E2E) و در دسکتاپ روی آیتم‌های
//        لیست صندوق هم‌پوشانی دارد.
//   F2 — در صفحه‌ی صندوق، بنرِ جهانی + کارت InboxPushCard هم‌زمان
//        «پرامپت دوتایی» می‌سازند.
// راه‌حل: «صفحاتِ متمرکز» (login / dashboard/notifications) بنر را
// باز/نمی‌گذارند — مسیر فعال از روتر خوانده می‌شود (واکنشی به ناوبری
// SPA). فلوی خودِ بنر (throttle ۳روزه، reconcile، SW-message، iOS
// guard) عیناً دست‌نخورده.
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// stage-64 — sinshin-food-delivery — فایل جدید (جایگزین کامل stage-58)
// مسیر مقصد: apps/web/src/pwa/PushAutoPrompt.tsx
// کامیت پیشنهادی: stage sixty-four
// ═══════════════════════════════════════════════════════════════

// src/pwa/PushAutoPrompt.tsx
/**
 * stage-64 — بنرِ فعال‌سازی نوتیفیکیشن «مبتنی بر کلیک» (رفع یافته‌ی ممیزی).
 *
 * چرا تغییر؟ Notification.requestPermission باید از یک «ژست کاربر» (کلیک)
 * صدا زده شود؛ stage-58 بعد از ۲.۵ ثانیه بدون کلیک می‌پرسید:
 *  • کروم/فایرفاکس پرامپتِ بی‌ژست را خیلی زود quiet می‌کنند ⇒ کاربر
 *    هیچ‌وقت شانس «Allow» دیدن را نمی‌گرفت.
 *  • Safari/iOS رد را «دائم» ثبت می‌کند (بازگشت فقط از تنظیمات) ⇒
 *    کاربر تازه عملاً تا ابد پوش را از دست می‌داد — عکسِ هدف stage-58.
 *
 * فلوی جدید:
 *  • صفحه باز شد (۲.۵s بعد): permission==='granted' ⇒ همان reconcile
 *    خودکارِ قبل (بدون UI). 'default' ⇒ «بنر» با دکمه‌ی فعال‌سازی —
 *    فقط با کلیکِ کاربر enablePush (و داخلش requestPermission) اجرا
 *    می‌شود. 'denied'/'unsupported' ⇒ هیچ (بنر مزاحم نیست).
 *  • بستن بنر («بعداً») = همان throttle سه‌روزه‌ی قبل (AUTO_PROMPT_KEY).
 *  • مهمان هم بنر را می‌بیند؛ اشتراک محلی ساخته می‌شود و ثبت سرور
 *    بعد از لاگین (pendingLogin + effect روی isAuthenticated) انجام می‌شود.
 *  • iOS مرورگرِ غیرنصب‌شده: بنر نشان داده نمی‌شود (پوش ممکن نیست؛
 *    راهنمای نصب PWA جای درستش در register-sw است).
 *  • پیام PUSH_SUBSCRIPTION_CHANGED از SW (چرخش endpoint) ⇒ فوراً
 *    reconcile تا اشتراک تازه در سرور ثبت شود.
 *
 * زبان بنر: از کوکی sinshin-lang (خوانده‌شده در مانت) — این کامپوننت
 * بیرون از I18nProvider در __root نشسته و useI18nSafe فقط فارسی
 * می‌دهد؛ مسیرهای /admin و /courier همیشه فارسی (پنل ترجمه نمی‌شود).
 */

import { useRouterState } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { BellRing, X } from 'reicon-react'
import type { Lang } from '#/i18n'
import { DICTS, readLangCookie } from '#/i18n'
import {
        AUTO_PROMPT_KEY,
        AUTO_PROMPT_RETRY_DAYS,
        enablePush,
        getPushState,
        type PushFailureReason,
        reconcileSubscription,
} from '#/lib/push-subscription'
import { useAuthStore } from '#/stores/authStore'

/** مکث اولیه — UX: صفحه آماده شود، بعد بنر (نه وسط لود) */
const INITIAL_DELAY_MS = 2500
/** حالت موفق: بنر بعد از چند ثانیه خودش جمع می‌شود */
const DONE_AUTOHIDE_MS = 3500

type BannerPhase = 'hidden' | 'prompt' | 'busy' | 'done' | 'denied' | 'failed'

/** iOS مرورگرِ غیرنصب‌شده — پوش ممکن نیست؛ بنر بی‌معنا و گمراه‌کننده است */
function isIosBrowserWithoutInstall(): boolean {
        const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)
        const isStandalone =
                window.matchMedia('(display-mode: standalone)').matches ||
                (window.navigator as unknown as { standalone?: boolean }).standalone ===
                        true
        return isIos && !isStandalone
}

/** آیا کاربر اخیراً (ظرف مهلت) بنر را بسته است؟ */
function dismissedWithin(days: number): boolean {
        try {
                const last = Number(localStorage.getItem(AUTO_PROMPT_KEY) ?? '0')
                return Number.isFinite(last) && Date.now() - last < days * 86_400_000
        } catch {
                return false
        }
}

/** بستن پایدار — مهلت‌دار (همان کلید/معنای stage-58) */
function markDismissed(): void {
        try {
                localStorage.setItem(AUTO_PROMPT_KEY, String(Date.now()))
        } catch {
                /* حافظه پر/عدم دسترسی — بی‌اثر */
        }
}

/*
 * stage-69 (F1/F2) — صفحاتِ «تمرکز» که بنر شناور نباید رویشان بیاید:
 *  • /login — کارتِ وسط‌چینِ تمام‌صفحه است و دکمه‌ی «دریافت کد تایید»
 *    دقیقاً جای بنرِ fixed bottom-24 می‌نشست؛ کلیک روی CTA توسط بنر
 *    بلعیده می‌شد (کلیک intercepted در E2E). ورود/OTP فلویِ تک‌کار است؛
 *    پرامپتِ پوش جایش بعد از لاگین/در مرور عادی است، نه وسطِ فرم.
 *  • /dashboard/notifications — کارت InboxPushCard با CTA و راهنمای
 *    کامل همان‌جاست؛ بنرِ موازی یعنی «پرامپت دوتایی» (F2) و هم‌پوشانیِ
 *    دسکتاپ روی آیتم‌های لیست (F1).
 * باز/بسته شدن واکنشی است: ورود به این مسیرها بنرِ باز را فوراً
 * می‌بندد و تایمرِ معلق را لغو می‌کند؛ خروج از آن‌ها تایمر را دوباره
 * مسلح می‌کند (بنر در مرور عادی همان‌طور که بود کار می‌کند).
 */
const SUPPRESSED_PATHS = ['/login', '/dashboard/notifications']

function isSuppressedPath(pathname: string): boolean {
        return SUPPRESSED_PATHS.some(
                (p) => pathname === p || pathname.startsWith(`${p}/`),
        )
}

export function PushAutoPrompt() {
        const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
        const [phase, setPhase] = useState<BannerPhase>('hidden')
        const [failureReason, setFailureReason] = useState<PushFailureReason | null>(
                null,
        )
        // stage-69 (F1/F2) — مسیر فعال از روتر (واکنشی به ناوبری SPA؛ نه
        // فقط window.location لحظه‌ی مانت). روی صفحات متمرکز بنر باز/نمی‌شود.
        const suppressed = isSuppressedPath(
                useRouterState({ select: (s) => s.location.pathname }),
        )
        /** مقدار لحظه‌ای برای تایمرِ mount — رِف تا در fire-time تازه بخوانیم */
        const suppressedRef = useRef(suppressed)
        useEffect(() => {
                suppressedRef.current = suppressed
        }, [suppressed])
        /** زبان بنر — یک‌بار در مانت (تعویض زبان وسطِ بنر، مورد نیست) */
        const [lang] = useState<Lang>(() => {
                if (typeof window === 'undefined') return 'fa'
                // پنل ادمین/پیک همیشه فارسی است — کوکی ar برای آن‌ها بی‌معناست
                if (
                        window.location.pathname.startsWith('/admin') ||
                        window.location.pathname.startsWith('/courier')
                ) {
                        return 'fa'
                }
                return readLangCookie() ?? 'fa'
        })
        const t = DICTS[lang]
        const hideTimer = useRef<number | null>(null)

        const scheduleHide = useCallback((ms: number) => {
                if (hideTimer.current !== null) window.clearTimeout(hideTimer.current)
                hideTimer.current = window.setTimeout(() => setPhase('hidden'), ms)
        }, [])

        // ── باز شدن صفحه: ارزیابی وضعیت + reconcile خودکارِ مجوزدارها ──
        // stage-69 — کلیدِ وابستگی «suppressed»: روی صفحه‌ی متمرکز تایمر
        // مسلح نمی‌شود/لغو می‌شود؛ با خروج از آن دوباره مسلح می‌شود (۲.۵s
        // بعد از ورود به صفحه‌ی عادی). سیاستِ throttle و بقیه‌ی منطق عیناً قبل.
        useEffect(() => {
                if (typeof window === 'undefined') return
                if (suppressed) return
                let cancelled = false
                const timer = window.setTimeout(async () => {
                        if (cancelled || suppressedRef.current) return
                        if (isIosBrowserWithoutInstall()) return
                        const state = await getPushState().catch(() => null)
                        if (cancelled || !state) return
                        if (state.state === 'granted') {
                                // مجوز هست — فقط درست‌سازی ثبت (بدون UI، بدون پرامپت)
                                void reconcileSubscription().catch(() => {})
                                return
                        }
                        if (
                                state.state === 'default' &&
                                !dismissedWithin(AUTO_PROMPT_RETRY_DAYS)
                        ) {
                                setPhase('prompt')
                        }
                        // denied / unsupported ⇒ بی‌سروصدا
                }, INITIAL_DELAY_MS)

                return () => {
                        cancelled = true
                        window.clearTimeout(timer)
                }
        }, [suppressed])

        // ── stage-69 (F1/F2) — ورود به صفحه‌ی متمرکز با بنرِ باز ⇒ فوراً بسته ──
        useEffect(() => {
                if (!suppressed) return
                setPhase('hidden')
                if (hideTimer.current !== null) {
                        window.clearTimeout(hideTimer.current)
                        hideTimer.current = null
                }
        }, [suppressed])

        // ── چرخش/انقضای اشتراک از سمت SW — فوراً آشتی کن ──
        useEffect(() => {
                if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
                const onSwMessage = (event: MessageEvent) => {
                        const data = event.data as { type?: string } | null
                        if (data?.type === 'PUSH_SUBSCRIPTION_CHANGED') {
                                void reconcileSubscription().catch(() => {})
                        }
                }
                navigator.serviceWorker.addEventListener('message', onSwMessage)
                return () =>
                        navigator.serviceWorker.removeEventListener('message', onSwMessage)
        }, [])

        // ── بعد از لاگین: اشتراکِ مهمانِ pending را در سرور ثبت کن ──
        useEffect(() => {
                if (!isAuthenticated) return
                void reconcileSubscription().catch(() => {})
        }, [isAuthenticated])

        // پاک‌سازی تایمر حالت موفق
        useEffect(
                () => () => {
                        if (hideTimer.current !== null) window.clearTimeout(hideTimer.current)
                },
                [],
        )

        // ── stage-72 (P2-۱۴) — a11y: بنر غیر-مسدودکننده است؛ role=dialog بدون
        // aria-modal/focus مدیریت‌نشده بود. حالا role=status (اعلان ظاهر شدن) +
        // Escape = بستن (همان throttle سه‌روزه‌ی دکمه‌ی X)
        useEffect(() => {
                if (phase === 'hidden' || phase === 'busy') return
                const onKey = (e: KeyboardEvent) => {
                        if (e.key === 'Escape') {
                                markDismissed()
                                setPhase('hidden')
                        }
                }
                window.addEventListener('keydown', onKey)
                return () => window.removeEventListener('keydown', onKey)
        }, [phase])

        /** کلیک «فعال‌سازی» — ژست کاربر ✓ ⇒ requestPermission مجاز است */
        // stage-72 (P2-۱۴) — از فاز failed هم مجاز است: دکمه‌ی «بررسی مجدد»
        // قبلاً بی‌اثر بود (گارد فقط prompt را رد می‌کرد و کلیک لا-اُپ می‌شد)
        const onEnable = async () => {
                if (phase !== 'prompt' && phase !== 'failed') return
                setPhase('busy')
                setFailureReason(null)
                const state = await enablePush().catch(() => null)
                if (state === null) {
                        setPhase('failed')
                        return
                }
                if (state.state === 'denied') {
                        // کاربر (یا خود مرورگر) رد کرد — راهنمای بازگشت از تنظیمات
                        setPhase('denied')
                        scheduleHide(DONE_AUTOHIDE_MS * 3)
                        return
                }
                if (state.state === 'default') {
                        // پرامپت بدون پاسخ بسته شد (کروم) — بنر می‌ماند؛ کلیک بعدی دوباره می‌پرسد
                        setPhase('prompt')
                        return
                }
                if (state.state === 'unsupported') {
                        setPhase('hidden')
                        return
                }
                if (state.subscribed || state.pendingLogin) {
                        // subscribed: خط کامل ✓ — pendingLogin: مهمان؛ بعد از لاگین ثبت می‌شود
                        setPhase('done')
                        scheduleHide(DONE_AUTOHIDE_MS)
                        return
                }
                // granted ولی ثبت/اشتراک شکست خورد — پیامِ دقیقِ همان مرحله
                setFailureReason(state.failureReason ?? 'register')
                setPhase('failed')
        }

        if (phase === 'hidden') return null

        const busy = phase === 'busy'

        return (
                // biome-ignore lint/a11y/useSemanticElements: بنر زنده‌ی غیر-مسدودکننده — role=status عمدی است (اعلان ظاهر/تازه شدن برای صفحه‌خوان؛ عنصر معنایی معادل ندارد)
                <div
                        role="status"
                        aria-label={t['notify.enable.title']}
                        // bottom-24: بالاتر از بنرهای نصب/آپدیتِ register-sw (bottom-4)
                        // تا روی هم نیفتند — هر دو z-9999 ولی جاهای متفاوت.
                        className="fixed bottom-24 left-1/2 -translate-x-1/2 z-9999 flex items-center gap-3 bg-white dark:bg-[#2a1015] rounded-2xl px-4 py-3 shadow-[0_4px_20px_rgba(0,0,0,0.15)] border border-gray-200 dark:border-[#3a151c] max-w-[calc(100vw-2rem)]"
                >
                        <span className="w-10 h-10 rounded-xl bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary flex items-center justify-center shrink-0">
                                <BellRing size={20} />
                        </span>
                        <div className="min-w-0 flex-1">
                                {phase === 'prompt' && (
                                        <>
                                                <p className="text-[13px] font-DanaDemiBold text-gray-800 dark:text-gray-100 truncate">
                                                        {t['notify.enable.title']}
                                                </p>
                                                <p className="text-[11px] text-gray-500 dark:text-gray-400 font-DanaMedium truncate">
                                                        {t['notify.enable.subtitle']}
                                                </p>
                                        </>
                                )}
                                {busy && (
                                        <p className="text-[13px] font-DanaMedium text-gray-600 dark:text-gray-300 animate-pulse">
                                                {t['notify.enable.busy']}
                                        </p>
                                )}
                                {phase === 'done' && (
                                        <p className="text-[13px] font-DanaDemiBold text-green-600 dark:text-green-400">
                                                {t['notify.enable.done']}
                                        </p>
                                )}
                                {phase === 'denied' && (
                                        <p className="text-[11px] font-DanaMedium text-orange-500 dark:text-orange-400 leading-relaxed line-clamp-3">
                                                {t['notify.enable.deniedHint']}
                                        </p>
                                )}
                                {phase === 'failed' && (
                                        <>
                                                <p className="text-[11px] font-DanaMedium text-red-500 dark:text-red-400 leading-relaxed">
                                                        {failureReason === 'vapid' && t['notify.enable.errKey']}
                                                        {failureReason === 'subscribe' && t['notify.enable.errSubscribe']}
                                                        {failureReason === 'invalid' && t['notify.enable.errInvalid']}
                                                        {(failureReason === null || failureReason === 'register') &&
                                                                t['notify.enable.errRegister']}
                                                </p>
                                                <p className="text-[10px] text-gray-400 dark:text-gray-500 font-DanaMedium leading-relaxed line-clamp-2">
                                                        {t['notify.enable.retryHint']}
                                                </p>
                                        </>
                                )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                                {phase === 'prompt' && (
                                        <button
                                                type="button"
                                                onClick={() => void onEnable()}
                                                className="px-4 min-h-11 rounded-xl bg-primary dark:bg-dark-primary text-white text-[12px] font-DanaDemiBold hover:opacity-90 active:scale-95 transition cursor-pointer whitespace-nowrap"
                                        >
                                                {t['notify.enable.action']}
                                        </button>
                                )}
                                {busy && (
                                        <button
                                                type="button"
                                                disabled
                                                className="px-4 min-h-11 rounded-xl bg-primary/60 dark:bg-dark-primary/60 text-white text-[12px] font-DanaDemiBold cursor-wait whitespace-nowrap"
                                        >
                                                {t['notify.enable.busy']}
                                        </button>
                                )}
                                {phase === 'failed' && (
                                        <button
                                                type="button"
                                                onClick={() => void onEnable()}
                                                className="px-4 min-h-11 rounded-xl bg-primary dark:bg-dark-primary text-white text-[12px] font-DanaDemiBold hover:opacity-90 active:scale-95 transition cursor-pointer whitespace-nowrap"
                                        >
                                                {t['notify.enable.recheck']}
                                        </button>
                                )}
                                {/* دکمه‌ی بستن — در حالت‌های busy (در جریان) پنهان است */}
                                {phase !== 'busy' && (
                                        <button
                                                type="button"
                                                aria-label={t['notify.banner.dismiss']}
                                                title={t['notify.banner.dismiss']}
                                                onClick={() => {
                                                        markDismissed()
                                                        setPhase('hidden')
                                                }}
                                                className="w-11 h-11 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#1a0a0e] transition cursor-pointer shrink-0"
                                        >
                                                <X size={14} />
                                        </button>
                                )}
                        </div>
                </div>
        )
}
