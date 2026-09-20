// src/components/shared/Toggle.tsx
import { memo } from 'react'

interface ToggleProps {
  isOn: boolean
  onToggle: () => void
  disabled?: boolean
}

// سوئیچ مشترک — قبلاً ۵ بار کپی‌پیست شده بود، حالا یک‌جاست
export const Toggle = memo(function Toggle({ isOn, onToggle, disabled = false }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isOn}
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