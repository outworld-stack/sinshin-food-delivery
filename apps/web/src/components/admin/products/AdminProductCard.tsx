// src/components/admin/products/AdminProductCard.tsx
// round-13 — ستون عکس حذف شد (درخواست صریح): زیر «محصول» نام محصول،
// زیر «دسته‌بندی» دسته‌بندی. عکس فقط در فرم/جزئیات دیده می‌شود.
// stage-48 — دکمه‌ی موجود/ناموجود سریع (مجوز productsAvailability) +
// بج وضعیتِ فروش در کنار وضعیت منو.
//
// stage-54 — رفع باگ دکمه‌ی موجود/ناموجود سریع:
//   قبلاً onClick مقدار «وضعیت فعلی» را می‌فرستاد (!unavailable برای کالای
//   موجود یعنی available:true) ⇒ سرور «از قبل همین است» می‌داد و هیچ چیز
//   عوض نمی‌شد — ولی توستِ ساخته‌شده از پراپِ کهنه، «ناموجود شد» را نشان
//   می‌داد (توستِ کذب). حالا «معکوسِ وضعیت فعلی» فرستاده می‌شود و پیامِ
//   سرور (مثل «از قبل ناموجود است») بر توست محلی اولویت دارد.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { memo, useCallback } from 'react'
import { Ban, BoxRemove, Check, Package, Pen } from 'reicon-react'
import { Can } from '#/components/shared/PermissionGate'
import { setProductAvailability } from '#/server/products'
import { useToastStore } from '#/stores/toastStore'
import { formatPrice } from '#/utils/format'
import { qk } from '#/utils/queryKeys'

interface AdminProductCardProps {
	product: {
		id: string
		name: string
		prepTime: number
		finalPrice: number
		status: string
		categoryId: string
		/** stage-48 — موجودی فروش (نیامد = موجود) */
		isAvailable?: boolean
	}
	categoryName: string | undefined
	canWrite: boolean
	/** stage-48 — اجازه‌ی موجود/ناموجود کردن (ادمین اصلی یا productsAvailability) */
	canToggleAvailability: boolean
	onToggle: (id: string, status: string) => void
}

