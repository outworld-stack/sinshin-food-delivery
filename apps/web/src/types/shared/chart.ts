// src/types/shared/chart.ts

export type ChartGranularity = 'daily' | 'weekly' | 'monthly' | 'yearly'
export type ChartType = 'bar' | 'pie' | 'line'

export interface ChartPoint {
  label: string
  value: number
}

export interface ChartData {
  daily: ChartPoint[]
  weekly: ChartPoint[]
  monthly: ChartPoint[]
  yearly: ChartPoint[]
}