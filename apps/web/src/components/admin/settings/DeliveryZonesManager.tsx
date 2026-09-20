// src/components/admin/settings/DeliveryZonesManager.tsx
import { memo, useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { addDeliveryZone, removeDeliveryZone } from '#/server/deliveryZones'
import { deliveryZonesOptions } from '#/utils/queryOptions'
import { qk } from '#/utils/queryKeys'
import { useToastStore } from '#/stores/toastStore'
import { ConfirmModal } from '#/components/ConfirmModal'
import { Plus, Trash2, Pin } from 'reicon-react'
import { formatPrice, faNum } from '#/utils/format'

interface DeliveryZone {
  radiusKm: number
  fee: number
}

// ناحیه‌های ارسال — مشترک ادمین اصلی و ادمین۲ (هر دو می‌توانند مدیریت کنند)
export const DeliveryZonesManager = memo(function DeliveryZonesManager() {
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.showToast)

  const [radiusInput, setRadiusInput] = useState('')
  const [feeInput, setFeeInput] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)

  // ⬅ NEW: کوئری از فکتوری مرکزی — قبلاً کلید خام ['delivery-zones'] بود (هم‌hash)
  const { data, isLoading } = useQuery(deliveryZonesOptions)

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: qk.deliveryZones })
    // قیمت‌های نمایشی چک‌اوت هم به ناحیه‌ها وابسته‌اند — بازسازی شن
    // ⬅ NEW: پریفکس رسمی به‌جای رشته خام — همه‌ی ترکیبات آیتم/آدرس/نوع تحویل
    queryClient.invalidateQueries({ queryKey: qk.checkoutPreviewPrefix })
  }, [queryClient])

  const addMut = useMutation({
    mutationFn: (payload: { radiusKm: number; fee: number }) => addDeliveryZone(payload),

    onSuccess: (res) => {
      if (!res.success) { showToast(res.message ?? 'خطا', 'error'); return }
      invalidate()
      setRadiusInput('')
      setFeeInput('')
      showToast('ناحیه اضافه شد')
    },
  })

  const removeMut = useMutation({
    mutationFn: (radiusKm: number) => removeDeliveryZone({ radiusKm }),
    onSuccess: (res) => {
      if (!res.success) { showToast(res.message ?? 'خطا', 'error'); return }
      invalidate()
      showToast('ناحیه حذف شد')
      setConfirmDelete(null)
    },
  })

  const handleAdd = useCallback(() => {
    const radiusKm = Number(radiusInput)
    const fee = Number(feeInput)
    if (!Number.isFinite(radiusKm) || radiusKm < 0.5) { showToast('شعاع حداقل ۰.۵ کیلومتر', 'error'); return }
    if (!Number.isFinite(fee) || fee < 0) { showToast('هزینه معتبر نیست', 'error'); return }
    addMut.mutate({ radiusKm, fee })
  }, [radiusInput, feeInput, addMut, showToast])

  const zones: DeliveryZone[] = data?.zones ?? []

  return (
    <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
      <h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-2 flex items-center gap-2">
        <Pin size={20} className="text-primary dark:text-dark-primary" />
        ناحیه‌های ارسال
      </h2>
      <p className="text-xs text-gray-500 dark:text-gray-400 font-DanaMedium mb-6 leading-relaxed">
        هزینه پیک بر اساس فاصله آدرس مشتری از رستوران محاسبه می‌شود — مشتری در ناحیه‌ی بزرگ‌تر، هزینه‌ی همان ناحیه را می‌پردازد.
        آدرسی بیرون از همه‌ی ناحیه‌ها → نرخ ناحیه‌ی بیرونی. قبل از انتخاب آدرس → نرخ ناحیه‌ی داخلی.
      </p>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-14 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {/* لیست ناحیه‌ها — مرتب روی شعاع */}
          <div className="space-y-3">
            {zones.map((z, i) => (
              <div key={z.radiusKm} className="flex items-center justify-between p-4 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-100 dark:border-white/5">
                <div className="flex items-center gap-3">
                  <span className="w-10 h-10 rounded-xl bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary flex items-center justify-center font-DanaDemiBold text-sm shrink-0">
                    {faNum(i + 1)}
                  </span>
                  <div>
                    <p className="font-DanaDemiBold text-gray-800 dark:text-white text-sm">
                      تا {faNum(z.radiusKm)} کیلومتر
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5 font-DanaMedium">
                      {formatPrice(z.fee)} تومان
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {i === zones.length - 1 && zones.length > 1 && (
                    <span className="text-[10px] text-gray-400 font-DanaMedium px-2 py-1 rounded-full bg-gray-100 dark:bg-[#2a1015]">
                      بیرون از همه هم این نرخ
                    </span>
                  )}
                  <button
                    onClick={() => setConfirmDelete(z.radiusKm)}
                    className="p-2 rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition cursor-pointer"
                    aria-label="حذف ناحیه"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
            {zones.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-6 font-DanaMedium">ناحیه‌ای ثبت نشده</p>
            )}
          </div>

          {/* فرم افزودن */}
          <div className="mt-6 pt-4 border-t border-gray-100 dark:border-white/5 flex flex-col sm:flex-row gap-3">
            <input
              type="number"
              value={radiusInput}
              onChange={(e) => setRadiusInput(e.target.value)}
              placeholder="شعاع (کیلومتر) — مثلا 5"
              className="flex-1 px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm outline-none"
              min="0.5"
              step="0.5"
            />
            <input
              type="number"
              value={feeInput}
              onChange={(e) => setFeeInput(e.target.value)}
              placeholder="هزینه (تومان) — مثلا 35000"
              className="flex-1 px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm outline-none"
              min="0"
            />
            <button
              onClick={handleAdd}
              disabled={addMut.isPending}
              className="px-6 py-2.5 rounded-xl bg-primary dark:bg-dark-primary text-white text-sm font-DanaDemiBold hover:opacity-90 transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2 shrink-0"
            >
              <Plus size={16} />
              افزودن ناحیه
            </button>
          </div>
        </>
      )}

      <ConfirmModal
        isOpen={confirmDelete !== null}
        title="حذف ناحیه"
        message={`آیا از حذف ناحیه تا ${faNum(confirmDelete ?? 0)} کیلومتر مطمئن هستید؟`}
        onConfirm={() => { if (confirmDelete !== null) removeMut.mutate(confirmDelete) }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  )
})