// ═══════════════════════════════════════════════════════════════
// stage-47 — sinshin-food-delivery — فایل ۹
// مسیر مقصد: apps/web/src/components/site/product-detail/ProductSizeSelector.tsx
// وضعیت: جایگزینی کامل فایل موجود
// تغییر: نمایش تخفیف مستقِ هر سایز — درصد روی دکمه + قیمت خط‌خورده
// ═══════════════════════════════════════════════════════════════

// src/components/site/product-detail/ProductSizeSelector.tsx
import { memo } from 'react'
import type { ProductSize } from '#/server/products'
import { useI18n } from '#/i18n'

interface ProductSizeSelectorProps {
  sizes: ProductSize[]
  selectedSizeId: string | null
  onSelect: (sizeId: string) => void
}

/** stage-47 — تخفیف سایز فعال است؟ (فلگ سرور؛ وگرنه محاسبه‌ی محلی پنجره) */
function sizeActive(size: ProductSize): boolean {
  const pct = size.discountPercentage ?? 0
  if (pct <= 0) return false
  if (size.discountActive !== undefined) return size.discountActive
  const now = Date.now()
  if (size.discountStartsAt) {
    const t = new Date(size.discountStartsAt).getTime()
    if (Number.isFinite(t) && now < t) return false
  }
  if (size.discountEndsAt) {
    const t = new Date(size.discountEndsAt).getTime()
    if (Number.isFinite(t) && now > t) return false
  }
  return true
}

export const ProductSizeSelector = memo(function ProductSizeSelector({
  sizes, selectedSizeId, onSelect,
}: ProductSizeSelectorProps) {
  const { t, fmt } = useI18n()
  if (sizes.length === 0) return null

  return (
    <div className="mb-6">
      <p className="text-xs text-gray-400 dark:text-gray-500 font-DanaMedium mb-2">{t['pdetail.sizeSelect']}</p>
      <div className="flex flex-wrap gap-2">
        {sizes.map(size => {
          const isSelected = size.id === selectedSizeId
          // stage-47 — تخفیف فعال این سایز: قیمت مؤثر + قیمت خام
          const active = sizeActive(size)
          const pct = size.discountPercentage ?? 0
          const effPrice = active
            ? (size.finalPrice ?? Math.round(size.price * (1 - pct / 100)))
            : size.price
          return (
            <button
              key={size.id}
              type="button"
              onClick={() => onSelect(size.id)}
              className={`px-4 py-2.5 rounded-xl text-sm font-DanaDemiBold transition cursor-pointer flex items-center gap-2 ${
                isSelected
                  ? 'bg-primary dark:bg-dark-primary text-white shadow-sm'
                  : 'bg-gray-100 dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#3a151c]'
              }`}
            >
              {size.name}
              <span className={`flex items-baseline gap-1.5 text-[11px] font-DanaMedium ${isSelected ? 'text-white/80' : 'text-gray-400'}`}>
                {active && (
                  <span className={`line-through ${isSelected ? 'text-white/50' : 'text-gray-300 dark:text-gray-500'}`}>
                    {fmt.price(size.price)}
                  </span>
                )}
                <span>{fmt.price(effPrice)} {t['common.tomanShort']}</span>
                {active && pct > 0 && (
                  <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-DanaDemiBold ${
                    isSelected ? 'bg-white/20 text-white' : 'bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary'
                  }`}>
                    ٪{fmt.num(pct)}
                  </span>
                )}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
})