// کارت محصول ادمین — دسکتاپ تک‌ردیف + موبایل، اکشن‌ها فقط با write
export const AdminProductCard = memo(function AdminProductCard({
	product,
	categoryName,
	canWrite,
	canToggleAvailability,
	onToggle,
}: AdminProductCardProps) {
	const queryClient = useQueryClient()
	const showToast = useToastStore((s) => s.showToast)

	const handleToggle = useCallback(
		() => onToggle(product.id, product.status),
		[onToggle, product.id, product.status],
	)

	// stage-48 — موجود/ناموجود سریع + نامعتبرسازی کش‌های وابسته (منو/سبد/چک‌اوت)
	const availabilityMut = useMutation({
		mutationFn: (available: boolean) =>
			setProductAvailability({ data: { id: product.id, available } }),
		onSuccess: (res, available) => {
			if (!res.success) {
				showToast(res.message ?? 'خطا', 'error')
				return
			}
			queryClient.invalidateQueries({ queryKey: qk.adminProductsAll })
			queryClient.invalidateQueries({ queryKey: qk.productsByMainPrefix })
			queryClient.invalidateQueries({ queryKey: qk.productByIdAll })
			queryClient.invalidateQueries({ queryKey: qk.cartDetailsAll })
			queryClient.invalidateQueries({ queryKey: qk.checkoutPreviewPrefix })
			// stage-54 — available (آرگومان دوم onSuccess) = همان مقداری که خودِ
			// میوتیشن فرستاده — نه پراپِ کهنه؛ پیام سرور (نو-آپ) هم بر توست مقدم است.
			showToast(
				res.message ??
					(available ? 'محصول موجود شد' : 'محصول فعلاً ناموجود شد'),
			)
		},
		onError: () => showToast('تغییر موجودی ناموفق بود', 'error'),
	})

	const unavailable = product.isAvailable === false

	const availabilityButton = canToggleAvailability ? (
		<button
			// stage-54 — مقدارِ «هدف» فرستاده می‌شود (معکوسِ وضعیت فعلی):
			//   موجود + «ناموجود کردن»  ⇒ available=false
			//   ناموجود + «موجود کردن»    ⇒ available=true
			// قبلاً !unavailable فرستاده می‌شد که برای کالای موجود یعنی
			// available:true ⇒ نو-آپِ بی‌اثر روی سرور.
			onClick={() => availabilityMut.mutate(!product.isAvailable)}
			disabled={availabilityMut.isPending}
			title={unavailable ? 'موجود کردن' : 'ناموجود کردن (فعلاً از فروش خارج)'}
			className={`p-2 rounded-lg transition cursor-pointer disabled:opacity-50 ${
				unavailable
					? 'text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-500/10'
					: 'text-green-500 hover:bg-green-50 dark:hover:bg-green-500/10'
			}`}
		>
			{unavailable ? <BoxRemove size={18} /> : <Package size={18} />}
		</button>
	) : null

	// stage-48 — بج موجودی فروش (جدا از وضعیت منو)
	const availabilityBadge = (
		<span
			className={`text-[10px] font-DanaDemiBold px-2 py-0.5 rounded-full ${
				unavailable
					? 'bg-orange-100 text-orange-600 dark:bg-orange-500/10 dark:text-orange-400'
					: 'hidden'
			}`}
		>
			فعلاً ناموجود
		</span>
	)

	return (
		<div className="border border-gray-300 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] p-4">
			{/* موبایل */}
			<div className="lg:hidden flex items-center gap-4">
				<div className="flex-1 min-w-0">
					<p className="font-DanaDemiBold text-gray-800 dark:text-white text-sm">
						{product.name}
					</p>
					<p className="text-xs text-gray-400 mt-1">
						{categoryName} | {product.prepTime} دقیقه
					</p>
					<div className="flex items-center gap-1.5 mt-1">
						<span className="text-sm font-DanaDemiBold text-primary dark:text-dark-primary">
							{formatPrice(product.finalPrice)} ت
						</span>
						{availabilityBadge}
					</div>
				</div>
				<div className="flex flex-col gap-2">
					<Can allowed={canWrite}>
						<Link
							to="/admin/products/$productId/edit"
							params={{ productId: product.id }}
							className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-[#2a1015] transition cursor-pointer"
						>
							<Pen size={18} />
						</Link>
						<button
							onClick={handleToggle}
							className={`p-2 rounded-lg transition cursor-pointer ${product.status === 'ACTIVE' ? 'text-red-400' : 'text-green-400'}`}
						>
							{product.status === 'ACTIVE' ? (
								<Ban size={18} />
							) : (
								<Check size={18} />
							)}
						</button>
					</Can>
					{availabilityButton}
				</div>
			</div>

			{/* دسکتاپ */}
			<div className="hidden lg:grid lg:grid-cols-5 gap-4 items-center text-right">
				<div className="flex flex-col">
					<p className="font-DanaDemiBold text-gray-800 dark:text-white text-sm">
						{product.name}
					</p>
					<p className="text-xs text-gray-400">{product.prepTime} دقیقه</p>
				</div>
				<div className="font-DanaMedium text-gray-600 dark:text-gray-300 text-sm">
					{categoryName || '-'}
				</div>
				<div className="font-DanaDemiBold text-gray-900 dark:text-white text-sm">
					{formatPrice(product.finalPrice)} ت
				</div>
				<div className="flex flex-col gap-1 items-start">
					<span
						className={`text-xs font-DanaDemiBold px-2 py-1 rounded-full ${product.status === 'ACTIVE' ? 'bg-green-100 text-green-600 dark:bg-green-500/10 dark:text-green-400' : 'bg-gray-200 text-gray-600 dark:bg-gray-500/10 dark:text-gray-400'}`}
					>
						{product.status === 'ACTIVE' ? 'فعال' : 'غیرفعال'}
					</span>
					{availabilityBadge}
				</div>
				<div className="flex items-center justify-end gap-2">
					<Can allowed={canWrite}>
						<Link
							to="/admin/products/$productId/edit"
							params={{ productId: product.id }}
							className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-[#2a1015] transition cursor-pointer"
							title="ویرایش"
						>
							<Pen size={18} />
						</Link>
						<button
							onClick={handleToggle}
							className={`p-2 rounded-lg transition cursor-pointer ${product.status === 'ACTIVE' ? 'text-red-400' : 'text-green-400'}`}
							title={product.status === 'ACTIVE' ? 'غیرفعال' : 'فعال'}
						>
							{product.status === 'ACTIVE' ? (
								<Ban size={18} />
							) : (
								<Check size={18} />
							)}
						</button>
					</Can>
					{availabilityButton}
				</div>
			</div>
		</div>
	)
})