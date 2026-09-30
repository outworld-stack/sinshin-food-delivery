// src/components/dashboard/order-detail/ReferralProfitBox.tsx
import { memo } from 'react'
import { useI18n } from '#/i18n'

interface ReferralProfitBoxProps {
  profit: number
  hasReferrer: boolean
}

export const ReferralProfitBox = memo(function ReferralProfitBox({ profit, hasReferrer }: ReferralProfitBoxProps) {
  const { t, fmt } = useI18n()
  return (
    <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
      <h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-6 pb-4 border-b border-gray-100 dark:border-white/5">
        {t['dash.orderDetail.referralProfit']}
      </h2>

      {hasReferrer ? (
        <div className="p-4 rounded-xl bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20">
          <p className="text-sm text-gray-600 dark:text-gray-300 font-DanaMedium mb-2">
            {t['dash.orderDetail.referralProfitDesc']}
          </p>
          <p className="font-MorabbaBold text-2xl text-green-600 dark:text-green-400">
            {fmt.price(profit)} <span className="text-sm font-DanaMedium">{t['common.toman']}</span>
          </p>
          <p className="text-[11px] text-gray-400 mt-3 leading-relaxed">
            {t['dash.orderDetail.referralProfitNote']}
          </p>
        </div>
      ) : (
        <div className="p-4 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-dashed border-gray-300 dark:border-white/5 text-center">
          <p className="text-sm text-gray-400 dark:text-gray-500 font-DanaMedium">{t['dash.common.noReferrer']}</p>
        </div>
      )}
    </div>
  )
})