// ═══════════════════════════════════════════════════════════════
// round-34 — sinshin-food-delivery — فایل 39 از 49
// مسیر مقصد: apps/web/src/components/admin/settings/TemporaryCloseCard.tsx
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty
// ═══════════════════════════════════════════════════════════════

// src/components/admin/settings/TemporaryCloseCard.tsx
// round-13 — باز/بسته کردن موقت رستوران با «علت اجباری»:
//  • ادمین اصلی: همیشه
//  • ادمین۲: با پرمیشن canToggleTemporaryClose (سمت سرور هم گارد دارد)
// علت برای بستن «و» باز کردن پرسیده می‌شود؛ علت بستن در خلاصه سفارش
// به مشتری نمایش داده می‌شود و علت باز شدن فقط برای ممیزی ذخیره می‌شود.
import { TEMPORARY_CLOSE_REASON_MIN_LENGTH } from '@sinshin/shared'
import { memo, useState, useCallback, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { setTemporaryClose } from '#/server/admin'
import { settingsRestaurantStatusOptions } from '#/utils/queryOptions'
import { qk } from '#/utils/queryKeys'
import { useToastStore } from '#/stores/toastStore'
import { Toggle } from '#/components/shared/Toggle'
import { ArField } from '#/components/admin/ArField'
import { StopwatchOff, StopwatchPlay, Discover2, Clock } from 'reicon-react'

interface TemporaryCloseCardProps {
  /** فقط کسی که پرمیشن دارد کارت را می‌بیند (ادمین اصلی/ادمین۲ مجاز) */
  visible: boolean
}

export const TemporaryCloseCard = memo(function TemporaryCloseCard({ visible }: TemporaryCloseCardProps) {
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.showToast)

  const { data: status } = useQuery({
    ...settingsRestaurantStatusOptions,
    enabled: visible,
  })

  // مودال علت — برای هر دو جهت (بستن و باز کردن) اجباری
  const [pendingClosed, setPendingClosed] = useState<boolean | null>(null)
  const [reason, setReason] = useState('')
  // round-34 — علت عربی (اختیاری؛ فقط هنگام بستن معنا دارد؛ خالی = همان فارسی)
  const [reasonAr, setReasonAr] = useState('')
  // round-29 — زمان باز شدن مجدد (اختیاری، فقط هنگام بستن) — جدا از ساعت کاری اصلی
  const [reopenTime, setReopenTime] = useState('')
  const [disablePayments, setDisablePayments] = useState(false)
  const submitting = useRef(false)
  const modalSession = useRef(0)
  const session = modalSession.current

  const mutation = useMutation({
    mutationFn: (input: { closed: boolean; disablePayments?: boolean; reason: string; reopenTime?: string; reasonAr?: string | null }) =>
      setTemporaryClose({ data: input }),
    onSuccess: () => {
      submitting.current = false
      modalSession.current++
      queryClient.invalidateQueries({ queryKey: qk.settingsRestaurantStatus })
      // چک‌اوت همیشه وضعیت تازه ببیند
      queryClient.invalidateQueries({ queryKey: qk.restaurantStatus })
      setPendingClosed(null)
      setReason('')
      setReasonAr('')
      setReopenTime('')
      setDisablePayments(false)
      showToast('وضعیت موقت رستوران ثبت شد')
    },
    onError: (err) => {
      submitting.current = false
      showToast(err instanceof Error ? err.message : 'ثبت وضعیت ناموفق بود', 'error')
    },
  })

  const handleToggle = useCallback(() => {
    if (!status || submitting.current || mutation.isPending) return
    modalSession.current++
    // جهت مخالف فعلی — با کادر علت
    setPendingClosed(!status.temporarilyClosed)
    setReason('')
    setReasonAr('')
    setDisablePayments(false)
    // round-29 — پیش‌پرکردن زمان باز شدن با مقدار ثبت‌شده‌ی فعلی (ویرایش راحت)
    setReopenTime(!status.temporarilyClosed ? (status.temporaryReopenTime ?? '') : '')
  }, [status, mutation.isPending])

  const handleEdit = useCallback(() => {
    if (!status?.temporarilyClosed || submitting.current || mutation.isPending) return
    modalSession.current++
    setPendingClosed(true)
    setReason(status.temporaryCloseReason ?? '')
    setReasonAr(status.temporaryCloseReasonAr ?? '')
    setReopenTime(status.temporaryReopenTime ?? '')
    setDisablePayments(status.paymentsDisabled)
  }, [status, mutation.isPending])

  const handleCancel = useCallback(() => {
    if (submitting.current || mutation.isPending) return
    modalSession.current++
    setPendingClosed(null)
    setReason('')
    setReasonAr('')
    setReopenTime('')
    setDisablePayments(false)
  }, [mutation.isPending])

  const handleConfirm = useCallback(() => {
    if (pendingClosed === null || submitting.current || mutation.isPending) return
    const trimmed = reason.trim()
    const minLength = pendingClosed ? TEMPORARY_CLOSE_REASON_MIN_LENGTH : 3
    if (trimmed.length < minLength) {
      showToast(`علت را بنویسید (حداقل ${minLength.toLocaleString('fa-IR')} نویسه)`, 'error')
      return
    }
    const trimmedTime = reopenTime.trim()
    const trimmedAr = reasonAr.trim()
    if (pendingClosed && trimmedAr && trimmedAr.length < TEMPORARY_CLOSE_REASON_MIN_LENGTH) {
      showToast(`علت عربی باید حداقل ${TEMPORARY_CLOSE_REASON_MIN_LENGTH.toLocaleString('fa-IR')} نویسه داشته باشد`, 'error')
      return
    }
    if (trimmed.length > 120 || (pendingClosed && trimmedAr.length > 120)) {
      showToast('علت فارسی و عربی نباید بیشتر از ۱۲۰ نویسه باشند', 'error')
      return
    }
    submitting.current = true
    mutation.mutate({
      closed: pendingClosed,
      disablePayments: pendingClosed && disablePayments,
      reason: trimmed,
      // round-34 — علت عربی فقط هنگام بستن ارسال می‌شود؛ باز شدن کلید را پاک می‌کند
      reasonAr: pendingClosed && trimmedAr ? trimmedAr : undefined,
      // فقط هنگام بستن معنا دارد؛ هنگام باز شدن پاک می‌شود
      reopenTime: pendingClosed && trimmedTime ? trimmedTime : undefined,
    })
  }, [pendingClosed, reason, reasonAr, reopenTime, disablePayments, mutation, showToast])

  if (!visible) return null

  const temporarilyClosed = status?.temporarilyClosed ?? false

  return (
    <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className={`w-11 h-11 rounded-xl flex items-center justify-center ${temporarilyClosed
            ? 'bg-red-100 dark:bg-red-500/10 text-red-500'
            : 'bg-green-100 dark:bg-green-500/10 text-green-500'
            }`}>
            {temporarilyClosed ? <StopwatchOff size={22} /> : <StopwatchPlay size={22} />}
          </span>
          <div>
            <p className="font-DanaDemiBold text-gray-800 dark:text-white">
              {temporarilyClosed ? 'رستوران موقتاً بسته است' : 'رستوران باز است (موقت)'}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-xs leading-relaxed">
              بسته/باز موقت (قطعی گاز/برق و…) — ثبت آن با ذکر علت الزامی است.
              علت بسته بودن به مشتری در خلاصه سفارش نشان داده می‌شود.
            </p>
          </div>
        </div>
        <Toggle
          isOn={!temporarilyClosed}
          onToggle={handleToggle}
          label="باز/بسته موقت رستوران"
          disabled={!status || mutation.isPending}
        />
      </div>

      {temporarilyClosed && (
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {status?.paymentsDisabled ? 'پرداخت سفارش‌ها غیرفعال است' : 'پرداخت سفارش‌ها فعال است'}
          </p>
          <button
            type="button"
            onClick={handleEdit}
            disabled={mutation.isPending}
            className="text-xs font-DanaMedium text-primary dark:text-dark-primary underline cursor-pointer disabled:opacity-50"
          >
            ویرایش علت و پرداخت
          </button>
        </div>
      )}

      {/* علت فعلی بسته‌بودن */}
      {temporarilyClosed && status?.temporaryCloseReason && (
        <div className="mt-4 p-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20">
          <p className="text-xs text-red-600 dark:text-red-400 font-DanaMedium leading-relaxed">
            <span className="font-DanaDemiBold">علت فعلی: </span>
            {status.temporaryCloseReason}
          </p>
        </div>
      )}

      {/* round-29 — زمان باز شدن مجددِ ثبت‌شده (جدا از ساعت کاری اصلی) */}
      {temporarilyClosed && status?.temporaryReopenTime && (
        <div className="mt-4 p-3 rounded-xl bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20 flex items-center gap-2">
          <Clock size={16} className="text-orange-500 shrink-0" />
          <p className="text-xs text-orange-600 dark:text-orange-400 font-DanaMedium">
            <span className="font-DanaDemiBold">باز شدن مجدد (یادداشت مدیریتی): </span>
            {status.temporaryReopenTime}
          </p>
        </div>
      )}

      <div className="mt-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 flex items-start gap-2">
        <Discover2 size={16} className="text-amber-500 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-600 dark:text-amber-400 font-DanaMedium leading-relaxed">
          در حالت بسته موقت می‌توانید پرداخت سفارش‌ها را فعال نگه دارید یا غیرفعال کنید.
          با پرداخت فعال، سفارش‌ها تا باز شدن در صف می‌مانند. ساعات کاری روزانه جداست.
        </p>
      </div>

      {/* کادر علت — مدال سبک، بدون بستن با کلیک پس‌زمینه (علت اجباری است) */}
      {pendingClosed !== null && (
        <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="relative bg-white dark:bg-[#2a1015] p-6 rounded-2xl shadow-xl w-full max-w-md max-h-[90dvh] overflow-y-auto">
            <h3 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-1">
              {pendingClosed ? (temporarilyClosed ? 'ویرایش بسته موقت' : 'اعلام بسته موقت') : 'اعلام باز شدن'}
            </h3>
            <p className="text-xs text-gray-400 font-DanaMedium mb-5 leading-relaxed">
              {pendingClosed
                ? 'این علت به مشتریان در صفحه چک‌اوت (باکس خلاصه سفارش) نمایش داده می‌شود.'
                : 'علت باز شدن برای ثبت تاریخچه و ممیزی ذخیره می‌شود.'}
            </p>
            <textarea
              value={reason}
              onChange={(e) => { if (!submitting.current) setReason(e.target.value.slice(0, 120)) }}
              disabled={mutation.isPending}
              minLength={pendingClosed ? TEMPORARY_CLOSE_REASON_MIN_LENGTH : 3}
              maxLength={120}
              rows={3}
              autoFocus
              className="w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none text-gray-800 dark:text-white text-sm resize-none font-DanaMedium"
              placeholder={pendingClosed ? 'مثلاً: قطع موقت گاز — تا اطلاع بعدی' : 'مثلاً: وصل شد گاز، فعالیت برگشت'}
            />
            <p className="text-[10px] text-gray-400 mt-1 font-DanaMedium">
              {reason.trim().length}/۱۲۰ نویسه — حداقل {(pendingClosed ? TEMPORARY_CLOSE_REASON_MIN_LENGTH : 3).toLocaleString('fa-IR')} نویسه
            </p>

            {/* زمان باز شدن مجدد فقط برای اطلاع مدیران ثبت می‌شود. */}
            {pendingClosed && (
              <div className="mt-4">
                <label className="block text-xs font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">
                  ساعت باز شدن مجدد (اختیاری — یادداشت مدیریتی)
                </label>
                <input
                  type="text"
                  value={reopenTime}
                  onChange={(e) => { if (!submitting.current) setReopenTime(e.target.value.slice(0, 40)) }}
                  disabled={mutation.isPending}
                  className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none text-gray-800 dark:text-white text-sm"
                  placeholder='مثلاً: ۱۹:۰۰'
                />
                <p className="text-[10px] text-gray-400 mt-1 font-DanaMedium leading-relaxed">
                  این زمان برای اطلاع مدیران ثبت می‌شود؛ در چک‌اوت فقط علت بسته بودن نمایش داده می‌شود.
                </p>
              </div>
            )}

            {/* round-34 — علت عربی: فقط هنگام بستن؛ مشتری عربی‌زبان در چک‌اوت این را می‌بیند */}
            {pendingClosed && (
              <div className="mt-4">
                <ArField
                  key={session}
                  label="علت بسته بودن"
                  value={reasonAr}
                  onChange={(value) => {
                    if (modalSession.current === session && !submitting.current) setReasonAr(value.slice(0, 120))
                  }}
                  faSource={reason}
                  minLength={TEMPORARY_CLOSE_REASON_MIN_LENGTH}
                  maxLength={120}
                  multiline
                  rows={2}
                  disabled={mutation.isPending}
                  placeholder="خالی = نمایش همان علت فارسی به مشتری عربی‌زبان"
                />
                <p className="text-[10px] text-gray-400 mt-1 font-DanaMedium">
                  در صورت تکمیل، حداقل {TEMPORARY_CLOSE_REASON_MIN_LENGTH.toLocaleString('fa-IR')} نویسه بنویسید.
                </p>
              </div>
            )}
            {pendingClosed && (
              <div className="mt-4 p-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e]">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-DanaMedium text-gray-700 dark:text-gray-300">
                    غیرفعال کردن پرداخت سفارش‌ها
                  </span>
                  <Toggle
                    label="غیرفعال کردن پرداخت سفارش‌ها"
                    isOn={disablePayments}
                    onToggle={() => { if (!submitting.current) setDisablePayments((current) => !current) }}
                    disabled={mutation.isPending}
                  />
                </div>
                <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-2 leading-relaxed">
                  با روشن کردن این گزینه، پرداخت سفارش‌ها تا باز شدن مجدد یا غیرفعال کردن این گزینه متوقف می‌شود.
                </p>
              </div>
            )}
            <div className="flex gap-3 mt-4">
              <button
                type="button"
                onClick={handleCancel}
                disabled={mutation.isPending}
                className="flex-1 py-2.5 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 font-DanaMedium cursor-pointer"
              >
                انصراف
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={mutation.isPending}
                className={`flex-1 py-2.5 rounded-xl text-white font-DanaDemiBold cursor-pointer disabled:opacity-50 transition ${pendingClosed
                  ? 'bg-red-500 hover:bg-red-600'
                  : 'bg-green-500 hover:bg-green-600'
                  }`}
              >
                {mutation.isPending
                  ? 'در حال ثبت...'
                  : pendingClosed
                    ? (temporarilyClosed ? 'ذخیره تغییرات' : 'ثبت و بستن موقت')
                    : 'ثبت و باز شدن'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
})
