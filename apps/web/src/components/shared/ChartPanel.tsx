// src/components/shared/ChartPanel.tsx
import { memo, useReducer, useCallback } from 'react'
import { AdminChart } from '#/components/AdminChart'
import type { ChartData, ChartGranularity, ChartType } from '#/types/shared/chart'

interface ChartPanelProps {
  title: string
  chartData: ChartData
  defaultGranularity?: ChartGranularity
  defaultChartType?: ChartType
}

interface PanelState {
  granularity: ChartGranularity
  chartType: ChartType
}

type PanelAction =
  | { type: 'SET_GRANULARITY'; payload: ChartGranularity }
  | { type: 'SET_CHART_TYPE'; payload: ChartType }

function panelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case 'SET_GRANULARITY': return { ...state, granularity: action.payload }
    case 'SET_CHART_TYPE': return { ...state, chartType: action.payload }
    default: return state
  }
}

const selectCls = 'px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm outline-none cursor-pointer'

// پنل نمودار واحد — عنوان + انتخابگر بازه/نوع + نمودار (به‌جای ۴ کپی)
export const ChartPanel = memo(function ChartPanel({
  title, chartData, defaultGranularity = 'weekly', defaultChartType = 'bar',
}: ChartPanelProps) {
  const [state, dispatch] = useReducer(panelReducer, {
    granularity: defaultGranularity,
    chartType: defaultChartType,
  })

  const handleGranularity = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    dispatch({ type: 'SET_GRANULARITY', payload: e.target.value as ChartGranularity })
  }, [])

  const handleChartType = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    dispatch({ type: 'SET_CHART_TYPE', payload: e.target.value as ChartType })
  }, [])

  return (
    <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
        <h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white">{title}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select value={state.granularity} onChange={handleGranularity} className={selectCls}>
            <option value="daily">روزانه</option>
            <option value="weekly">هفتگی</option>
            <option value="monthly">ماهانه</option>
            <option value="yearly">سالانه</option>
          </select>
          <select value={state.chartType} onChange={handleChartType} className={selectCls}>
            <option value="bar">میله‌ای</option>
            <option value="pie">دایره‌ای</option>
            <option value="line">خطی</option>
          </select>
        </div>
      </div>
      <AdminChart chartType={state.chartType} data={chartData[state.granularity]} />
    </div>
  )
})