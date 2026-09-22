// src/utils/persianDate.ts
// stage-15 — هستهٔ تقویم شمسی به @sinshin/shared منتقل شد (یک پیاده‌سازی
// مشترک برای API و وب — DRY). این ماژول لایهٔ سازگاری وب است: همهٔ
// ایمپورت‌های قبلی بدون تغییر کار می‌کنند؛ فقط قالب‌بندیِ مخصوص فرانت
// (faNum) این‌جا می‌ماند.
import { faNum } from '#/utils/format'
import { JALALI_MONTHS, type JalaliDate } from '@sinshin/shared'

export {
        JALALI_MONTHS,
        gregorianToJalali,
        jalaliToGregorian,
        daysInJalaliMonth,
        firstWeekdayOfMonth,
        jalaliToISO,
        jalaliFromISO,
        todayJalali,
} from '@sinshin/shared'
export type { JalaliDate } from '@sinshin/shared'

export const JALALI_WEEKDAYS_SHORT = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج']

// --- قالب‌بندی (فقط فرانت) ---
export function formatJalali(j: JalaliDate): string {
        return `${faNum(j.day)} ${JALALI_MONTHS[j.month - 1]} ${faNum(j.year)}`
}
