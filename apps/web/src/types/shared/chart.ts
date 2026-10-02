// src/types/shared/chart.ts

// رارد ۴۶ — ChartPoint/ChartData/ChartGranularity از قرارداد مشترک مشتق
// می‌شوند (@sinshin/shared: ChartPoint + RangeCharts) — قبلاً کپی موازی بودند.
// ChartType فقط UI است (bar/pie/line) و این‌جا می‌ماند.
import type { RangeCharts } from '@sinshin/shared'

export type { ChartPoint } from '@sinshin/shared'

/** همان RangeCharts قرارداد — نام قدیمی فرانت حفظ شد */
export type ChartData = RangeCharts

/** کلیدهای بازه — همیشه هم‌گام با قرارداد */
export type ChartGranularity = keyof RangeCharts

export type ChartType = 'bar' | 'pie' | 'line'