// src/components/shared/PersianDatePicker.tsx
import { memo, useReducer, useCallback, useMemo } from 'react'
import {
  formatJalali, todayJalali, daysInJalaliMonth, firstWeekdayOfMonth,
  JALALI_MONTHS, JALALI_WEEKDAYS_SHORT, jalaliToISO, jalaliFromISO,
  type JalaliDate,
} from '#/utils/persianDate'
import { ChevronRight, ChevronLeft } from 'reicon-react'
import { faNum } from '#/utils/format'

interface PersianDatePickerProps {
  value: string | null          // ISO شمسی «1405-06-13»
  onChange: (iso: string | null) => void
  placeholder?: string
}

// --- reducer ---
interface PickerState {
  viewYear: number
  viewMonth: number
  isOpen: boolean
}

type PickerAction =
  | { type: 'SET_VIEW'; payload: { year: number; month: number } }
  | { type: 'PREV_MONTH' }
  | { type: 'NEXT_MONTH' }
  | { type: 'OPEN' }
  | { type: 'CLOSE' }

function initPickerState(selected: JalaliDate | null): PickerState {
  const base = selected ?? todayJalali()
  return { viewYear: base.year, viewMonth: base.month, isOpen: false }
}

function pickerReducer(state: PickerState, action: PickerAction): PickerState {
  switch (action.type) {
    case 'SET_VIEW': return { ...state, viewYear: action.payload.year, viewMonth: action.payload.month }
    case 'PREV_MONTH': {
      const m = state.viewMonth - 1
      if (m < 1) return { ...state, viewYear: state.viewYear - 1, viewMonth: 12 }
      return { ...state, viewMonth: m }
    }
    case 'NEXT_MONTH': {
      const m = state.viewMonth + 1
      if (m > 12) return { ...state, viewYear: state.viewYear + 1, viewMonth: 1 }
      return { ...state, viewMonth: m }
    }
    case 'OPEN': return { ...state, isOpen: true }
    case 'CLOSE': return { ...state, isOpen: false }
    default: return state
  }
}


// --- پیکر شمسی — ۱۰۰٪ خودمون ---
export const PersianDatePicker = memo(function PersianDatePicker({
  value, onChange, placeholder = 'انتخاب تاریخ...',
}: PersianDatePickerProps) {
  const selected = useMemo(() => (value ? jalaliFromISO(value) : null), [value])
  const [state, dispatch] = useReducer(pickerReducer, selected, initPickerState)

  const handleOpen = useCallback(() => dispatch({ type: 'OPEN' }), [])
  const handleClose = useCallback(() => dispatch({ type: 'CLOSE' }), [])
  const handlePrev = useCallback(() => dispatch({ type: 'PREV_MONTH' }), [])
  const handleNext = useCallback(() => dispatch({ type: 'NEXT_MONTH' }), [])

  // سلول‌های گرید — هفته از شنبه (ستون اول در RTL)
  const dayCells = useMemo(() => {
    const firstWeekday = firstWeekdayOfMonth(state.viewYear, state.viewMonth) // ۰=شنبه
    const days = daysInJalaliMonth(state.viewYear, state.viewMonth)
    const cells: (number | null)[] = Array(firstWeekday).fill(null)
    for (let i = 1; i <= days; i++) cells.push(i)
    return cells
  }, [state.viewYear, state.viewMonth])

  const today = useMemo(() => todayJalali(), [])

  const handleDayClick = useCallback((day: number) => {
    onChange(jalaliToISO({ year: state.viewYear, month: state.viewMonth, day }))
    dispatch({ type: 'CLOSE' })
  }, [state.viewYear, state.viewMonth, onChange])

  const handleToday = useCallback(() => {
    const t = todayJalali()
    onChange(jalaliToISO(t))
    dispatch({ type: 'SET_VIEW', payload: { year: t.year, month: t.month } })
    dispatch({ type: 'CLOSE' })
  }, [onChange])

  const handleClear = useCallback(() => {
    onChange(null)
    dispatch({ type: 'CLOSE' })
  }, [onChange])

  const handleMonthSelect = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    dispatch({ type: 'SET_VIEW', payload: { year: state.viewYear, month: Number(e.target.value) } })
  }, [state.viewYear])

  const handleYearSelect = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    dispatch({ type: 'SET_VIEW', payload: { year: Number(e.target.value), month: state.viewMonth } })
  }, [state.viewMonth])




  return (
    <div className="relative">
      {/* اینپوت */}
      <button
        type="button"
        onClick={handleOpen}
        className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm text-gray-700 dark:text-gray-300 text-right cursor-pointer flex items-center justify-between gap-2"
      >
        <span className="truncate">{selected ? formatJalali(selected) : placeholder}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      </button>

      {/* پاپ‌آور */}
      {state.isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={handleClose}></div>
          <div className="absolute z-50 mt-1 w-72 bg-white dark:bg-[#2a1015] rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-xl p-4">

            {/* هدر ماه/سال */}
            <div className="flex items-center justify-between mb-4">
              <button type="button" onClick={handlePrev} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-[#1a0a0e] cursor-pointer">
                <ChevronRight size={18} />
              </button>
              <div className="flex items-center gap-2">
                <select
                  value={state.viewMonth}
                  onChange={handleMonthSelect}
                  className="text-sm bg-transparent outline-none cursor-pointer text-gray-800 dark:text-white font-DanaDemiBold"
                >
                  {JALALI_MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
                <select
                  value={state.viewYear}
                  onChange={handleYearSelect}
                  className="text-sm bg-transparent outline-none cursor-pointer text-gray-800 dark:text-white font-DanaDemiBold"
                >
                  {Array.from({ length: 41 }, (_, i) => today.year - 20 + i).map((y) => (
                    <option key={y} value={y}>{faNum(y)}</option>
                  ))}
                </select>
              </div>
              <button type="button" onClick={handleNext} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-[#1a0a0e] cursor-pointer">
                <ChevronLeft size={18} />
              </button>
            </div>

            {/* روزهای هفته — شنبه اول (RTL خودش درست می‌چینه) */}
            <div className="grid grid-cols-7 gap-1 mb-2">
              {JALALI_WEEKDAYS_SHORT.map((d) => (
                <span key={d} className="text-[10px] text-gray-400 text-center font-DanaMedium py-1">{d}</span>
              ))}
            </div>

            {/* گرید روزها */}
            <div className="grid grid-cols-7 gap-1">
              {dayCells.map((day, i) => {
                if (day === null) return <span key={`e-${i}`} />
                const isSelected = selected
                  && selected.year === state.viewYear
                  && selected.month === state.viewMonth
                  && selected.day === day
                const isToday = today.year === state.viewYear
                  && today.month === state.viewMonth
                  && today.day === day
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => handleDayClick(day)}
                    className={`h-8 rounded-lg text-xs font-DanaMedium transition cursor-pointer ${isSelected
                      ? 'bg-primary dark:bg-dark-primary text-white shadow-sm'
                      : isToday
                        ? 'bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary font-DanaDemiBold'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#1a0a0e]'
                      }`}
                  >
                    {faNum(day)}
                  </button>
                )
              })}
            </div>

            {/* فوتر */}
            <div className="mt-3 pt-3 border-t border-gray-100 dark:border-white/5 flex justify-between items-center">
              <button type="button" onClick={handleClear} className="text-xs text-red-400 hover:text-red-500 cursor-pointer font-DanaMedium">
                حذف انتخاب
              </button>
              <button type="button" onClick={handleToday} className="text-xs text-primary dark:text-dark-primary cursor-pointer font-DanaMedium">
                امروز
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
})