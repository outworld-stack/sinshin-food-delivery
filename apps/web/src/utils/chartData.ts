// src/utils/chartData.ts
// phase-3 — تجمیع «صادقانه» از سری روزانه‌ی سرور (حالا ۳۶۵ روز).
// قبلاً: daily = توزیع ساعتی با HOUR_WEIGHTS ساختگی، yearly = الگوی فصلی
// جعلی (YEAR_WEIGHTS). حالا همه‌ی بازه‌ها از همان سری واقعی:
//   daily = ۳۰ روز پیوسته | weekly = ۱۲ هفته‌ی شنبه‌محور
//   monthly = ۱۲ ماه شمسی | yearly = همه‌ی سال‌های شمسی
import type { ChartData, ChartPoint } from '#/types/shared/chart'

interface DailyRow {
  date: string // 'YYYY-MM-DD'
  sales: number
}

const F_DAY = new Intl.DateTimeFormat('fa-IR', { day: 'numeric' })
const F_DAY_MONTH = new Intl.DateTimeFormat('fa-IR', { day: 'numeric', month: 'long' })
const F_MONTH = new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: 'long' })
const F_YEAR = new Intl.DateTimeFormat('fa-IR', { year: 'numeric' })

const parseDate = (s: string): Date => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}

const localKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** شنبه‌محور — هفته‌ی ایرانی */
const weekStart = (d: Date): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 1) % 7))

export function buildChartData(
  series: DailyRow[],
  opts: { dailyDays?: number; weeklyWeeks?: number; monthlyMonths?: number } = {},
): ChartData {
  const dailyDays = opts.dailyDays ?? 30
  const weeklyWeeks = opts.weeklyWeeks ?? 12
  const monthlyMonths = opts.monthlyMonths ?? 12

  const byDay = new Map<string, number>()
  for (const row of series) {
    byDay.set(row.date, (byDay.get(row.date) ?? 0) + row.sales)
  }

  // ── daily: پیوسته‌ی N روز آخر — روزِ خالی = صفرِ واقعی ──
  const daily: ChartPoint[] = []
  const today = new Date()
  for (let i = dailyDays - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
    daily.push({ label: F_DAY.format(d), value: byDay.get(localKey(d)) ?? 0 })
  }

  // ── weekly: تجمیع شنبه‌محور — N هفته‌ی آخر ──
  const weekMap = new Map<string, { label: string; value: number; ts: number }>()
  for (const row of series) {
    const ws = weekStart(parseDate(row.date))
    const k = localKey(ws)
    const cell = weekMap.get(k) ?? { label: F_DAY_MONTH.format(ws), value: 0, ts: ws.getTime() }
    cell.value += row.sales
    weekMap.set(k, cell)
  }
  const weekly = [...weekMap.values()]
    .sort((a, b) => a.ts - b.ts)
    .slice(-weeklyWeeks)
    .map(({ label, value }) => ({ label, value }))

  // ── monthly: ماه شمسی — N ماه آخر ──
  const monthMap = new Map<string, { label: string; value: number; ts: number }>()
  for (const row of series) {
    const d = parseDate(row.date)
    const label = F_MONTH.format(d)
    const cell = monthMap.get(label) ?? {
      label,
      value: 0,
      ts: new Date(d.getFullYear(), d.getMonth(), 1).getTime(),
    }
    cell.value += row.sales
    monthMap.set(label, cell)
  }
  const monthly = [...monthMap.values()]
    .sort((a, b) => a.ts - b.ts)
    .slice(-monthlyMonths)
    .map(({ label, value }) => ({ label, value }))

  // ── yearly: سال شمسی — همه ──
  const yearMap = new Map<string, { label: string; value: number; ts: number }>()
  for (const row of series) {
    const d = parseDate(row.date)
    const label = F_YEAR.format(d)
    const cell = yearMap.get(label) ?? {
      label,
      value: 0,
      ts: new Date(d.getFullYear(), 0, 1).getTime(),
    }
    cell.value += row.sales
    yearMap.set(label, cell)
  }
  const yearly = [...yearMap.values()]
    .sort((a, b) => a.ts - b.ts)
    .map(({ label, value }) => ({ label, value }))

  return { daily, weekly, monthly, yearly }
}