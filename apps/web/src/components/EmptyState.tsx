// ═══════════════════════════════════════════════════════════════
// stage-55 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/components/EmptyState.tsx
// وضعیت: ویرایش فایل موجود (یک تغییر نقطه‌ای)
// تغییر: شناوری نرم آیکون حالت خالی (float-soft — CSS-only)
// ═══════════════════════════════════════════════════════════════

// src/components/EmptyState.tsx
import type { EmptyStateProps } from '#/types/shared/ui'
import { Box } from 'reicon-react' // آیکون جعبه خالی
import { useI18n } from '#/i18n'

// رارد ۳۲ — پیش‌فرض‌های دوزبانه؛ فراخواننده‌ها همچنان می‌توانند title/description
// دلخواه بدهند (مقدار داده‌شده اولویت دارد).
export function EmptyState({
  title,
  description
}: EmptyStateProps) {
  const { t } = useI18n()
  const resolvedTitle = title ?? t['empty.title']
  const resolvedDesc = description ?? t['empty.desc']

  return (
    <div className="col-span-full flex flex-col items-center justify-center py-16 px-4 text-center bg-gray-50 dark:bg-[#2a1015] rounded-2xl border border-dashed border-gray-300 dark:border-[#3a151c]">
      {/* stage-55 — شناوری نرم حالت خالی: فقط آیکون شناور است، متن ثابت */}
      <Box size={64} className="text-gray-300 dark:text-gray-600 mb-4 animate-float-soft" />
      <h3 className="font-DanaDemiBold text-xl text-gray-700 dark:text-gray-300 mb-2">{resolvedTitle}</h3>
      <p className="font-DanaRegular text-sm text-gray-500 dark:text-gray-400 max-w-sm">{resolvedDesc}</p>
    </div>
  );
}