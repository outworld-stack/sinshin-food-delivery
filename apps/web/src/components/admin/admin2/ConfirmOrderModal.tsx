// src/components/admin/admin2/ConfirmOrderModal.tsx

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { memo, useCallback, useEffect, useState } from 'react'
import { Bicycle, Check, Printer, ShieldCheck } from 'reicon-react'
import { Toggle } from '#/components/shared/Toggle'
import {
  confirmLiveOrder,
  getStaffOrderInvoice,
  reassignCourier,
} from '#/server/admin'
import { useToastStore } from '#/stores/toastStore'
import { printOrderInvoices } from '#/utils/invoicePrint'
import { qk } from '#/utils/queryKeys'
import { couriersAssignmentOptions } from '#/utils/queryOptions'

const MISC_OPTION = '__misc__'

interface ConfirmOrderModalProps {
  orderId: string
  courierId: string | null
  isReassign: boolean
  onDone: () => void
  onCancel: () => void
}

// فرم واحد
interface ConfirmOrderForm {
  selected: string
  miscNote: string
  securityEnabled: boolean
}

const initialForm = (courierId: string | null): ConfirmOrderForm => ({
  selected: courierId ?? MISC_OPTION,
  miscNote: '',
  securityEnabled: false,
})

export const ConfirmOrderModal = memo(function ConfirmOrderModal({
  orderId,
  courierId,
  onDone,
  onCancel,
  isReassign,
}: ConfirmOrderModalProps) {
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.showToast)

  const [form, setForm] = useState<ConfirmOrderForm>(() =>
    initialForm(courierId),
  )
  const set = useCallback((partial: Partial<ConfirmOrderForm>) => {
    setForm((f) => ({ ...f, ...partial }))
  }, [])

  // ⬅ NEW: کوئری از فکتوری مرکزی — قبلاً کلید خام ['couriers-assignment'] بود (هم‌hash)
  const { data: couriers } = useQuery(couriersAssignmentOptions)

  // سینک انتخاب با پیکِ فعلی سفارش
  useEffect(() => {
    set({ selected: courierId ?? MISC_OPTION })
  }, [courierId, set])

  // round-12 — چاپ واقعی فاکتورها (قبلاً فقط ادعای متنی بود): پس از موفقیت،
  // دیتای فاکتور گرفته می‌شود و سند مستقل (printDocument) چاپ می‌شود.
  // خطای چاپ جریان تایید را نمی‌شکند — فقط toast.
  const printInvoices = useCallback(
    async (orderId: string, kinds: ('kitchen' | 'sales')[]) => {
      try {
        const inv = await getStaffOrderInvoice(orderId)
        await printOrderInvoices(inv, kinds)
      } catch (err) {
        showToast(
          err instanceof Error
            ? `چاپ فاکتور ناموفق بود: ${err.message}`
            : 'چاپ فاکتور ناموفق بود',
          'error',
        )
      }
    },
    [showToast],
  )

  const confirmMutation = useMutation({
    mutationFn: (payload: {
      orderId: string
      courierId: string | null
      courierNote: string | null
      securityEnabled: boolean
    }) => confirmLiveOrder(payload),
    onSuccess: (res) => {
      if (!res.success) {
        showToast(res.message ?? 'خطا', 'error')
        return
      }
      // ⬅ NEW: کلیدها از فکتوری + رفرش بین-کشی:
      // پنل زنده + لیست سفارشات ادمین + صفحات جزئیات باز (تایید = تغییر وضعیت/پیک)
      queryClient.invalidateQueries({ queryKey: qk.admin2LiveOrdersPrefix })
      queryClient.invalidateQueries({ queryKey: qk.adminOrdersAll })
      queryClient.invalidateQueries({ queryKey: qk.adminOrderDetailsAll })
      showToast(
        'سفارش تایید شد — فاکتور اشپزخانه برای چاپ ارسال شد؛ پس از بسته‌شدن پنجره، فاکتور فروش می‌آید',
      )
      onDone()
      void printInvoices(orderId, ['kitchen', 'sales'])
    },
  })

  const reassignMutation = useMutation({
    mutationFn: (payload: { orderId: string; newCourierId: string | null }) =>
      reassignCourier(payload),
    onSuccess: (res) => {
      if (!res.success) {
        showToast(res.message ?? 'خطا', 'error')
        return
      }
      // ⬅ NEW: مثل تایید — پنل زنده + لیست + جزئیات باز هم‌تراز می‌شوند
      queryClient.invalidateQueries({ queryKey: qk.admin2LiveOrdersPrefix })
      queryClient.invalidateQueries({ queryKey: qk.adminOrdersAll })
      queryClient.invalidateQueries({ queryKey: qk.adminOrderDetailsAll })
      showToast('پیک سفارش تغییر کرد — فاکتور فروش برای چاپ مجدد آماده است')
      onDone()
      void printInvoices(orderId, ['sales'])
    },
  })

  const handleConfirm = useCallback(() => {
    if (isReassign) {
      reassignMutation.mutate({
        orderId,
        newCourierId: form.selected === MISC_OPTION ? null : form.selected,
      })
    } else {
      confirmMutation.mutate({
        orderId,
        courierId: form.selected === MISC_OPTION ? null : form.selected,
        courierNote:
          form.selected === MISC_OPTION ? form.miscNote.trim() || null : null,
        securityEnabled: form.securityEnabled,
      })
    }
  }, [isReassign, form, orderId, confirmMutation, reassignMutation])

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onCancel}
      ></div>
      <div className="relative bg-white dark:bg-[#2a1015] p-6 rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <h3 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-1">
          {isReassign ? `تغییر پیک سفارش ${orderId}` : `تایید سفارش ${orderId}`}
        </h3>
        {!isReassign && (
          <p className="text-xs text-gray-400 font-DanaMedium mb-5 leading-relaxed">
            با تایید، ابتدا فاکتور اشپزخانه و پس از بسته‌شدن پنجرهٔ چاپ آن، فاکتور
            فروش ارسال می‌شود — هر فاکتور پنجرهٔ چاپ جداگانه دارد تا هر کدام روی
            پرینتر خودش (اشپزخانه / میز بیرون‌بر) چاپ شود.
          </p>
        )}
        {isReassign && (
          <p className="text-xs text-gray-400 font-DanaMedium mb-5">
            فاکتور پیک (فروش) با اطلاعات جدید دوباره چاپ می‌شود.
          </p>
        )}

        {/* سلکت‌باکس پیک */}
        <div className="mb-4">
          <label className="block text-xs font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">
            انتخاب پیک
          </label>
          <div className="relative">
            <select
              value={form.selected}
              onChange={(e) => set({ selected: e.target.value })}
              className="w-full appearance-none px-4 py-3 pl-10 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none text-gray-800 dark:text-white text-sm cursor-pointer"
            >
              <option value={MISC_OPTION}>متفرقه (تخصیص در محل)</option>
              {(couriers ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — {c.phone}
                </option>
              ))}
            </select>
            <Bicycle
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
            />
          </div>
        </div>

        {/* نکته — فقط حالت تایید + متفرقه (در تغییر پیک سرور قبول نمی‌کند — رفع F-40) */}
        {!isReassign && form.selected === MISC_OPTION && (
          <div className="mb-4">
            <label className="block text-xs font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">
              توضیحات (اختیاری)
            </label>
            <textarea
              value={form.miscNote}
              onChange={(e) => set({ miscNote: e.target.value.slice(0, 300) })}
              rows={2}
              className="w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none text-gray-800 dark:text-white text-sm resize-none font-DanaMedium"
              placeholder="مثلاً: پیک در محل توسط مسئول شیفت تخصیص داده شود..."
            />
            <p className="text-[10px] text-gray-400 mt-1 font-DanaMedium">
              این نکته برای مشتری، ادمین‌ها و در صفحه سفارش قابل رویت است.
            </p>
          </div>
        )}

        {/* سوئیچ امنیت QR — فقط تایید اولیه */}
        {!isReassign && (
          <div className="flex items-center justify-between p-4 rounded-xl border-2 border-gray-200 dark:border-[#3a151c] mb-5">
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-500/10 text-blue-500 flex items-center justify-center shrink-0">
                <ShieldCheck size={20} />
              </span>
              <div>
                <p className="font-DanaDemiBold text-sm text-gray-800 dark:text-white">
                  امنیت احراز پیک (QR)
                </p>
                <p className="text-[11px] text-gray-400 mt-0.5 leading-relaxed max-w-55">
                  فعال: فقط پیک تخصیص‌یافته می‌تواند QR را اسکن کند. خاموش: هر پکی
                  مجاز است.
                </p>
              </div>
            </div>
            <Toggle
              isOn={form.securityEnabled}
              onToggle={() => set({ securityEnabled: !form.securityEnabled })}
            />
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 font-DanaMedium cursor-pointer"
          >
            انصراف
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={confirmMutation.isPending || reassignMutation.isPending}
            className="flex-1 py-2.5 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaDemiBold cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isReassign ? <Check size={16} /> : <Printer size={16} />}
            {isReassign
              ? reassignMutation.isPending
                ? 'در حال تغییر...'
                : 'ثبت تغییر پیک'
              : confirmMutation.isPending
                ? 'در حال تایید...'
                : 'تایید و چاپ'}
          </button>
        </div>
      </div>
    </div>
  )
})
