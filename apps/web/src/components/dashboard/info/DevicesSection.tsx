// src/components/dashboard/info/DevicesSection.tsx
import { memo } from 'react'
import { formatDate } from '#/utils/format'
import { Monitor } from 'reicon-react'

interface DeviceItem {
  id: string
  deviceName: string
  lastActive: Date
  isCurrent: boolean
}

interface DevicesSectionProps {
  devices: DeviceItem[]
}

export const DevicesSection = memo(function DevicesSection({ devices }: DevicesSectionProps) {
  return (
    <div className="bg-white dark:bg-[#2a1015] p-6 md:p-8 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
      <h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-6">دستگاه‌های متصل</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 font-DanaMedium leading-relaxed">
        بر اساس قوانین امنیتی سین‌شین، هر دستگاه فقط می‌تواند با یک شماره موبایل ثبت‌نام کند و امکان ثبت‌نام با شماره جدید روی همین دستگاه وجود ندارد.
      </p>
      <div className="space-y-3">
        {devices.map((device) => (
          <div key={device.id} className="flex items-center justify-between p-4 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-100 dark:border-white/5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gray-200 dark:bg-[#2a1015] flex items-center justify-center text-gray-500 dark:text-gray-400">
                <Monitor size={20} />
              </div>
              <div>
                <p className="font-DanaMedium text-gray-800 dark:text-white text-sm">{device.deviceName}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">آخرین فعالیت: {formatDate(device.lastActive)}</p>
              </div>
            </div>
            {device.isCurrent && (
              <span className="text-xs text-green-500 font-DanaDemiBold px-3 py-1 rounded-full bg-green-100 dark:bg-green-500/10">دستگاه فعلی</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
})