// src/components/admin/settings/DeliveryZonesManager.tsx
// round-13 — ① آیکون ویرایش کنار حذف هر ردیف (ویرایش شعاع + هزینه)
//             ② نمایش مبدأ محاسبه‌ی فاصله (مختصات رستوران از env/تنظیمات)
// round-30 — min-w-0 روی اینپوت‌های flex (افزودن + ویرایش): بدون آن مرورگر عرض
//             ذاتی input را حداقل می‌گیرد و در کارت نیم‌عرضِ گرید تنظیمات،
//             دکمه‌ی «افزودن ناحیه» از کادر بیرون می‌زد؛ حالا اینپوت‌ها جمع
//             می‌شوند و همه‌چیز داخل کارت می‌ماند.
import { memo, useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { addDeliveryZone, removeDeliveryZone, updateDeliveryZone, setDeliveryFallbackFee } from '#/server/deliveryZones'
import { deliveryZonesOptions } from '#/utils/queryOptions'
import { qk } from '#/utils/queryKeys'
import { useToastStore } from '#/stores/toastStore'
import { ConfirmModal } from '#/components/ConfirmModal'
import { Plus, Trash2, Pin, Pen, Check, X } from 'reicon-react'
import { formatPrice, faNum } from '#/utils/format'
import type { DeliveryZone, DeliveryZonesData } from '@sinshin/shared'

// رارد ۴۶ — اینترفیس محلی DeliveryZone حذف شد؛ از قرارداد مشترک
// (@sinshin/shared) می‌آید — همان دو فیلد قبلی، منبع واحد با بک‌اند.

// Both admin roles can view zones; only the main admin can change prices.
export const DeliveryZonesManager = memo(function DeliveryZonesManager({ canManage = false }: { canManage?: boolean }) {
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.showToast)

  const [radiusInput, setRadiusInput] = useState('')
  const [feeInput, setFeeInput] = useState('')
  // Null follows server data; a draft survives background query refreshes.
  const [fallbackInput, setFallbackInput] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)
  // round-13 — ردیف در حال ویرایش: شعاع فعلی (کلید) + مقادیر فرم
  const [editing, setEditing] = useState<{ radiusKm: number; radius: string; fee: string } | null>(null)

  // ⬅ NEW: کوئری از فکتوری مرکزی — قبلاً کلید خام ['delivery-zones'] بود (هم‌hash)
  const { data, isLoading, isError } = useQuery(deliveryZonesOptions)
  const reportError = (error: Error) => showToast(error.message || 'ذخیره ناحیه ناموفق بود', 'error')

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: qk.deliveryZones })
    // قیمت‌های نمایشی چک‌اوت هم به ناحیه‌ها وابسته‌اند — بازسازی شن
    // ⬅ NEW: پریفکس رسمی به‌جای رشته خام — همه‌ی ترکیبات آیتم/آدرس/نوع تحویل
    queryClient.invalidateQueries({ queryKey: qk.checkoutPreviewPrefix })
  }, [queryClient])

  const addMut = useMutation({
    mutationFn: (payload: { radiusKm: number; fee: number }) => addDeliveryZone(payload),
    onError: reportError,

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
    onError: reportError,
    onSuccess: (res) => {
      if (!res.success) { showToast(res.message ?? 'خطا', 'error'); return }
      invalidate()
      showToast('ناحیه حذف شد')
      setConfirmDelete(null)
    },
  })

  // round-13 — به‌روزرسانی ناحیه (فقط ادمین اصلی؛ API گارد دارد)
  const updateMut = useMutation({
    onError: reportError,
    mutationFn: (payload: { radiusKm: number; newRadiusKm: number; fee: number }) =>
      updateDeliveryZone(payload),
    onSuccess: (res) => {
      if (!res.success) { showToast(res.message ?? 'خطا', 'error'); return }
      invalidate()
      setEditing(null)
      showToast('ناحیه به‌روزرسانی شد')
    },
  })

  const fallbackMut = useMutation({
    mutationFn: (fee: number) => setDeliveryFallbackFee({ fee }),
    onError: reportError,
    onSuccess: (res, fee) => {
      if (!res.success) { showToast(res.message ?? 'خطا', 'error'); return }
      queryClient.setQueryData<DeliveryZonesData>(qk.deliveryZones, (previous) => previous ? { ...previous, fallbackFee: fee } : previous)
      setFallbackInput(null)
      invalidate()
      showToast('هزینه پیش‌فرض ارسال ذخیره شد')
    },
  })

  const handleAdd = useCallback(() => {
    const radiusKm = Number(radiusInput)
    const fee = Number(feeInput)
    if (!Number.isFinite(radiusKm) || radiusKm < 0.5 || radiusKm > 500) { showToast('شعاع باید بین ۰.۵ و ۵۰۰ کیلومتر باشد', 'error'); return }
    if (!feeInput.trim() || !Number.isSafeInteger(fee) || fee < 0 || fee > 2_147_483_647) { showToast('هزینه معتبر نیست', 'error'); return }
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
    if (!Number.isFinite(newRadiusKm) || newRadiusKm < 0.5 || newRadiusKm > 500) { showToast('شعاع باید بین ۰.۵ و ۵۰۰ کیلومتر باشد', 'error'); return }
    if (!editing.fee.trim() || !Number.isSafeInteger(fee) || fee < 0 || fee > 2_147_483_647) { showToast('هزینه معتبر نیست', 'error'); return }
    updateMut.mutate({ radiusKm: editing.radiusKm, newRadiusKm, fee })
  }, [editing, updateMut, showToast])

  const zones: DeliveryZone[] = data?.zones ?? []
  const origin = data?.origin
  const isSaving = addMut.isPending || updateMut.isPending || removeMut.isPending || fallbackMut.isPending
  const fallbackValue = fallbackInput ?? (data?.fallbackFee == null ? '' : String(data.fallbackFee))

  return (
    <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
      <h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-2 flex items-center gap-2">
        <Pin size={20} className="text-primary dark:text-dark-primary" />
        ناحیه‌های ارسال
      </h2>
      <p className="text-xs text-gray-500 dark:text-gray-400 font-DanaMedium mb-4 leading-relaxed">
        هزینه پیک بر اساس مسافت مسیر از رستوران تا آدرس مشتری در سرویس ماتریس فاصله نشان محاسبه می‌شود.
        نرخ اولین ناحیه‌ای که مسافت در آن جا می‌گیرد اعمال می‌شود؛ بیرون از همه ناحیه‌ها، نرخ آخرین ناحیه محاسبه می‌شود.
        هزینه پس از انتخاب آدرس در صفحه پرداخت نمایش داده می‌شود. حداقل یک ناحیه باید باقی بماند.
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
          </p>
        </div>
      )}

      {isError && <p role="alert" className="mb-3 text-sm text-red-500">دریافت ناحیه‌های ارسال ناموفق بود؛ دوباره تلاش کنید.</p>}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-14 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          <div className="mb-6 p-4 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-100 dark:border-white/5">
            <h3 className="font-DanaDemiBold text-sm text-gray-800 dark:text-white">هزینه پیش‌فرض ارسال</h3>
            <p className="mt-2 mb-3 text-xs text-gray-500 dark:text-gray-400 font-DanaMedium leading-relaxed">
              در صورت قطعی یا خطای سرویس نشان، این مبلغ برای ارسال اعمال می‌شود و پرداخت ادامه پیدا می‌کند.
              تا پیش از ذخیره مبلغ دلخواه، نرخ آخرین ناحیه استفاده می‌شود.
            </p>
            {canManage ? (
              <form onSubmit={(event) => {
                event.preventDefault()
                if (isSaving || isError || !data) return
                const fee = Number(fallbackValue)
                if (!fallbackValue.trim() || !Number.isSafeInteger(fee) || fee < 0 || fee > 2_147_483_647) {
                  showToast('هزینه معتبر نیست', 'error')
                  return
                }
                fallbackMut.mutate(fee)
              }}>
                <label htmlFor="delivery-fallback-fee" className="block mb-2 text-xs font-DanaMedium text-gray-600 dark:text-gray-300">هزینه پیش‌فرض (تومان)</label>
                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    id="delivery-fallback-fee"
                    type="number"
                    value={fallbackValue}
                    onChange={(event) => setFallbackInput(event.target.value)}
                    min="0"
                    max="2147483647"
                    step="1"
                    required
                    disabled={isSaving || isError || !data}
                    className="min-w-0 flex-1 px-4 py-2.5 rounded-xl bg-white dark:bg-[#2a1015] border border-gray-200 dark:border-[#3a151c] text-sm outline-none disabled:opacity-50"
                  />
                  <button type="submit" disabled={isSaving || isError || !data || !fallbackValue.trim()} className="px-6 py-2.5 rounded-xl bg-primary dark:bg-dark-primary text-white text-sm font-DanaDemiBold hover:opacity-90 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                    {fallbackMut.isPending ? 'در حال ذخیره...' : 'ذخیره هزینه پیش‌فرض'}
                  </button>
                </div>
              </form>
            ) : (
              <p className="text-sm font-DanaDemiBold text-gray-700 dark:text-gray-200">
                {data?.fallbackFee == null ? 'تعیین نشده' : `${formatPrice(data.fallbackFee)} تومان`}
              </p>
            )}
          </div>
          {/* لیست ناحیه‌ها — مرتب روی شعاع */}
          <div className="space-y-3">
            {zones.map((z, i) => {
              const isEditing = editing?.radiusKm === z.radiusKm
              return (
                <div key={z.radiusKm} className="flex items-center justify-between p-4 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-100 dark:border-white/5">
                  {canManage && isEditing ? (
                    /* round-13 — حالت ویرایش: شعاع + هزینه + تایید/انصراف */
                    <div className="w-full space-y-3">
                      <div className="flex flex-col sm:flex-row gap-3">
                        <input
                          type="number"
                          value={editing!.radius}
                          onChange={(e) => setEditing(prev => prev ? { ...prev, radius: e.target.value } : prev)}
                          placeholder="حداکثر مسافت (کیلومتر)"
                          aria-label="حداکثر مسافت مسیر (کیلومتر)"
                          min="0.5"
                          max="500"
                          step="any"
                          className="min-w-0 flex-1 px-4 py-2.5 rounded-xl bg-white dark:bg-[#2a1015] border border-primary text-sm outline-none"
                        />
                        <input
                          type="number"
                          value={editing!.fee}
                          onChange={(e) => setEditing(prev => prev ? { ...prev, fee: e.target.value } : prev)}
                          placeholder="هزینه (تومان)"
                          aria-label="هزینه ارسال (تومان)"
                          min="0"
                          max="2147483647"
                          step="1"
                          className="min-w-0 flex-1 px-4 py-2.5 rounded-xl bg-white dark:bg-[#2a1015] border border-primary text-sm outline-none"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleSaveEdit}
                          disabled={isSaving}
                          className="flex-1 py-2 rounded-xl bg-primary dark:bg-dark-primary text-white text-sm font-DanaDemiBold hover:opacity-90 transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                        >
                          <Check size={15} />
                          {updateMut.isPending ? 'در حال ذخیره...' : 'ذخیره تغییرات'}
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelEdit}
                          disabled={isSaving}
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
                        {canManage && <button
                          type="button"
                          onClick={() => handleStartEdit(z)}
                          disabled={isSaving}
                          className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5 transition cursor-pointer"
                          aria-label="ویرایش ناحیه"
                          title="ویرایش مسافت و هزینه"
                        >
                          <Pen size={16} />
                        </button>}
                        {canManage && <button
                          type="button"
                          onClick={() => setConfirmDelete(z.radiusKm)}
                          disabled={isSaving || zones.length <= 1}
                          className="p-2 rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition cursor-pointer"
                          aria-label="حذف ناحیه"
                          title={zones.length <= 1 ? 'حداقل یک ناحیه باید باقی بماند' : 'حذف ناحیه'}
                        >
                          <Trash2 size={16} />
                        </button>}
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

          {/* فرم افزودن — round-30: min-w-0 تا اینپوت‌ها زیر عرض ذاتی جمع شوند و دکمه داخل کادر بماند */}
          {canManage && <div className="mt-6 pt-4 border-t border-gray-100 dark:border-white/5 flex flex-col sm:flex-row gap-3">
            <input
              type="number"
              value={radiusInput}
              onChange={(e) => setRadiusInput(e.target.value)}
              placeholder="حداکثر مسافت (کیلومتر) — مثلا 5"
              aria-label="حداکثر مسافت مسیر جدید (کیلومتر)"
              className="min-w-0 flex-1 px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm outline-none"
              min="0.5"
              max="500"
              step="any"
            />
            <input
              type="number"
              value={feeInput}
              onChange={(e) => setFeeInput(e.target.value)}
              placeholder="هزینه (تومان) — مثلا 35000"
              aria-label="هزینه ارسال ناحیه جدید (تومان)"
              className="min-w-0 flex-1 px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm outline-none"
              min="0"
              max="2147483647"
              step="1"
            />
            <button
              type="button"
              onClick={handleAdd}
              disabled={isSaving || isError}
              className="px-6 py-2.5 rounded-xl bg-primary dark:bg-dark-primary text-white text-sm font-DanaDemiBold hover:opacity-90 transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2 shrink-0"
            >
              <Plus size={16} />
              افزودن ناحیه
            </button>
          </div>}
        </>
      )}

      <ConfirmModal
        isOpen={canManage && confirmDelete !== null}
        isPending={removeMut.isPending}
        title="حذف ناحیه"
        message={`آیا از حذف ناحیه تا ${faNum(confirmDelete ?? 0)} کیلومتر مطمئن هستید؟`}
        onConfirm={() => { if (confirmDelete !== null) removeMut.mutate(confirmDelete) }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  )
})
