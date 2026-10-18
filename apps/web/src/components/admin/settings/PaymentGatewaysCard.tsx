// ═══════════════════════════════════════════════════════════════
// stage-84 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/components/admin/settings/PaymentGatewaysCard.tsx (فایل جدید)
// سوئیچ فعال/غیرفعالِ درگاه‌های پرداخت — فقط ادمین اصلی.
// «فعال» = نمایشِ درگاه در چک‌اوت (پرداختِ در جریانِ درگاهِ غیرفعال‌شده
// هرگز قطع نمی‌شود — callbackها روی روتِ خودشان می‌مانند).
// ═══════════════════════════════════════════════════════════════

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
// src/components/admin/settings/PaymentGatewaysCard.tsx
import { memo } from 'react'
import { Banknote } from 'reicon-react'
import { Toggle } from '#/components/shared/Toggle'
import type { PaymentGateways } from '#/server/admin'
import { setPaymentGateways } from '#/server/admin'
import { useToastStore } from '#/stores/toastStore'
import { qk } from '#/utils/queryKeys'
import { settingsGatewaysOptions } from '#/utils/queryOptions'

interface PaymentGatewaysCardProps {
	/** کارت فقط برای ادمین اصلی رندر می‌شود (روت ownerOnly) */
	visible: boolean
}

const GATEWAYS: { key: keyof PaymentGateways; label: string; hint: string }[] =
	[
		{ key: 'zarinpal', label: 'زرین‌پال', hint: 'درگاه مستقیم' },
		{ key: 'sep', label: 'سامان (SEP)', hint: 'درگاه مستقیم' },
		{ key: 'mellat', label: 'ملت', hint: 'درگاه مستقیم' },
	]

export const PaymentGatewaysCard = memo(function PaymentGatewaysCard({
	visible,
}: PaymentGatewaysCardProps) {
	const queryClient = useQueryClient()
	const showToast = useToastStore((s) => s.showToast)
	const { data: gateways } = useQuery({
		...settingsGatewaysOptions,
		enabled: visible,
	})

	const mutation = useMutation({
		mutationFn: (data: PaymentGateways) => setPaymentGateways({ data }),
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: qk.settingsGateways }),
				queryClient.invalidateQueries({ queryKey: qk.checkoutPreviewPrefix }),
			])
			showToast('درگاه‌های پرداخت ذخیره شد')
		},
		onError: (err: Error) =>
			showToast(err.message || 'ذخیره ناموفق بود', 'error'),
	})

	if (!visible) return null

	// ترمیم اسکنِ استیج-۸۴ — تا لحظه‌ی رسیدنِ وضعیتِ ذخیره‌شده، توگل‌ها قفل‌اند:
	// کلیکِ زودهنگام با پیش‌فرضِ «همه فعال» مقدارِ persist شدهٔ بقیهٔ درگاه‌ها
	// را بی‌صدا بازنویسی می‌کرد
	const gatewaysLoading = gateways === undefined
	const current: PaymentGateways = gateways ?? {
		mellat: true,
		zarinpal: true,
		sep: true,
	}

	const handleToggle = (key: keyof PaymentGateways) => {
		if (gatewaysLoading || mutation.isPending) return
		const next = { ...current, [key]: !current[key] }
		mutation.mutate(next)
	}

	return (
		<div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
			<h2 className="font-DanaDemiBold text-lg text-gray-800 dark:text-white mb-1 flex items-center gap-2">
				<Banknote size={20} className="text-primary dark:text-dark-primary" />
				درگاه‌های پرداخت
			</h2>
			<p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed mb-4">
				درگاهِ فعال به مشتری در چک‌اوت نمایش داده می‌شود. سفارش‌های در حال پرداختِ
				درگاهِ غیرفعال‌شده به‌طور طبیعی تکمیل می‌شوند.
			</p>
			<div className="space-y-2.5">
				{GATEWAYS.map(({ key, label, hint }) => (
					<div
						key={key}
						className="flex items-center justify-between gap-3 p-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-100 dark:border-[#3a151c]"
					>
						<div className="min-w-0">
							<p className="font-DanaDemiBold text-sm text-gray-800 dark:text-white">
								{label}
							</p>
							<p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
								{hint}
							</p>
						</div>
						<Toggle
							isOn={current[key]}
							onToggle={() => handleToggle(key)}
							disabled={gatewaysLoading || mutation.isPending}
							label={`فعال بودن درگاه ${label}`}
						/>
					</div>
				))}
			</div>
		</div>
	)
})
