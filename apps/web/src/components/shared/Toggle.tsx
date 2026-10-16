// src/components/shared/Toggle.tsx
import { memo } from 'react'

interface ToggleProps {
  isOn: boolean
  onToggle: () => void
  disabled?: boolean
  /**
   * stage-75 (P3-33) — نامِ accessible برای سوئیچ. role="switch" بدون نام،
   * در صفحه‌خوان فقط «switch، روشن/خاموش» اعلام می‌شود — بدون اینکه «چه چیزی»
   * روشن/خاموش می‌شود. متنِ برچسبِ کنارِ هر استفاده، همان رشته‌ی مرئی است.
   */
  label: string
}

// سوئیچ مشترک — قبلاً ۵ بار کپی‌پیست شده بود، حالا یک‌جاست
export const Toggle = memo(function Toggle({
  isOn,
  onToggle,
  disabled = false,
  label,
}: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isOn}
      aria-label={label}
      onClick={onToggle}
      disabled={disabled}
      className={`relative w-12 h-6 rounded-full transition shrink-0 ${
        isOn ? 'bg-primary dark:bg-dark-primary' : 'bg-gray-300 dark:bg-gray-600'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-all ${
        isOn ? 'left-0.5' : 'right-0.5'
      }`}></span>
    </button>
  )
})