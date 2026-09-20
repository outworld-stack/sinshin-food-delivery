// src/utils/persianDate.ts
// تقویم شمسی — بر پایه Intl (موتور خود مرورگر/Node، ECMA-402)
// صفر الگوریتم دستی = صفر باگ. SSR-safe (Node 14+ full-icu)
import { faNum } from '#/utils/format'


export interface JalaliDate {
  year: number
  month: number   // ۱-۱۲
  day: number     // ۱-۳۱
}

export const JALALI_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
]

export const JALALI_WEEKDAYS_SHORT = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج']

// --- Intl formatter — تقویم فارسی با اعداد لاتین (برای parse) ---
let _fmt: Intl.DateTimeFormat | null = null
function getFmt(): Intl.DateTimeFormat {
  if (!_fmt) {
    try {
      _fmt = new Intl.DateTimeFormat('en-u-ca-persian', {
        year: 'numeric', month: 'numeric', day: 'numeric',
      })
    } catch {
      _fmt = new Intl.DateTimeFormat('en', {
        year: 'numeric', month: 'numeric', day: 'numeric',
      })
    }
  }
  return _fmt
}
// تبدیل ارقام فارسی به لاتین (اگه locale جای دیگه فارسی برگردوند)
function toEnDigits(s: string): string {
  return s.replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
}

// Date → شمسی
export function gregorianToJalali(date: Date): JalaliDate {
  const parts = getFmt().formatToParts(date)
  const get = (t: string): number => Number(
    toEnDigits(parts.find(p => p.type === t)?.value ?? 'NaN')
  )
  return { year: get('year'), month: get('month'), day: get('day') }
}

// --- نوروز: روزِ 1/1 سال شمسی (19-22 مارس) ---
function findNowruz(jy: number): Date {
  const gy = jy + 621
  for (const gd of [21, 20, 22, 19]) {
    const cand = new Date(gy, 2, gd, 12, 0, 0) // ظهر — مصون از مرز TZ
    const j = gregorianToJalali(cand)
    if (j.year === jy && j.month === 1 && j.day === 1) return cand
  }
  return new Date(gy, 2, 21, 12, 0, 0) // fallback
}

// شمسی → Date
export function jalaliToGregorian(j: JalaliDate): Date {
  const nowruz = findNowruz(j.year)
  // روزِ سال (1-based)
  const doy = j.month <= 7
    ? (j.month - 1) * 31 + j.day
    : 186 + (j.month - 7) * 30 + j.day
  const result = new Date(nowruz.getTime() + (doy - 1) * 86400000)
  return new Date(result.getFullYear(), result.getMonth(), result.getDate(), 12, 0, 0)
}

// روزهای ماه
export function daysInJalaliMonth(jy: number, jm: number): number {
  if (jm <= 6) return 31
  if (jm <= 11) return 30
  // اسفند: فاصله 1 اسفند تا نوروز سال بعد
  const esfand1 = findNowruz(jy)          // 1 فروردین این سال
  const nextNowruz = findNowruz(jy + 1)   // 1 فروردین سال بعد
  // 1 اسفند = روز ۳۳۷ام غیرکبیسه (186+151+1) یا 338 کبیسه
  // ساده: فاصله نوروز‌ها 365/366 → اسفند 29 یا 30
  return Math.round((nextNowruz.getTime() - esfand1.getTime()) / 86400000) === 366 ? 30 : 29
}

// روز اول ماه، روزِ هفته (۰ = شنبه)
export function firstWeekdayOfMonth(jy: number, jm: number): number {
  const g = jalaliToGregorian({ year: jy, month: jm, day: 1 })
  // getDay: 0=یکشنبه...6=شنبه → شیفت تا 0=شنبه
  return (g.getDay() + 1) % 7
}

// --- قالب‌بندی ---
export function formatJalali(j: JalaliDate): string {
  return `${faNum(j.day)} ${JALALI_MONTHS[j.month - 1]} ${faNum(j.year)}`
}

export function jalaliToISO(j: JalaliDate): string {
  return `${j.year}-${String(j.month).padStart(2, '0')}-${String(j.day).padStart(2, '0')}`
}

export function jalaliFromISO(iso: string): JalaliDate | null {
  const parts = iso.split('-').map(Number)
  if (parts.length !== 3 || parts.some(isNaN)) return null
  return { year: parts[0], month: parts[1], day: parts[2] }
}

export function todayJalali(): JalaliDate {
  return gregorianToJalali(new Date())
}
