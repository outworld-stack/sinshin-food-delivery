// src/hooks/shared/useAppliedFilters.ts
import { useState, useCallback } from 'react'

// الگوی «موقت → اعمال» — مشترک همه‌ی فیلترها (به‌جای جفت‌های temp/applied پراکنده)
// نکته: مقادیر اولیه (defaults) را بیرون کامپوننت تعریف کن تا هویت پایدار بماند
export function useAppliedFilters<T extends Record<string, unknown>>(
  defaults: T,
  onApply?: () => void,
) {
  const [temp, setTemp] = useState<T>(defaults)
  const [applied, setApplied] = useState<T>(defaults)

  const setField = useCallback(<K extends keyof T>(field: K, value: T[K]) => {
    setTemp(prev => ({ ...prev, [field]: value }))
  }, [])

  const apply = useCallback(() => {
    setApplied(temp)
    onApply?.()
  }, [temp, onApply])

  const reset = useCallback(() => {
    setTemp(defaults)
    setApplied(defaults)
    onApply?.()
  }, [onApply])

  return { temp, applied, setField, apply, reset }
}