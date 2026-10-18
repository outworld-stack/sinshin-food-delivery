// ═══════════════════════════════════════════════════════════════
// stage-84 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/components/admin/products/PackagingItemsManager.tsx (فایل جدید)
// کارتِ مدیریتِ «اقلام بسته‌بندی با قیمت سراسری» در صفحه‌ی محصولات ادمین.
//
// قرارداد:
//  · قیمتِ هر قلم «سراسری» است — یک‌بار تعیین می‌شود و روی همه‌ی
//    محصولاتی که آن قلم را دارند اعمال می‌شود (جمعِ لحظه‌ای در چک‌اوت).
//  · غیرفعال‌کردن قلم = حذفِ سهمش از جمع (بدون حذف لینک محصولات).
//  · حذف قلم = cascade لینک‌ها؛ محصولاتِ بی‌قلم به «هزینه دستی» برمی‌گردند.
//  · گارد بک: ادمین اصلی همیشه؛ ادمین۲ با canEditPackagingFee.
//  · فرم‌های ادمین فارسی hardcode (الگوی پروژه) + ConfirmModal برای حذف.
// ═══════════════════════════════════════════════════════════════

import type { PackagingItemDto } from '@sinshin/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
// src/components/admin/products/PackagingItemsManager.tsx
import { memo, useState } from 'react'
import { Box, Plus, Trash2 } from 'reicon-react'
import { ConfirmModal } from '#/components/ConfirmModal'
import { Toggle } from '#/components/shared/Toggle'
import {
	addPackagingItem,
	removePackagingItem,
	updatePackagingItem,
} from '#/server/products'
import { useToastStore } from '#/stores/toastStore'
import { formatPrice } from '#/utils/format'
import { invalidatePackagingQueries } from '#/utils/productCache'
import { packagingItemsOptions } from '#/utils/queryOptions'

interface PackagingItemsManagerProps {
	/** ادمین۲ بدون canEditPackagingFee فقط می‌بیند (فرم اصلی کاربرد دارد) */
	canWrite: boolean
}

const inputCls =
	'w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm outline-none focus:border-primary dark:focus:border-dark-primary transition'

