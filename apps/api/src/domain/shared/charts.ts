// src/domain/shared/charts.ts
/**
 * phase-3 — سازنده‌ی ChartData از داده‌ی «واقعی» (مرگ وزن‌های ساختگی).
 *   daily   = آخرین ۳۰ روز، پیوسته (روزِ بدون داده = صفرِ واقعی)
 *   weekly  = تجمیع شنبه‌محور (هفته‌ی ایرانی) — فقط هفته‌های دارای داده
 *   monthly = تجمیع ماه شمسی («۱۴۰۳ آبان»)
 *   yearly  = تجمیع سال شمسی («۱۴۰۳»)
 * تقویم شمسی از Intl('fa-IR') — پیش‌فرض persian؛ ایران DST ندارد پس محاسبه‌ی روز ثابت است.
 */

export interface ChartPoint {
  label: string
  value: number
}

export interface RangeCharts {
  daily: ChartPoint[]
  weekly: ChartPoint[]
  monthly: ChartPoint[]
  yearly: ChartPoint[]
}

const DAY_MS = 86_400_000

const F_DAY = new Intl.DateTimeFormat('fa-IR', { day: 'numeric' })
const F_DAY_MONTH = new Intl.DateTimeFormat('fa-IR', { day: 'numeric', month: 'long' })
const F_MONTH = new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: 'long' })
const F_YEAR = new Intl.DateTimeFormat('fa-IR', { year: 'numeric' })

const localDateKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** شنبه‌محور — هفته‌ی ایرانی (getDay: یکشنبه=۰ … شنبه=۶) */
const weekStart = (d: Date): Date => {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const daysSinceSaturday = (copy.getDay() + 1) % 7
  return new Date(copy.getTime() - daysSinceSaturday * DAY_MS)
}

export function buildRangeCharts(
  items: ReadonlyArray<{ date: Date; value: number }>,
  opts: { dailyDays?: number } = {},
): RangeCharts {
  const dailyDays = Math.max(1, opts.dailyDays ?? 30)
  const sorted = [...items].sort((a, b) => a.date.getTime() - b.date.getTime())

  // ── daily — پیوسته‌ی N روز آخر (صفرِ روزِ خالی = واقعی) ──
  const byDay = new Map<string, number>()
  for (const it of sorted) {
    const k = localDateKey(it.date)
    byDay.set(k, (byDay.get(k) ?? 0) + it.value)
  }
  const daily: ChartPoint[] = []
  const anchor = new Date()
  anchor.setHours(12, 0, 0, 0)
  for (let i = dailyDays - 1; i >= 0; i--) {
    const d = new Date(anchor.getTime() - i * DAY_MS)
    daily.push({ label: F_DAY.format(d), value: byDay.get(localDateKey(d)) ?? 0 })
  }

  // ── weekly — شنبه‌محور؛ فقط هفته‌های دارای داده ──
  const weeklyMap = new Map<string, { label: string; value: number; ts: number }>()
  for (const it of sorted) {
    const ws = weekStart(it.date)
    const k = localDateKey(ws)
    const cell = weeklyMap.get(k) ?? { label: F_DAY_MONTH.format(ws), value: 0, ts: ws.getTime() }
    cell.value += it.value
    weeklyMap.set(k, cell)
  }
  const weekly = [...weeklyMap.values()]
    .sort((a, b) => a.ts - b.ts)
    .map(({ label, value }) => ({ label, value }))

  // ── monthly — ماه شمسی؛ label یکتا per ماه («۱۴۰۳ آبان») ──
  const monthlyMap = new Map<string, { label: string; value: number; ts: number }>()
  for (const it of sorted) {
    const label = F_MONTH.format(it.date)
    const cell = monthlyMap.get(label) ?? {
      label,
      value: 0,
      ts: new Date(it.date.getFullYear(), it.date.getMonth(), 1).getTime(),
    }
    cell.value += it.value
    monthlyMap.set(label, cell)
  }
  const monthly = [...monthlyMap.values()]
    .sort((a, b) => a.ts - b.ts)
    .map(({ label, value }) => ({ label, value }))

  // ── yearly — سال شمسی ──
  const yearlyMap = new Map<string, { label: string; value: number; ts: number }>()
  for (const it of sorted) {
    const label = F_YEAR.format(it.date)
    const cell = yearlyMap.get(label) ?? {
      label,
      value: 0,
      ts: new Date(it.date.getFullYear(), 0, 1).getTime(),
    }
    cell.value += it.value
    yearlyMap.set(label, cell)
  }
  const yearly = [...yearlyMap.values()]
    .sort((a, b) => a.ts - b.ts)
    .map(({ label, value }) => ({ label, value }))

  return { daily, weekly, monthly, yearly }
}