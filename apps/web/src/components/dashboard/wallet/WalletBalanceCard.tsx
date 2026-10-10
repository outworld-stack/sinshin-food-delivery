// ═══════════════════════════════════════════════════════════════
// stage-55 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/components/dashboard/wallet/WalletBalanceCard.tsx
// وضعیت: ویرایش فایل موجود (یک تغییر نقطه‌ای)
// تغییر: reveal کیف پول هنگام ورود (reveal-up — CSS-only)
// ═══════════════════════════════════════════════════════════════

// src/components/dashboard/wallet/WalletBalanceCard.tsx
import { memo } from 'react'
import { Wallet, InfoCircle  } from 'reicon-react'
import { useI18n } from '#/i18n'

interface WalletBalanceCardProps {
  balance: number
}

// آیتم ۱۲: هیچ راهی برای شارژ کیف پول از درگاه وجود ندارد
// کیف پول فقط از طریق سود معرفی دوستان شارژ می‌شود
export const WalletBalanceCard = memo(function WalletBalanceCard({ balance }: WalletBalanceCardProps) {
  const { t, fmt } = useI18n()
  // stage-55 — reveal کیف پول (CSS-only)
  return (
    <div className="animate-reveal-up bg-linear-to-br from-primary to-dark-primary p-8 rounded-3xl shadow-lg text-white">
      <div className="flex items-center justify-between mb-2">
        <p className="font-DanaMedium text-white/80 flex items-center gap-2">
          <Wallet size={18} />
          {t['dash.wallet.currentBalance']}
        </p>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="font-MorabbaBold text-5xl">{fmt.price(balance)}</span>
        <span className="font-DanaMedium text-xl">{t['common.toman']}</span>
      </div>

      <div className="mt-6 pt-4 border-t border-white/20">
        <p className="text-xs text-white/70 font-DanaMedium flex items-start gap-1.5 leading-relaxed">
          <InfoCircle  size={14} className="shrink-0 mt-0.5" />
          {t['dash.wallet.chargeNote']}
        </p>
      </div>
    </div>
  )
})