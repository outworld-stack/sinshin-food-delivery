// ═══════════════════════════════════════════════════════════════
// stage-86 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/components/admin/products/CategoryPurchaseManager.tsx (فایل جدید)
// کارتِ «فعال‌سازی خرید دسته‌بندی‌ها» در صفحه‌ی محصولات پنل ادمین.
//
// قرارداد (درخواستِ صریحِ کارفرما):
//  · هر دسته‌ی والد و هر زیردسته‌ی آن، مستقلاً قابلِ «غیرفعال کردن» است.
//  · غیرفعال = محصولات در سایت می‌مانند ولی «افزودن به سبد خرید» در کارتِ
//    محصول و صفحه‌ی مخصوصِ محصول، غیرقابل کلیک و غیرفعال می‌شود (سبد و
//    چک‌اوت هم گارد سروری دارند).
//  · جداست از toggle روشن/خاموشِ «نمایش تب» (isActive در مدیرِ دسته‌های اصلی).
//  · گارد بک: خواندن productsRead؛ تغییر productsWrite — پس ادمین سطح ۲
//    با مجوز «دسترسی و ویرایش محصولات» هم می‌تواند (ادمین اصلی همیشه).
//  · مؤثرِ هر محصول = پرچمِ دسته‌ی اولیه AND پرچمِ والدِ اولیه.
// ═══════════════════════════════════════════════════════════════

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { memo, useCallback } from 'react'
import { BagShopping, ChevronDown, Lock, LockOpen } from 'reicon-react'
import { Toggle } from '#/components/shared/Toggle'
import {
	setCategoryPurchaseState,
	setMainPurchaseState,
} from '#/server/products'
import { useToastStore } from '#/stores/toastStore'
import { qk } from '#/utils/queryKeys'
import { adminPurchaseStateOptions } from '#/utils/queryOptions'

interface CategoryPurchaseManagerProps {
	/** ادمین۲ بدون productsWrite فقط می‌بیند (سوئیچ‌ها قفل) */
	canWrite: boolean
}

