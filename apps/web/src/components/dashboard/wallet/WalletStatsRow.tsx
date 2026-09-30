// src/components/dashboard/wallet/WalletStatsRow.tsx
import { memo } from 'react'
import { Wallet, Users } from 'reicon-react'
import { useI18n } from '#/i18n'
import type { WalletStats } from '#/types/dashboard/wallet'

interface WalletStatsRowProps {
  stats: WalletStats
}

export const WalletStatsRow = memo(function WalletStatsRow({ stats }: WalletStatsRowProps) {
  const { t, fmt } = useI18n()
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div className="bg-white dark:bg-[#2a1015] p-5 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400 font-DanaMedium mb-1">{t['dash.wallet.totalInviteProfit']}</p>
          <p className="font-MorabbaBold text-2xl text-green-500">
            {fmt.price(stats.totalReferralProfit)} <span className="text-sm font-DanaMedium">{t['common.toman']}</span>
          </p>
        </div>
        <span className="w-10 h-10 rounded-lg bg-green-100 dark:bg-green-500/10 text-green-500 flex items-center justify-center">
          <Wallet size={20} />
        </span>
      </div>

      <div className="bg-white dark:bg-[#2a1015] p-5 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400 font-DanaMedium mb-1">{t['dash.wallet.referralsCount']}</p>
          <p className="font-MorabbaBold text-2xl text-gray-800 dark:text-white">
            {fmt.num(stats.referralsCount)}
          </p>
        </div>
        <span className="w-10 h-10 rounded-lg bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary flex items-center justify-center">
          <Users size={20} />
        </span>
      </div>
    </div>
  )
})