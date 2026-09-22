// src/domain/shared/charts.ts
/**
 * stage-15 — سازندهٔ ChartData با معنای «بازهٔ جاری» (خواستهٔ صریح مغازه):
 *   daily   = امروز در ۶ ستونِ ۴ساعته (۰۰-۰۴ / ۰۴-۰۸ / … / ۲۰-۲۴)
 *   weekly  = هفتهٔ جاری ایرانی — شنبه تا جمعه (۷ ستون، نام روزها)
 *   monthly = روزهای ماه شمسیِ جاری (۲۹/۳۰/۳۱ ستون — بر اساس تقویم)
 *   yearly  = ۱۲ ماه سال شمسیِ جاری (فروردین … اسفند)
 *
 * همهٔ سری‌ها «از راست به چپ» ارائه می‌شوند: آرایه‌ها زمان‌محورِ
 * صعودی مرتب می‌شوند و رندر RTL (dir="rtl" اپ) ستون اول را سمت راست
 * می‌گذارد — یعنی قدیمی‌ترین بازه راست، جدیدترین چپ.
 *
 * ورودی همهٔ فراخوان‌ها یکی است: اقلام خام {date, value} (مثل سفارش‌ها یا
 * تحویل‌های پیک) — تاریخچهٔ خارج از بازهٔ جاری بی‌صدا نادیده گرفته می‌شود.
 *
 * تقویم شمسی از @sinshin/shared (هستهٔ Intl مشترک با وب)؛ ایران DST ندارد
 * پس مرز روزها در TZ سرور (استقرار: Asia/Tehran) پایدار است.
 */

import type { ChartPoint, RangeCharts } from '@sinshin/shared'
import {
        daysInJalaliMonth,
        gregorianToJalali,
        JALALI_MONTHS,
        jalaliToGregorian,
} from '@sinshin/shared'

// فراخوان‌ها تایپ قرارداد را از همین ماژول می‌گیرند (نقطهٔ واحد)
export type { ChartPoint, RangeCharts } from '@sinshin/shared'

export interface ChartItem {
        date: Date
        value: number
}

const DAY_MS = 86_400_000

/** شنبه‌محور — هفتهٔ ایرانی (getDay: یکشنبه=۰ … شنبه=۶)؛ همیشه نیمه‌شب */
const weekStart = (d: Date): Date => {
        const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate())
        const daysSinceSaturday = (midnight.getDay() + 1) % 7
        return new Date(midnight.getTime() - daysSinceSaturday * DAY_MS)
}

const localDateKey = (d: Date): string =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const addDays = (d: Date, n: number): Date =>
        new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

// برچسب بازه‌های ۴ساعته — رقم فارسی، هم‌قالب خواستهٔ مغازه
const FOUR_HOUR_LABELS = [
        '۰۰:۰۰ تا ۰۴:۰۰',
        '۰۴:۰۰ تا ۰۸:۰۰',
        '۰۸:۰۰ تا ۱۲:۰۰',
        '۱۲:۰۰ تا ۱۶:۰۰',
        '۱۶:۰۰ تا ۲۰:۰۰',
        '۲۰:۰۰ تا ۲۴:۰۰',
] as const

const F_DAY = new Intl.DateTimeFormat('fa-IR', { day: 'numeric' })
const F_WEEKDAY = new Intl.DateTimeFormat('fa-IR', { weekday: 'long' })

/**
 * ابتدای بازهٔ پوشش — قدیمی‌ترین تاریخی که buildRangeCharts می‌خواند:
 * ابتدای سال شمسیِ جاری، مگر هفته‌ای که سال را قطع می‌کند (روزهای اول
 * فروردین) که ابتدای هفتهٔ شنبه‌محور قدیمی‌تر است. کوئری‌های فراخوان
 * با این کران، دادهٔ کافی برای هر چهار نما می‌گیرند.
 */
export function currentPeriodStart(): Date {
        const now = new Date()
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12)
        const tj = gregorianToJalali(today)
        const yearStart = jalaliToGregorian({ year: tj.year, month: 1, day: 1 })
        yearStart.setHours(0, 0, 0, 0) // مرز نیمه‌شب — سفارش‌های صبح روز اول داخل بمانند
        const ws = weekStart(today)
        return yearStart.getTime() < ws.getTime() ? yearStart : ws
}

export function buildRangeCharts(items: ReadonlyArray<ChartItem>): RangeCharts {
        // ظهرِ امروز — لنگر مرزها؛ مصون از جابه‌جایی ساعت در محاسبات روزانه
        const now = new Date()
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12)
        const todayKey = localDateKey(today)

        // یک پاس: جمع روزانه + باکت‌های ۴ساعتهٔ امروز
        const byDay = new Map<string, number>()
        const buckets = [0, 0, 0, 0, 0, 0]
        for (const it of items) {
                const k = localDateKey(it.date)
                byDay.set(k, (byDay.get(k) ?? 0) + it.value)
                if (k === todayKey) {
                        const b = Math.floor(it.date.getHours() / 4)
                        buckets[b] = (buckets[b] ?? 0) + it.value
                }
        }

        // ── daily — امروز در ۶ ستونِ ۴ساعته ──
        const daily: ChartPoint[] = FOUR_HOUR_LABELS.map((label, i) => ({
                label,
                value: buckets[i] ?? 0,
        }))

        // ── weekly — هفتهٔ جاری شنبه تا جمعه (۷ ستون) ──
        const ws = weekStart(today)
        const weekly: ChartPoint[] = Array.from({ length: 7 }, (_, i) => {
                const d = addDays(ws, i)
                return { label: F_WEEKDAY.format(d), value: byDay.get(localDateKey(d)) ?? 0 }
        })

        // ── monthly — روزهای ماه شمسیِ جاری (۲۹/۳۰/۳۱) ──
        const tj = gregorianToJalali(today)
        const monthLen = daysInJalaliMonth(tj.year, tj.month)
        const monthStart = jalaliToGregorian({ year: tj.year, month: tj.month, day: 1 })
        const monthly: ChartPoint[] = Array.from({ length: monthLen }, (_, i) => {
                const d = addDays(monthStart, i)
                return { label: F_DAY.format(d), value: byDay.get(localDateKey(d)) ?? 0 }
        })

        // ── yearly — ۱۲ ماه سال شمسیِ جاری ──
        const yearly: ChartPoint[] = JALALI_MONTHS.map((label, idx) => {
                const month = idx + 1
                const start = jalaliToGregorian({ year: tj.year, month, day: 1 })
                let value = 0
                for (let day = 0; day < daysInJalaliMonth(tj.year, month); day++) {
                        value += byDay.get(localDateKey(addDays(start, day))) ?? 0
                }
                return { label, value }
        })

        return { daily, weekly, monthly, yearly }
}
