// src/components/dashboard/order-detail/CourierTrackingMap.tsx
import { memo } from 'react'
import { Bicycle, Pin } from 'reicon-react'

interface CourierTrackingMapProps {
  status: string
  courierLocation?: { lat: number; lng: number } | null
  customerLocation?: { lat: number; lng: number } | null
}

// نقشه ردیابی — موقعیت زنده از استریم پیک (فاز بک: نقشه واقعی نشان/بلد)
export const CourierTrackingMap = memo(function CourierTrackingMap({
  status, courierLocation, customerLocation,
}: CourierTrackingMapProps) {
  if (status !== 'ON_THE_WAY') {
    return (
      <div className="h-80 flex flex-col items-center justify-center bg-gray-50 dark:bg-[#1a0a0e] rounded-xl border border-dashed border-gray-300 dark:border-white/5">
        <span className="w-16 h-16 rounded-full bg-gray-200 dark:bg-[#2a1015] flex items-center justify-center text-gray-400 mb-4">
          <Bicycle size={32} />
        </span>
        <p className="font-DanaMedium text-gray-400 dark:text-gray-500">منتظر تخصیص پیک...</p>
      </div>
    )
  }

  // تبدیل مختصات به درصد گرید — نسبت به مقصد (موک)
  const dest = customerLocation ?? { lat: 35.776, lng: 51.414 }
  let x = 20
  let y = 30
  if (courierLocation) {
    const dLat = courierLocation.lat - dest.lat
    const dLng = courierLocation.lng - dest.lng
    x = Math.min(92, Math.max(8, 50 + dLng * 400))
    y = Math.min(92, Math.max(8, 50 - dLat * 400))
  }

  return (
    <div className="relative w-full h-80 rounded-xl overflow-hidden bg-gray-100 dark:bg-[#1a0a0e] border border-gray-300 dark:border-white/10">
      <div className="absolute inset-0 bg-[linear-gradient(rgba(0,0,0,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.1)_1px,transparent_1px)] dark:bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-size-[40px_40px]"></div>

      {/* مسیر */}
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <line x1={x} y1={y} x2="70" y2="70" stroke="currentColor" strokeWidth="0.5" strokeDasharray="2 2" className="text-primary dark:text-dark-primary" />
      </svg>

      {/* پیک — موقعیت زنده */}
      <div className="absolute transition-all duration-1000" style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' }}>
        <Bicycle size={36} className="text-primary dark:text-dark-primary drop-shadow-lg" />
      </div>

      {/* مقصد */}
      <div className="absolute" style={{ left: '70%', top: '70%', transform: 'translate(-50%, -100%)' }}>
        <Pin size={36} className="text-green-500 drop-shadow-lg" />
      </div>

      {/* مختصات زنده */}
      {courierLocation && (
        <div className="absolute top-2 right-2 bg-white/90 dark:bg-black/70 rounded-lg px-3 py-1.5 text-[10px] font-DanaMedium text-gray-600 dark:text-gray-300" dir="ltr">
          {courierLocation.lat.toFixed(4)}, {courierLocation.lng.toFixed(4)}
        </div>
      )}
    </div>
  )
})