export const CategoryPurchaseManager = memo(function CategoryPurchaseManager({
	canWrite,
}: CategoryPurchaseManagerProps) {
	const queryClient = useQueryClient()
	const showToast = useToastStore((s) => s.showToast)
	const { data: state, isLoading } = useQuery(adminPurchaseStateOptions)

	// تغییرِ خریدِ دسته، همه‌ی لایه‌های وابسته را تازه می‌کند: لیست منوها،
	// صفحه‌ی جزئیات، کش دسته‌ها و سبد/چک‌اوتِ باز (مثل ویرایشِ دسته از قبل)
	const invalidateAll = useCallback(() => {
		queryClient.invalidateQueries({ queryKey: qk.adminPurchaseState })
		queryClient.invalidateQueries({ queryKey: qk.categories })
		queryClient.invalidateQueries({ queryKey: qk.productsByMainPrefix })
		queryClient.invalidateQueries({ queryKey: qk.productByIdAll })
		queryClient.invalidateQueries({ queryKey: qk.cartDetailsAll })
		queryClient.invalidateQueries({ queryKey: qk.checkoutPreviewPrefix })
	}, [queryClient])

	const mainMutation = useMutation({
		mutationFn: (data: { id: string; purchaseEnabled: boolean }) =>
			setMainPurchaseState({ data }),
		onSuccess: (res) => {
			if (!res.success) {
				showToast(res.message ?? 'خطا', 'error')
				return
			}
			invalidateAll()
			showToast('وضعیت خرید دسته‌ی اصلی تغییر کرد')
		},
		onError: (err: Error) =>
			showToast(err.message || 'تغییر وضعیت ناموفق بود', 'error'),
	})

	const categoryMutation = useMutation({
		mutationFn: (data: { id: string; purchaseEnabled: boolean }) =>
			setCategoryPurchaseState({ data }),
		onSuccess: (res) => {
			if (!res.success) {
				showToast(res.message ?? 'خطا', 'error')
				return
			}
			invalidateAll()
			showToast('وضعیت خرید دسته‌بندی تغییر کرد')
		},
		onError: (err: Error) =>
			showToast(err.message || 'تغییر وضعیت ناموفق بود', 'error'),
	})

	const handleMainToggle = useCallback(
		(id: string, purchaseEnabled: boolean) => {
			if (!canWrite) return
			mainMutation.mutate({ id, purchaseEnabled })
		},
		[canWrite, mainMutation],
	)

	const handleCategoryToggle = useCallback(
		(id: string, purchaseEnabled: boolean) => {
			if (!canWrite) return
			categoryMutation.mutate({ id, purchaseEnabled })
		},
		[canWrite, categoryMutation],
	)

	const mains = state?.mains ?? []
	const categories = state?.categories ?? []

	// زیردسته‌ها گروه‌بندیِ والدِ اولیه (زنجیره‌ی مؤثرِ خرید)
	const catsByMain = new Map<string, typeof categories>()
	for (const cat of categories) {
		const list = catsByMain.get(cat.mainCategoryId) ?? []
		list.push(cat)
		catsByMain.set(cat.mainCategoryId, list)
	}

	return (
		<div className="w-full bg-white dark:bg-[#2a1015] p-4 sm:p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm h-fit">
			<div className="flex items-center justify-between gap-3 mb-2">
				<h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white flex items-center gap-2">
					<BagShopping
						size={20}
						className="text-primary dark:text-dark-primary"
					/>
					فعال‌سازی خرید دسته‌بندی‌ها
				</h2>
			</div>
			<p className="text-xs text-gray-400 mb-6 font-DanaMedium leading-relaxed">
				غیرفعال‌کردنِ خرید = محصولاتِ آن دسته در سایت می‌مانند ولی دکمه‌ی «افزودن به
				سبد خرید» قفل می‌شود (کارت محصول + صفحه‌ی محصول + سبد خرید و چک‌اوت). جدا
				از «نمایش/پنهان‌شدن تب» در مدیرِ دسته‌های اصلی است.
				{!canWrite && ' (شما فقط دسترسی مشاهده دارید)'}
			</p>

			{isLoading ? (
				<div className="text-center py-8 text-gray-400 font-DanaMedium text-sm">
					در حال بارگذاری...
				</div>
			) : mains.length > 0 ? (
				<div className="space-y-4">
					{mains.map((main) => {
						const children = catsByMain.get(main.id) ?? []
						return (
							<div
								key={main.id}
								className="rounded-xl border border-gray-100 dark:border-white/5 overflow-hidden"
							>
								{/* ردیف والد — سوئیچ خرید */}
								<div className="flex items-center justify-between gap-3 p-3 bg-gray-50 dark:bg-[#1a0a0e]">
									<div className="flex items-center gap-2 min-w-0">
										<span
											className={`p-1.5 rounded-lg shrink-0 ${
												main.purchaseEnabled
													? 'bg-green-100 dark:bg-green-500/10 text-green-600 dark:text-green-400'
													: 'bg-orange-100 dark:bg-orange-500/10 text-orange-500'
											}`}
										>
											{main.purchaseEnabled ? (
												<LockOpen size={14} />
											) : (
												<Lock size={14} />
											)}
										</span>
										<div className="min-w-0">
											<p className="text-sm font-DanaDemiBold text-gray-800 dark:text-white truncate">
												{main.name}
												<span
													className="text-[10px] text-gray-400 font-DanaMedium mr-2"
													dir="ltr"
												>
													/{main.slug}
												</span>
											</p>
											<p
												className={`text-[10px] mt-0.5 font-DanaMedium ${main.purchaseEnabled ? 'text-green-500' : 'text-orange-500'}`}
											>
												{main.purchaseEnabled
													? `خرید فعال — ${children.length} زیردسته`
													: 'خرید غیرفعال — دکمه‌ی سبدِ همه‌ی محصولاتِ این والد قفل است'}
											</p>
										</div>
									</div>
									<Toggle
										isOn={main.purchaseEnabled}
										onToggle={() =>
											handleMainToggle(main.id, !main.purchaseEnabled)
										}
										disabled={!canWrite || mainMutation.isPending}
										label={`${main.name} — امکان خرید`}
									/>
								</div>

								{/* زیردسته‌های این والد */}
								{children.length > 0 && (
									<div className="divide-y divide-gray-100 dark:divide-white/5 border-t border-gray-100 dark:border-white/5">
										{children.map((cat) => (
											<div
												key={cat.id}
												className="flex items-center justify-between gap-3 px-3 sm:px-6 py-2.5 bg-white dark:bg-[#2a1015]"
											>
												<div className="flex items-center gap-2 min-w-0">
													<ChevronDown
														size={12}
														className="text-gray-300 dark:text-gray-600 shrink-0 -rotate-90"
													/>
													<p className="text-sm font-DanaMedium text-gray-700 dark:text-gray-300 truncate">
														{cat.name}
													</p>
													{!cat.purchaseEnabled && (
														<span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-500/10 text-orange-600 dark:text-orange-400 font-DanaDemiBold shrink-0">
															خرید غیرفعال
														</span>
													)}
												</div>
												<Toggle
													isOn={cat.purchaseEnabled}
													onToggle={() =>
														handleCategoryToggle(cat.id, !cat.purchaseEnabled)
													}
													disabled={!canWrite || categoryMutation.isPending}
													label={`${cat.name} — امکان خرید`}
												/>
											</div>
										))}
									</div>
								)}
							</div>
						)
					})}
				</div>
			) : (
				<div className="text-center py-8 text-gray-400 font-DanaMedium text-sm">
					دسته‌بندی‌ای ثبت نشده است
				</div>
			)}
		</div>
	)
})
