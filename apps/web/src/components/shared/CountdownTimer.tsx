// ═══════════════════════════════════════════════════════════════
// stage-47 — sinshin-food-delivery — فایل جدید
// مسیر مقصد: apps/web/src/components/shared/CountdownTimer.tsx
// ═══════════════════════════════════════════════════════════════

// src/components/shared/CountdownTimer.tsx
import { memo, useEffect, useRef, useState } from 'react'
import { Timer } from 'reicon-react'
import { useI18nSafe } from '#/i18n'

/** ارقام بومی برای رشته (fmt.num فقط عدد می‌گیرد — اینجا بُرش صفر مهم است) */
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹'
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩'
function localizeDigits(s: string, lang: 'fa' | 'ar'): string {
        const map = lang === 'ar' ? AR_DIGITS : FA_DIGITS
        return s.replace(/[0-9]/g, (d) => map[Number(d)] ?? d)
}

interface CountdownTimerProps {
        /** پایان تخفیف (ISO) — null/نامعتبر/گذشته = رندر نمی‌شود */
        endsAt: string | null | undefined
        /** یک‌بار وقتی شمارنده به صفر رسید صدا زده می‌شود (بازسازی بج/قیمت) */
        onEnd?: () => void
        /** جای مصرف: کارت محصول (فشرده) یا باکس قیمت صفحه‌ی محصول */
        variant?: 'card' | 'box'
}

interface Parts {
        days: number
        hours: number
        minutes: number
        seconds: number
}

function diffParts(ms: number): Parts {
        const total = Math.max(0, Math.floor(ms / 1000))
        return {
                days: Math.floor(total / 86400),
                hours: Math.floor((total % 86400) / 3600),
                minutes: Math.floor((total % 3600) / 60),
                seconds: total % 60,
        }
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/**
 * stage-47 — شمارنده‌ی معکوس پایان تخفیف زمان‌دار.
 *  • تیک ۱ثانیه‌ای داخلی — فقط همین کامپوننت رندر می‌شود (کارت‌ها memo اند)
 *  • ارقام بومی (فارسی/عربی) از fmt.num
 *  • روزها فقط وقتی > 0 سلول جدا می‌گیرند
 *  • رسیدن به صفر → onEnd (یک‌بار) تا والد تخفیف را غیرفعال و قیمت را برگرداند
 *  • useI18nSafe: در سایت دوزبانه، در پیش‌نمایش فرم ادمین فارسی خالص
 */
export const CountdownTimer = memo(function CountdownTimer({
        endsAt,
        onEnd,
        variant = 'card',
}: CountdownTimerProps) {
        const { fmt, t, lang } = useI18nSafe()

        // stage-47 — گیت مونت: رندر سمت سرور ساعتِ خودِ سرور را می‌نوشت و هیدریشن
        // با ساعت کلاینت ±۱ ثانیه اختلاف متن می‌ساخت (hydration mismatch). فقط
        // بعد از مونت شمرده می‌شود — در SSR چیزی رندر نمی‌شود.
        const [mounted, setMounted] = useState(false)
        useEffect(() => setMounted(true), [])

        const target = (() => {
                if (!endsAt) return null
                const time = new Date(endsAt).getTime()
                return Number.isFinite(time) ? time : null
        })()

        const [now, setNow] = useState(() => Date.now())
        const endedRef = useRef(false)

        const remaining = target !== null ? target - now : -1
        const isOver = remaining <= 0

        useEffect(() => {
                if (target === null) return
                endedRef.current = false
                setNow(Date.now())
                const id = setInterval(() => setNow(Date.now()), 1000)
                return () => clearInterval(id)
        }, [target])

        // انقضا → یک‌بار onEnd (والد قیمت/بج را تازه می‌کند)
        useEffect(() => {
                if (isOver && !endedRef.current && target !== null) {
                        endedRef.current = true
                        onEnd?.()
                }
        }, [isOver, target, onEnd])

        if (target === null || isOver) return null

        const p = diffParts(remaining)
        const showDays = p.days > 0
        const d2 = (n: number) => localizeDigits(pad2(n), lang)

        const cell =
                variant === 'box'
                        ? 'flex flex-col items-center min-w-11 px-1.5 py-1 rounded-lg bg-white/10'
                        : 'flex flex-col items-center min-w-9 px-1 py-0.5 rounded-md bg-white/15'

        const num =
                variant === 'box'
                        ? 'font-DanaDemiBold text-base leading-none text-white'
                        : 'font-DanaDemiBold text-[13px] leading-none text-white'

        const unit =
                variant === 'box'
                        ? 'text-[9px] text-white/70 mt-0.5 font-DanaMedium'
                        : 'text-[8px] text-white/70 mt-0.5 font-DanaMedium'

        // stage-47 — قبل از مونت: پلی‌سهولدر هم‌شکل (بدون متن تیک‌دار) →
        // هیچ اختلاف هیدریشن ساعت سرور/کلاینت پیش نمی‌آید
        if (!mounted) {
                return (
                        <div
                                dir="rtl"
                                role="timer"
                                aria-label={t['common.offerEndsIn']}
                                className={`inline-flex items-center gap-1.5 rounded-xl px-2 py-1 bg-linear-to-l from-[#f6339a] to-[#2fd4d1] shadow-md select-none ${variant === 'box' ? 'gap-2 px-3 py-2' : ''}`}
                        >
                                <Timer size={variant === 'box' ? 16 : 13} className="text-white shrink-0" />
                                <span
                                        className={`text-white/90 font-DanaDemiBold shrink-0 ${variant === 'box' ? 'text-[11px]' : 'text-[10px]'}`}
                                >
                                        {t['common.offerEndsIn']}
                                </span>
                                <span className="flex items-center gap-1" dir="ltr">
                                        <span className={cell}>
                                                <span className={num}>&nbsp;</span>
                                                <span className={unit}>{t['common.timeSec']}</span>
                                        </span>
                                </span>
                        </div>
                )
        }

        return (
                <div
                        dir="rtl"
                        role="timer"
                        aria-label={t['common.offerEndsIn']}
                        className={`inline-flex items-center gap-1.5 rounded-xl px-2 py-1 bg-linear-to-l from-[#f6339a] to-[#2fd4d1] shadow-md select-none ${variant === 'box' ? 'gap-2 px-3 py-2' : ''}`}
                >
                        <Timer size={variant === 'box' ? 16 : 13} className="text-white shrink-0" />
                        <span
                                className={`text-white/90 font-DanaDemiBold shrink-0 ${variant === 'box' ? 'text-[11px]' : 'text-[10px]'}`}
                        >
                                {t['common.offerEndsIn']}
                        </span>
                        <span className="flex items-center gap-1" dir="ltr">
                                {showDays && (
                                        <span className={cell}>
                                                <span className={num}>{fmt.num(p.days)}</span>
                                                <span className={unit}>{t['common.timeDay']}</span>
                                        </span>
                                )}
                                <span className={cell}>
                                        <span className={num}>{d2(p.hours)}</span>
                                        <span className={unit}>{t['common.timeHour']}</span>
                                </span>
                                <span className={cell}>
                                        <span className={num}>{d2(p.minutes)}</span>
                                        <span className={unit}>{t['common.timeMin']}</span>
                                </span>
                                <span className={cell}>
                                        <span className={num}>{d2(p.seconds)}</span>
                                        <span className={unit}>{t['common.timeSec']}</span>
                                </span>
                        </span>
                </div>
        )
})