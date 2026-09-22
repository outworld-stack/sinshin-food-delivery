// src/components/admin/settings/DeliveryZonesManager.tsx
// round-13 — ① آیکون ویرایش کنار حذف هر ردیف (ویرایش شعاع + هزینه)
//             ② نمایش مبدأ محاسبه‌ی فاصله (مختصات رستوران از env/تنظیمات)
import { memo, useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { addDeliveryZone, removeDeliveryZone, updateDeliveryZone } from '#/server/deliveryZones'
import { deliveryZonesOptions } from '#/utils/queryOptions'
import { qk } from '#/utils/queryKeys'
import { useToastStore } from '#/stores/toastStore'
import { ConfirmModal } from '#/components/ConfirmModal'
import { Plus, Trash2, Pin, Pen, Check, X } from 'reicon-react'
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
  // round-13 — ردیف در حال ویرایش: شعاع فعلی (کلید) + مقادیر فرم
  const [editing, setEditing] = useState<{ radiusKm: number; radius: string; fee: string } | null>(null)

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

  // round-13 — به‌روزرسانی ناحیه (فقط ادمین اصلی؛ API گارد دارد)
  const updateMut = useMutation({
    mutationFn: (payload: { radiusKm: number; newRadiusKm: number; fee: number }) =>
      updateDeliveryZone(payload),
    onSuccess: (res) => {
      if (!res.success) { showToast(res.message ?? 'خطا', 'error'); return }
      invalidate()
      setEditing(null)
      showToast('ناحیه به‌روزرسانی شد')
    },
  })

  const handleAdd = useCallback(() => {
    const radiusKm = Number(radiusInput)
    const fee = Number(feeInput)
    if (!Number.isFinite(radiusKm) || radiusKm < 0.5) { showToast('شعاع حداقل ۰.۵ کیلومتر', 'error'); return }
    if (!Number.isFinite(fee) || fee < 0) { showToast('هزینه معتبر نیست', 'error'); return }
    addMut.mutate({ radiusKm, fee })
  }, [radiusInput, feeInput, addMut, showToast])

  const handleStartEdit = useCallback((z: DeliveryZone) => {
    setConfirmDelete(null)
    setEditing({ radiusKm: z.radiusKm, radius: String(z.radiusKm), fee: String(z.fee) })
  }, [])

  const handleCancelEdit = useCallback(() => setEditing(null), [])

  const handleSaveEdit = useCallback(() => {
    if (!editing) return
    const newRadiusKm = Number(editing.radius)
    const fee = Number(editing.fee)
    if (!Number.isFinite(newRadiusKm) || newRadiusKm < 0.5) { showToast('شعاع حداقل ۰.۵ کیلومتر', 'error'); return }
    if (!Number.isFinite(fee) || fee < 0) { showToast('هزینه معتبر نیست', 'error'); return }
    updateMut.mutate({ radiusKm: editing.radiusKm, newRadiusKm, fee })
  }, [editing, updateMut, showToast])

  const zones: DeliveryZone[] = data?.zones ?? []
  const origin = data?.origin

  return (
    <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
      <h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-2 flex items-center gap-2">
        <Pin size={20} className="text-primary dark:text-dark-primary" />
        ناحیه‌های ارسال
      </h2>
      <p className="text-xs text-gray-500 dark:text-gray-400 font-DanaMedium mb-4 leading-relaxed">
        هزینه پیک بر اساس فاصله آدرس مشتری از رستوران محاسبه می‌شود — مشتری در ناحیه‌ی بزرگ‌تر، هزینه‌ی همان ناحیه را می‌پردازد.
        آدرسی بیرون از همه‌ی ناحیه‌ها → نرخ ناحیه‌ی بیرونی. قبل از انتخاب آدرس → نرخ ناحیه‌ی داخلی.
      </p>

      {/* round-13 — مبدأ محاسبه‌ی فاصله (مختصات رستوران) */}
      {origin && (
        <div className="mb-6 p-3 rounded-xl bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20 flex items-center gap-2">
          <Pin size={14} className="text-blue-500 shrink-0" />
          <p className="text-xs text-blue-600 dark:text-blue-400 font-DanaMedium leading-relaxed">
            مبدأ محاسبه‌ی فاصله (مختصات رستوران):{' '}
            <span className="font-DanaDemiBold" dir="ltr">
              {origin.lat.toFixed(6)}, {origin.lng.toFixed(6)}
            </span>{' '}
            — با متغیرهای محیطی <code dir="ltr">RESTAURANT_LAT</code> /{' '}
            <code dir="ltr">RESTAURANT_LNG</code> در <code dir="ltr">apps/api/.env</code> قابل
            تنظیم است (بعد از تغییر، API را ری‌استارت کنید).
          </p>
        </div>
      )}

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
            {zones.map((z, i) => {
              const isEditing = editing?.radiusKm === z.radiusKm
              return (
                <div key={z.radiusKm} className="flex items-center justify-between p-4 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-100 dark:border-white/5">
                  {isEditing ? (
                    /* round-13 — حالت ویرایش: شعاع + هزینه + تایید/انصراف */
                    <div className="w-full space-y-3">
                      <div className="flex flex-col sm:flex-row gap-3">
                        <input
                          type="number"
                          value={editing!.radius}
                          onChange={(e) => setEditing(prev => prev ? { ...prev, radius: e.target.value } : prev)}
                          placeholder="شعاع (کیلومتر)"
                          min="0.5"
                          step="0.5"
                          className="flex-1 px-4 py-2.5 rounded-xl bg-white dark:bg-[#2a1015] border border-primary text-sm outline-none"
                        />
                        <input
                          type="number"
                          value={editing!.fee}
                          onChange={(e) => setEditing(prev => prev ? { ...prev, fee: e.target.value } : prev)}
                          placeholder="هزینه (تومان)"
                          min="0"
                          className="flex-1 px-4 py-2.5 rounded-xl bg-white dark:bg-[#2a1015] border border-primary text-sm outline-none"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleSaveEdit}
                          disabled={updateMut.isPending}
                          className="flex-1 py-2 rounded-xl bg-primary dark:bg-dark-primary text-white text-sm font-DanaDemiBold hover:opacity-90 transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                        >
                          <Check size={15} />
                          {updateMut.isPending ? 'در حال ذخیره...' : 'ذخیره تغییرات'}
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelEdit}
                          className="flex-1 py-2 rounded-xl bg-gray-100 dark:bg-[#2a1015] text-gray-600 dark:text-gray-300 text-sm font-DanaMedium hover:bg-gray-200 dark:hover:bg-[#3a151c] transition cursor-pointer flex items-center justify-center gap-1.5"
                        >
                          <X size={15} />
                          انصراف
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
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
                        {/* round-13 — ویرایش، کنار حذف */}
                        <button
                          type="button"
                          onClick={() => handleStartEdit(z)}
                          className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5 transition cursor-pointer"
                          aria-label="ویرایش ناحیه"
                          title="ویرایش شعاع و هزینه"
                        >
                          <Pen size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(z.radiusKm)}
                          className="p-2 rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition cursor-pointer"
                          aria-label="حذف ناحیه"
                          title="حذف ناحیه"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )
            })}
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
              type="button"
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
