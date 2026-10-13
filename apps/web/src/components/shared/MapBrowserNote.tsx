// src/components/shared/MapBrowserNote.tsx
// stage-59 — هشدار نارنجی حداقل نسخه‌ی مرورگر برای تایل‌های نقشه.
// تایل‌های نشان (این کیت توسعه) از DecompressionStream استاندارد استفاده
// می‌کنند: Chrome 80+، Firefox 113+، Safari 16.4+ — همان حداقلِ maplibre-gl.
// برای مرورگرهای قدیمی‌تر جایگزینی (fallback) وجود ندارد و درخواست‌های
// تایل خطا می‌خورند؛ بنابراین زیر نقشه‌های تعاملی این یادداشت نمایش
// می‌یابد تا کاربر در صورت خطا مرورگرش را به‌روزرسانی کند.

import { memo } from 'react'
import { Alert } from 'reicon-react'
import { useI18nSafe } from '#/i18n'

export const MapBrowserNote = memo(function MapBrowserNote() {
  const { t } = useI18nSafe()
  return (
    <div
      role="note"
      className="flex items-center gap-2 mt-2 px-3 py-1.5 rounded-lg bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20"
    >
      <Alert size={14} className="text-orange-500 shrink-0" />
      <p className="text-[10px] sm:text-[11px] text-orange-600 dark:text-orange-400 font-DanaMedium leading-relaxed">
        {t['map.browserWarning']}
      </p>
    </div>
  )
})