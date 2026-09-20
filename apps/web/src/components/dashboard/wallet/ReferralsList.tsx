// src/components/dashboard/wallet/ReferralsList.tsx
import { memo } from 'react'
import { Pagination } from '#/components/Pagination'
import { formatPrice, formatReferralId } from '#/utils/format'
import type { ReferralRow } from '#/types/dashboard/wallet'

interface ReferralsListProps {
  referrals: ReferralRow[]
  currentPage: number
  totalPages: number
  itemsPerPage: number
  onPageChange: (page: number) => void
  onItemsPerPageChange: (limit: number) => void
}

export const ReferralsList = memo(function ReferralsList({
  referrals, currentPage, totalPages, itemsPerPage, onPageChange, onItemsPerPageChange,
}: ReferralsListProps) {
  return (
    <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
      <h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-6 pb-4 border-b border-gray-100 dark:border-white/5">
        زیرمجموعه‌های من
      </h2>

      {referrals.length > 0 ? (
        <div className="space-y-3">
          {referrals.map((ref) => (
            <div
              key={ref.id}
              className="grid grid-cols-3 gap-4 p-4 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-100 dark:border-white/5 items-center text-center md:text-right"
            >
              <div>
                <p className="font-DanaDemiBold text-gray-800 dark:text-white text-sm" dir="ltr">
                  {formatReferralId(ref.registerDate, ref.phone)}
                </p>
              </div>
              <div className="md:text-center">
                <p className="text-xs text-gray-400 dark:text-gray-500 font-DanaMedium">سفارشات</p>
                <p className="font-DanaDemiBold text-gray-800 dark:text-white">
                  {ref.totalOrders.toLocaleString('fa-IR')}
                </p>
              </div>
              <div className="md:text-left">
                <p className="text-xs text-gray-400 dark:text-gray-500 font-DanaMedium">سود شما</p>
                <p className="font-DanaDemiBold text-green-500 text-sm">
                  {formatPrice(ref.myProfit)} <span className="text-xs">ت</span>
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8 bg-gray-50 dark:bg-[#1a0a0e] rounded-xl border border-dashed border-gray-300">
          <p className="text-sm text-gray-400 font-DanaMedium">کسی با کد شما ثبت‌نام نکرده است.</p>
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-4">
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            itemsPerPage={itemsPerPage}
            totalItems={referrals.length}
            onPageChange={onPageChange}
            onItemsPerPageChange={onItemsPerPageChange}
            pageSizeOptions={[5, 10]}
          />
        </div>
      )}
    </div>
  )
})