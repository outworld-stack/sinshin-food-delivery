// src/components/admin/settings/TemporaryCloseCard.tsx
// round-13 — باز/بسته کردن موقت رستوران با «علت اجباری»:
//  • ادمین اصلی: همیشه
//  • ادمین۲: با پرمیشن canToggleTemporaryClose (سمت سرور هم گارد دارد)
// علت برای بستن «و» باز کردن پرسیده می‌شود و به مشتری در باکس خلاصه سفارش
// (صفحه چک‌اوت) نمایش داده می‌شود.
import { memo, useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { setTemporaryClose } from '#/server/admin'
import { settingsRestaurantStatusOptions } from '#/utils/queryOptions'
import { qk } from '#/utils/queryKeys'
import { useToastStore } from '#/stores/toastStore'
import { Toggle } from '#/components/shared/Toggle'
import { StopwatchOff, StopwatchPlay, Discover2 } from 'reicon-react'

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

  const mutation = useMutation({
    mutationFn: (input: { closed: boolean; reason: string }) => setTemporaryClose({ data: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.settingsRestaurantStatus })
      // چک‌اوت همیشه وضعیت تازه ببیند
      queryClient.invalidateQueries({ queryKey: qk.restaurantStatus })
      setPendingClosed(null)
      setReason('')
      showToast('وضعیت موقت رستوران ثبت شد')
    },
    onError: (err) => {
      showToast(err instanceof Error ? err.message : 'ثبت وضعیت ناموفق بود', 'error')
    },
  })

  const handleToggle = useCallback(() => {
    if (!status) return
    // جهت مخالف فعلی — با کادر علت
    setPendingClosed(!status.temporarilyClosed)
    setReason('')
  }, [status])

  const handleCancel = useCallback(() => {
    setPendingClosed(null)
    setReason('')
  }, [])

  const handleConfirm = useCallback(() => {
    if (pendingClosed === null) return
    const trimmed = reason.trim()
    if (trimmed.length < 3) {
      showToast('علت را بنویسید (حداقل ۳ نویسه)', 'error')
      return
    }
    mutation.mutate({ closed: pendingClosed, reason: trimmed })
  }, [pendingClosed, reason, mutation, showToast])

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
              بسته/باز موقت (قطعی گاز/برق و…) — ثبت آن با ذکر علت الزامی است و علت به
              مشتری در صفحه چک‌اوت نشان داده می‌شود.
            </p>
          </div>
        </div>
        <Toggle isOn={!temporarilyClosed} onToggle={handleToggle} />
      </div>

      {/* علت فعلی بسته‌بودن */}
      {temporarilyClosed && status?.temporaryCloseReason && (
        <div className="mt-4 p-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20">
          <p className="text-xs text-red-600 dark:text-red-400 font-DanaMedium leading-relaxed">
            <span className="font-DanaDemiBold">علت فعلی: </span>
            {status.temporaryCloseReason}
          </p>
        </div>
      )}

      <div className="mt-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 flex items-start gap-2">
        <Discover2 size={16} className="text-amber-500 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-600 dark:text-amber-400 font-DanaMedium leading-relaxed">
          سفارش‌دهی در حالت بسته هم ممکن است؛ سفارش‌ها در صف می‌مانند و بلافاصله بعد
          از باز شدن تایید/ارسال می‌شوند. ساعات کاری روزانه جداست (کارت بالا فقط
          برای ادمین اصلی).
        </p>
      </div>

      {/* کادر علت — مدال سبک، بدون بستن با کلیک پس‌زمینه (علت اجباری است) */}
      {pendingClosed !== null && (
        <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="relative bg-white dark:bg-[#2a1015] p-6 rounded-2xl shadow-xl w-full max-w-md">
            <h3 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-1">
              {pendingClosed ? 'اعلام بسته موقت' : 'اعلام باز شدن'}
            </h3>
            <p className="text-xs text-gray-400 font-DanaMedium mb-5 leading-relaxed">
              {pendingClosed
                ? 'این علت به مشتریان در صفحه چک‌اوت (باکس خلاصه سفارش) نمایش داده می‌شود.'
                : 'علت باز شدن برای ثبت تاریخچه و ممیزی ذخیره می‌شود.'}
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 120))}
              rows={3}
              autoFocus
              className="w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none text-gray-800 dark:text-white text-sm resize-none font-DanaMedium"
              placeholder={pendingClosed ? 'مثلاً: قطع موقت گاز — تا اطلاع بعدی' : 'مثلاً: وصل شد گاز، فعالیت برگشت'}
            />
            <p className="text-[10px] text-gray-400 mt-1 font-DanaMedium">
              {reason.length}/۱۲۰ نویسه — حداقل ۳ نویسه
            </p>
            <div className="flex gap-3 mt-4">
              <button
                type="button"
                onClick={handleCancel}
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
                    ? 'ثبت و بستن موقت'
                    : 'ثبت و باز شدن'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
})