export const PackagingItemsManager = memo(function PackagingItemsManager({
	canWrite,
}: PackagingItemsManagerProps) {
	const queryClient = useQueryClient()
	const showToast = useToastStore((s) => s.showToast)
	const { data: items } = useQuery(packagingItemsOptions)

	const [titleDraft, setTitleDraft] = useState('')
	const [priceDraft, setPriceDraft] = useState('')
	const [confirmRemove, setConfirmRemove] = useState<PackagingItemDto | null>(
		null,
	)
	const [editingPrice, setEditingPrice] = useState<Record<string, string>>({})

	const invalidate = () => invalidatePackagingQueries(queryClient)

	const addMutation = useMutation({
		mutationFn: (data: { title: string; price: number }) =>
			addPackagingItem({ data }),
		onSuccess: async () => {
			await invalidate()
			setTitleDraft('')
			setPriceDraft('')
			showToast('قلم بسته‌بندی افزوده شد')
		},
		onError: (err: Error) =>
			showToast(err.message || 'افزودن قلم ناموفق بود', 'error'),
	})

	const updateMutation = useMutation({
		mutationFn: (input: {
			id: string
			data: { title?: string; price?: number; isActive?: boolean }
		}) => updatePackagingItem(input),
		onSuccess: () => invalidate(),
		onError: (err: Error) =>
			showToast(err.message || 'ذخیره ناموفق بود', 'error'),
	})

	const removeMutation = useMutation({
		mutationFn: (id: string) => removePackagingItem({ id }),
		onSuccess: async () => {
			await invalidate()
			setConfirmRemove(null)
			showToast('قلم حذف شد — محصولاتِ وابسته به هزینه دستی برمی‌گردند')
		},
		onError: (err: Error) =>
			showToast(err.message || 'حذف ناموفق بود', 'error'),
	})

	const handleAdd = () => {
		const title = titleDraft.trim()
		const price = Number(priceDraft)
		if (!canWrite || addMutation.isPending) return
		if (!title) {
			showToast('عنوان قلم را وارد کنید', 'error')
			return
		}
		if (
			!priceDraft.trim() ||
			!Number.isSafeInteger(Math.round(price)) ||
			price < 0
		) {
			showToast('قیمت معتبر وارد کنید', 'error')
			return
		}
		addMutation.mutate({ title, price: Math.round(price) })
	}

	const commitPrice = (item: PackagingItemDto) => {
		if (!canWrite) return
		const raw = editingPrice[item.id]
		if (raw === undefined) return
		// ترمیم اسکنِ استیج-۸۴ — خالی‌کردنِ فیلد قیمت دیگر «صفرِ سراسری»
		// commit نمی‌کند (نو-آپ + برگشتِ پیش‌نمایش به مقدار ذخیره‌شده)
		if (!raw.trim()) {
			setEditingPrice((prev) => {
				const next = { ...prev }
				delete next[item.id]
				return next
			})
			return
		}
		const price = Number(raw)
		if (
			!Number.isFinite(price) ||
			price < 0 ||
			Math.round(price) === item.price
		) {
			setEditingPrice((prev) => {
				const next = { ...prev }
				delete next[item.id]
				return next
			})
			return
		}
		updateMutation.mutate({ id: item.id, data: { price: Math.round(price) } })
		setEditingPrice((prev) => {
			const next = { ...prev }
			delete next[item.id]
			return next
		})
	}

	return (
		<div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
			<h2 className="font-DanaDemiBold text-lg text-gray-800 dark:text-white mb-1 flex items-center gap-2">
				<Box size={20} className="text-primary dark:text-dark-primary" />
				مدیریت اقلام بسته‌بندی
			</h2>
			<p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed mb-4">
				قیمت هر قلم «سراسری» است — یک‌بار تعیین می‌شود و روی همه‌ی محصولاتی که آن
				قلم را دارند اعمال می‌شود. در فرمِ هر محصول، اقلامش را انتخاب می‌کنید و جمعِ
				اقلام = هزینه‌ی بسته‌بندی آن محصول (مشتری فقط جمعِ کل را می‌بیند).
			</p>

			{canWrite && (
				<div className="flex flex-col sm:flex-row gap-2 mb-4">
					<input
						className={inputCls}
						placeholder="عنوان قلم (مثلاً: جعبه کاغذی)"
						maxLength={60}
						value={titleDraft}
						onChange={(e) => setTitleDraft(e.target.value)}
					/>
					<input
						className={`${inputCls} sm:w-40`}
						type="number"
						dir="ltr"
						placeholder="قیمت (تومان)"
						min={0}
						step={500}
						value={priceDraft}
						onChange={(e) => setPriceDraft(e.target.value)}
					/>
					<button
						type="button"
						onClick={handleAdd}
						disabled={addMutation.isPending}
						className="shrink-0 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-primary dark:bg-dark-primary text-white font-DanaMedium text-sm cursor-pointer hover:opacity-90 transition disabled:opacity-50"
					>
						<Plus size={16} />
						افزودن قلم
					</button>
				</div>
			)}

			{(items ?? []).length === 0 ? (
				<p className="text-xs text-gray-400 dark:text-gray-500 py-4 text-center">
					هنوز قلمی ثبت نشده است.
				</p>
			) : (
				<div className="space-y-2">
					{(items ?? []).map((item) => {
						const priceDraftVal = editingPrice[item.id] ?? String(item.price)
						return (
							<div
								key={item.id}
								className={`flex flex-wrap items-center gap-3 p-3 rounded-xl border transition ${
									item.isActive
										? 'border-gray-100 dark:border-white/5 bg-gray-50 dark:bg-[#1a0a0e]'
										: 'border-gray-100 dark:border-white/5 bg-gray-50/50 dark:bg-[#1a0a0e]/50 opacity-60'
								}`}
							>
								<span className="font-DanaDemiBold text-sm text-gray-800 dark:text-white min-w-0 truncate flex-1">
									{item.title}
									{!item.isActive && (
										<span className="text-[10px] text-gray-400 font-DanaMedium mr-2">
											(غیرفعال)
										</span>
									)}
								</span>
								{canWrite ? (
									<input
										className="w-32 px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#2a1015] border border-gray-200 dark:border-[#3a151c] text-sm text-left font-DanaMedium outline-none focus:border-primary transition"
										type="number"
										dir="ltr"
										min={0}
										step={500}
										value={priceDraftVal}
										aria-label={`قیمت ${item.title}`}
										onChange={(e) =>
											setEditingPrice((prev) => ({
												...prev,
												[item.id]: e.target.value,
											}))
										}
										onBlur={() => commitPrice(item)}
										onKeyDown={(e) => {
											if (e.key === 'Enter') {
												e.preventDefault()
												;(e.target as HTMLInputElement).blur()
											}
										}}
									/>
								) : (
									<span className="text-sm text-gray-600 dark:text-gray-300 font-DanaMedium">
										{formatPrice(item.price)} تومان
									</span>
								)}
								{canWrite && (
									<div className="flex items-center gap-3">
										<Toggle
											isOn={item.isActive}
											disabled={
												updateMutation.isPending || removeMutation.isPending
											}
											onToggle={() =>
												updateMutation.mutate({
													id: item.id,
													data: { isActive: !item.isActive },
												})
											}
											label={`فعال بودن ${item.title}`}
										/>
										<button
											type="button"
											onClick={() => setConfirmRemove(item)}
											aria-label={`حذف ${item.title}`}
											disabled={
												removeMutation.isPending || updateMutation.isPending
											}
											title="حذف قلم"
											className="text-red-500 hover:text-red-600 transition cursor-pointer shrink-0"
										>
											<Trash2 size={18} />
										</button>
									</div>
								)}
							</div>
						)
					})}
				</div>
			)}

			<ConfirmModal
				isOpen={!!confirmRemove}
				isPending={removeMutation.isPending}
				title="حذف قلم بسته‌بندی"
				message={`قلم «${confirmRemove?.title ?? ''}» حذف شود؟ محصولاتِ دارای این قلم به هزینه‌ی دستیِ خود برمی‌گردند.`}
				onConfirm={() => {
					if (canWrite && confirmRemove && !removeMutation.isPending)
						removeMutation.mutate(confirmRemove.id)
				}}
				onCancel={() => setConfirmRemove(null)}
			/>
		</div>
	)
})
