// src/components/dashboard/info/DevicesSection.tsx
// stage-70 — هر دستگاه خط دوم «نوع · برند · مدل» می‌گیرد (موبایل/رایانه +
// اپل 16 Pro / سامسونگ A55 / ویندوز / ...) — از ستون‌های deviceType/Brand/Model.
import { memo } from 'react'
import { useI18n } from '#/i18n'
import { Mobile, Monitor } from 'reicon-react'
import type { Dict } from '#/i18n/fa'

// رارد ۴۷ — نمای نمایشی عمدی از DeviceDto قرارداد: دو تغییر نام
// (name→deviceName و lastActiveAt→lastActive) و زیرمجموعه‌ی فیلدی؛
// مبدل مرزی در routes/dashboard/info/index ساخته می‌شود (خوشه ۸).
interface DeviceItem {
  id: string
  deviceName: string
  lastActive: Date
  isCurrent: boolean
  /** stage-70 — هویت نمایشی دستگاه */
  deviceType?: 'mobile' | 'tablet' | 'desktop' | null
  deviceBrand?: string | null
  deviceModel?: string | null
}

interface DevicesSectionProps {
  devices: DeviceItem[]
}

// نقشه‌ی برند قاعده‌مند → کلید i18n (تایپ‌سیف — بدون کلید داینامیک)
const BRAND_KEYS: Record<string, keyof Dict> = {
  apple: 'dash.info.deviceBrand.apple',
  samsung: 'dash.info.deviceBrand.samsung',
  xiaomi: 'dash.info.deviceBrand.xiaomi',
  huawei: 'dash.info.deviceBrand.huawei',
  honor: 'dash.info.deviceBrand.honor',
  google: 'dash.info.deviceBrand.google',
  other: 'dash.info.deviceBrand.other',
  windows: 'dash.info.deviceBrand.windows',
  macos: 'dash.info.deviceBrand.macos',
  linux: 'dash.info.deviceBrand.linux',
}
const TYPE_KEYS: Record<'mobile' | 'tablet' | 'desktop', keyof Dict> = {
  mobile: 'dash.info.deviceType.mobile',
  tablet: 'dash.info.deviceType.tablet',
  desktop: 'dash.info.deviceType.desktop',
}

export const DevicesSection = memo(function DevicesSection({ devices }: DevicesSectionProps) {
  const { t, fmt } = useI18n()

  const deviceMeta = (d: DeviceItem): string | null => {
    const parts: string[] = []
    if (d.deviceType) parts.push(t[TYPE_KEYS[d.deviceType]])
    const brandKey = d.deviceBrand ? BRAND_KEYS[d.deviceBrand] : undefined
    if (brandKey) parts.push(t[brandKey])
    else if (d.deviceBrand) parts.push(d.deviceBrand)
    if (d.deviceModel) parts.push(d.deviceModel)
    return parts.length > 0 ? parts.join(' · ') : null
  }

  return (
    <div className="bg-white dark:bg-[#2a1015] p-6 md:p-8 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
      <h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-6">{t['dash.info.devicesTitle']}</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 font-DanaMedium leading-relaxed">
        {t['dash.info.devicesDesc']}
      </p>
      <div className="space-y-3">
        {devices.map((device) => {
          const meta = deviceMeta(device)
          return (
          <div key={device.id} className="flex items-center justify-between p-4 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-100 dark:border-white/5">
            <div className="flex items-center gap-3">
              {/* stage-59 — دستگاه فعال (فعلی): آیکنِ سمت راست سبز می‌شود (به‌جای بج/دکمه‌ی «دستگاه فعلی») */}
              <div
                className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
                  device.isCurrent
                    ? 'bg-green-100 dark:bg-green-500/10 text-green-500'
                    : 'bg-gray-200 dark:bg-[#2a1015] text-gray-500 dark:text-gray-400'
                }`}
              >
                {device.deviceType === 'desktop' ? (
                  <Monitor size={20} aria-hidden />
                ) : (
                  <Mobile size={20} aria-hidden />
                )}
              </div>
              <div>
                <p className="font-DanaMedium text-gray-800 dark:text-white text-sm">{device.deviceName}</p>
                {/* stage-70 — «موبایل · سامسونگ · A55» / «رایانه · ویندوز» */}
                {meta && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{meta}</p>
                )}
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{t['dash.info.lastActive']} {fmt.date(device.lastActive)}</p>
              </div>
            </div>
          </div>
          )
        })}
      </div>
    </div>
  )
})
