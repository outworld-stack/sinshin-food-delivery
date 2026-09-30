// src/components/site/checkout/PaymentSection.tsx
import { memo, useCallback } from 'react'
import { InfoCircle, Wallet } from 'reicon-react'
import { Toggle } from '#/components/shared/Toggle'
import type { DeliveryType } from '#/types/site/checkout'
import { useI18n, tpl } from '#/i18n'

const IS_DEV = import.meta.env.DEV

// رارد ۳۲ — نام درگاه‌ها از دیکشنری (checkout.gateway.*)؛ شناسه‌ها دست‌نخورده
const GATEWAY_IDS = IS_DEV ? ['MOCK'] : ['ZARINPAL', 'PAYIR', 'SEP']

interface PaymentSectionProps {
	useWallet: boolean
	walletBalance: number
	walletDeduction: number
	onToggleWallet: () => void
	selectedGateway: string
	onGatewayChange: (id: string) => void
	gatewaysDisabled: boolean
	amountPaidOnline: number
	deliveryType: DeliveryType
}

export const PaymentSection = memo(function PaymentSection({
	useWallet,
	walletBalance,
	walletDeduction,
	onToggleWallet,
	selectedGateway,
	onGatewayChange,
	gatewaysDisabled,
	amountPaidOnline,
	deliveryType,
}: PaymentSectionProps) {
	const { t, fmt } = useI18n()
	const hasBalance = walletBalance > 0

	const handleGateway = useCallback(
		(id: string) => onGatewayChange(id),
		[onGatewayChange],
	)

	const gatewayLabel = (id: string): string => {
		switch (id) {
			case 'MOCK': return t['checkout.gateway.MOCK']
			case 'ZARINPAL': return t['checkout.gateway.ZARINPAL']
			case 'PAYIR': return t['checkout.gateway.PAYIR']
			case 'SEP': return t['checkout.gateway.SEP']
			default: return id
		}
	}

	return (
		<div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
			<h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-6">
				{t['checkout.payTitle']}
			</h2>

			{/* آیتم ۱۱: سوییچ کسر از کیف پول — پیش‌فرض خاموش، هر مبلغی که هست */}
			<div
				className={`flex items-center justify-between p-4 rounded-xl border-2 mb-4 transition ${
					useWallet
						? 'border-primary dark:border-dark-primary bg-primary/5 dark:bg-dark-primary/5'
						: 'border-gray-200 dark:border-[#3a151c]'
				} ${!hasBalance ? 'opacity-60' : ''}`}
			>
				<div className="flex items-center gap-3">
					<span className="w-10 h-10 rounded-lg bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary flex items-center justify-center">
						<Wallet size={20} />
					</span>
					<div>
						<p className="font-DanaDemiBold text-gray-800 dark:text-white">
							{t['checkout.wallet']}
						</p>
						<p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
							{hasBalance
								? tpl(t['checkout.balance'], {
										n: `${fmt.price(walletBalance)} ${t['common.toman']}`,
									})
								: t['checkout.noBalance']}
						</p>
						{useWallet && hasBalance && (
							<p className="text-xs text-blue-500 font-DanaMedium mt-1">
								{tpl(t['checkout.walletShare'], {
									n: `${fmt.price(walletDeduction)} ${t['common.toman']}`,
								})}
							</p>
						)}
					</div>
				</div>
				<Toggle
					isOn={useWallet}
					onToggle={onToggleWallet}
					disabled={!hasBalance}
				/>
			</div>

			{/* آیتم ۸: نکته الزامی پرداخت پیک/بسته‌بندی با درگاه — stage-10: بسته‌بندی هم مثل ارسال */}
			{deliveryType !== 'DINE_IN' && (
				<div className="flex items-start gap-2 p-3 rounded-xl bg-yellow-50 dark:bg-yellow-500/10 border border-yellow-200 dark:border-yellow-500/20 mb-4">
					<InfoCircle size={18} className="text-yellow-500 shrink-0 mt-0.5" />
					<p className="text-xs text-yellow-600 dark:text-yellow-400 font-DanaMedium leading-relaxed">
						{deliveryType === 'DELIVERY'
							? t['checkout.gatewayNoteDelivery']
							: t['checkout.gatewayNotePickup']}
					</p>
				</div>
			)}

			{/* درگاه‌های بانکی */}
			<div
				className={`pr-4 border-r-2 border-gray-100 dark:border-white/5 space-y-3 transition ${gatewaysDisabled ? 'opacity-50 pointer-events-none' : ''}`}
			>
				<p className="text-sm font-DanaMedium text-gray-500 dark:text-gray-400 mb-2">
					{gatewaysDisabled
						? amountPaidOnline === 0
							? t['checkout.covered']
							: t['checkout.allFromWallet']
						: tpl(t['checkout.payViaGateway'], {
								n: `${fmt.price(amountPaidOnline)} ${t['common.toman']}`,
							})}
				</p>
				{GATEWAY_IDS.map((id) => (
					<label
						key={id}
						className="flex items-center gap-3 cursor-pointer p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-[#1a0a0e] transition"
					>
						<input
							type="radio"
							name="gateway"
							checked={selectedGateway === id}
							onChange={() => handleGateway(id)}
							disabled={gatewaysDisabled}
							className="w-4 h-4 accent-primary dark:accent-dark-primary"
						/>
						<span className="font-DanaMedium text-gray-600 dark:text-gray-300">
							{gatewayLabel(id)}
						</span>
					</label>
				))}
			</div>
		</div>
	)
})
