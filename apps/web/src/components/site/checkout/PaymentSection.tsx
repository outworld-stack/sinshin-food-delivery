// src/components/site/checkout/PaymentSection.tsx
import { memo, useCallback } from 'react'
import { InfoCircle, Wallet } from 'reicon-react'
import { Toggle } from '#/components/shared/Toggle'
import type { DeliveryType } from '#/types/site/checkout'
import { formatPrice } from '#/utils/format'

const IS_DEV = import.meta.env.DEV

const GATEWAYS = IS_DEV
	? [{ id: 'MOCK', name: 'درگاه تست (دمو)' }]
	: [
			{ id: 'ZARINPAL', name: 'زرین‌پال' },
			{ id: 'PAYIR', name: 'پی‌ایر' },
			{ id: 'SEP', name: 'بانک سامان' },
		]

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
	const hasBalance = walletBalance > 0

	const handleGateway = useCallback(
		(id: string) => onGatewayChange(id),
		[onGatewayChange],
	)

	return (
		<div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
			<h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-6">
				روش پرداخت
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
							کسر از کیف پول
						</p>
						<p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
							{hasBalance
								? `موجودی: ${formatPrice(walletBalance)} تومان`
								: 'موجودی کیف پول ندارید'}
						</p>
						{useWallet && hasBalance && (
							<p className="text-xs text-blue-500 font-DanaMedium mt-1">
								{formatPrice(walletDeduction)} تومان از مبلغ غذاها کسر می‌شود
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
							? 'هزینه ارسال و بسته‌بندی باید با درگاه پرداخت شود و امکان کسر آن از موجودی کیف پول وجود ندارد.'
							: 'هزینه بسته‌بندی باید با درگاه پرداخت شود و امکان کسر آن از موجودی کیف پول وجود ندارد.'}
					</p>
				</div>
			)}

			{/* درگاه‌های بانکی */}
			<div
				className={`pr-4 border-r-2 border-gray-100 dark:border-white/5 space-y-3 transition ${gatewaysDisabled ? 'opacity-50 pointer-events-none' : ''}`}
			>
				<p className="text-sm font-DanaMedium text-gray-500 dark:text-gray-400 mb-2">
					{gatewaysDisabled
						? 'کل مبلغ از کیف پول شما کسر می‌شود:'
						: `پرداخت ${formatPrice(amountPaidOnline)} تومان از درگاه بانکی:`}
				</p>
				{GATEWAYS.map((gw) => (
					<label
						key={gw.id}
						className="flex items-center gap-3 cursor-pointer p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-[#1a0a0e] transition"
					>
						<input
							type="radio"
							name="gateway"
							checked={selectedGateway === gw.id}
							onChange={() => handleGateway(gw.id)}
							disabled={gatewaysDisabled}
							className="w-4 h-4 accent-primary dark:accent-dark-primary"
						/>
						<span className="font-DanaMedium text-gray-600 dark:text-gray-300">
							{gw.name}
						</span>
					</label>
				))}
			</div>
		</div>
	)
})
