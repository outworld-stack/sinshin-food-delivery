// ═══════════════════════════════════════════════════════════════
// stage-48 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/components/admin/products/CategoryManager.tsx
// وضعیت: جایگزینی کامل فایل موجود
// تغییر: بخش «فعال کردن سایز بندی» حذف شد (سایزبندی حالا فقط داخل
//        فرم محصول است) — به‌جایش ۳ سوئیچ حالت سفارش: ارسال با پیک،
//        تحویل در محل بیرون‌بر، تحویل در محل با سرو. محصولاتِ دسته
//        این حالت‌ها را به ارث می‌برند (و فقط می‌توانند محدودتر شوند).
// ═══════════════════════════════════════════════════════════════

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
// src/components/admin/products/CategoryManager.tsx
import { memo, useCallback, useState } from 'react'
import { Bag, Bicycle, Chair, Pen, Trash2 } from 'reicon-react'
import { ArField } from '#/components/admin/ArField'
import { ConfirmModal } from '#/components/ConfirmModal'
import { Toggle } from '#/components/shared/Toggle'
import {
	type Category,
	createCategory,
	deleteCategory,
	updateCategory,
} from '#/server/products'
import { useToastStore } from '#/stores/toastStore'
import { qk } from '#/utils/queryKeys'
import { adminMainCategoriesOptions } from '#/utils/queryOptions'

// فرم واحد به‌جای استیت‌های پراکنده
interface CategoryFormState {
	isModalOpen: boolean
	editingId: string | null
	name: string
	/** round-34 — نام عربی دسته */
	nameAr: string
	mainCategoryId: string
	/** stage-48 — حالت‌های سفارش پایه (پیش‌فرض هر سه روشن = ارث کامل) */
	courierEnabled: boolean
	takeawayEnabled: boolean
	dineInEnabled: boolean
	confirmDeleteId: string | null
}

const EMPTY_FORM: CategoryFormState = {
	isModalOpen: false,
	editingId: null,
	name: '',
	nameAr: '',
	mainCategoryId: '',
	courierEnabled: true,
	takeawayEnabled: true,
	dineInEnabled: true,
	confirmDeleteId: null,
}

interface CategoryManagerProps {
	categories: Category[] // ⬅ تایپ واقعی (قبلاً any بود)
}

// stage-48 — تنظیمات ۳ سوئیچ حالت سفارش (آیکون + عنوان + توضیح)
const ORDER_MODE_ITEMS = [
	{
		key: 'courierEnabled' as const,
		icon: Bicycle,
		title: 'ارسال با پیک',
		hint: 'محصولات این دسته با پیک به آدرس مشتری ارسال می‌شوند.',
	},
	{
		key: 'takeawayEnabled' as const,
		icon: Bag,
		title: 'تحویل در محل (بیرون‌بر)',
		hint: 'مشتری سفارش را حضوری از سین‌شین تحویل می‌گیرد.',
	},
	{
		key: 'dineInEnabled' as const,
		icon: Chair,
		title: 'سرو در محل',
		hint: 'سفارش سر میز سرو می‌شود — بدون هزینه بسته‌بندی.',
	},
]

export const CategoryManager = memo(function CategoryManager({
	categories,
}: CategoryManagerProps) {
	const queryClient = useQueryClient()
	const showToast = useToastStore((s) => s.showToast)

	const [form, setForm] = useState<CategoryFormState>(EMPTY_FORM)
	const set = useCallback((partial: Partial<CategoryFormState>) => {
		setForm((f) => ({ ...f, ...partial }))
	}, [])

	// دسته‌های اصلی از فکتوری مشترک — همون کش MainCategoryManager
	const { data: allMains } = useQuery(adminMainCategoriesOptions)

	const createMut = useMutation({
		mutationFn: (data: {
			name: string
			nameAr?: string | null
			mainCategoryId: string
			courierEnabled: boolean
			takeawayEnabled: boolean
			dineInEnabled: boolean
		}) => createCategory({ data }),
		onSuccess: (res) => {
			if (!res.success) {
				showToast(res.message ?? 'خطا', 'error')
				return
			}
			queryClient.invalidateQueries({ queryKey: qk.categories })
			set({ isModalOpen: false })
			showToast('دسته‌بندی افزوده شد')
		},
	})

	const updateMut = useMutation({
		mutationFn: (data: {
			id: string
			name: string
			nameAr?: string | null
			mainCategoryId: string
			courierEnabled: boolean
			takeawayEnabled: boolean
			dineInEnabled: boolean
		}) => updateCategory({ data }),
		onSuccess: (res) => {
			if (!res.success) {
				showToast(res.message ?? 'خطا', 'error')
				return
			}
			queryClient.invalidateQueries({ queryKey: qk.categories })
			// phase-3: جابه‌جایی والد دسته → محصولات بین main ها حرکت می‌کنند
			queryClient.invalidateQueries({ queryKey: qk.productsByMainPrefix })
			// stage-48: تغییر حالت‌های دسته → حالت مؤثر محصولات عوض می‌شود؛
			// سبد/چک‌اوت‌های باز باید کشِ تازه ببینند
			queryClient.invalidateQueries({ queryKey: qk.productByIdAll })
			queryClient.invalidateQueries({ queryKey: qk.cartDetailsAll })
			queryClient.invalidateQueries({ queryKey: qk.checkoutPreviewPrefix })
			set({ isModalOpen: false })
			showToast('دسته‌بندی ویرایش شد')
		},
	})

	const deleteMut = useMutation({
		mutationFn: (id: string) => deleteCategory({ data: { id } }),
		onSuccess: (res) => {
			if (!res.success) {
				showToast(res.message ?? 'خطا', 'error')
				return
			}
			queryClient.invalidateQueries({ queryKey: qk.categories })
			showToast('دسته‌بندی حذف شد')
			set({ confirmDeleteId: null })
		},
	})

	// باز کردن مودال — ساخت یا ویرایش (والد هم هیدرات می‌شه — رفع F-58)
	const openModal = useCallback(
		(cat?: Category) => {
			if (cat) {
				set({
					isModalOpen: true,
					editingId: cat.id,
					name: cat.name,
					nameAr: cat.nameAr ?? '',
					mainCategoryId: cat.mainCategoryId,
					// stage-48 — هیدراته از حالت‌های دسته (بدون مقدار = legacy ⇒ روشن)
					courierEnabled: cat.courierEnabled ?? true,
					takeawayEnabled: cat.takeawayEnabled ?? true,
					dineInEnabled: cat.dineInEnabled ?? true,
				})
			} else {
				set({
					isModalOpen: true,
					editingId: null,
					name: '',
					nameAr: '',
					mainCategoryId: '',
					courierEnabled: true,
					takeawayEnabled: true,
					dineInEnabled: true,
				})
			}
		},
		[set],
	)

	const closeModal = useCallback(() => set({ isModalOpen: false }), [set])

	const handleSave = useCallback(() => {
		if (!form.name.trim()) {
			showToast('لطفا نام دسته را وارد کنید', 'error')
			return
		}
		if (!form.mainCategoryId) {
			showToast('دسته اصلی را انتخاب کنید', 'error')
			return
		}
		const payload = {
			name: form.name.trim(),
			nameAr: form.nameAr.trim() || null,
			mainCategoryId: form.mainCategoryId,
			courierEnabled: form.courierEnabled,
			takeawayEnabled: form.takeawayEnabled,
			dineInEnabled: form.dineInEnabled,
		}
		if (form.editingId) updateMut.mutate({ id: form.editingId, ...payload })
		else createMut.mutate(payload)
	}, [form, showToast, updateMut, createMut])

	// stage-48 — بج‌های حالت سفارش در ردیف لیست
	const ModeBadges = useCallback(({ cat }: { cat: Category }) => {
		const items = [
			{ on: cat.courierEnabled ?? true, icon: Bicycle, title: 'پیک' },
			{ on: cat.takeawayEnabled ?? true, icon: Bag, title: 'بیرون‌بر' },
			{ on: cat.dineInEnabled ?? true, icon: Chair, title: 'سرو در محل' },
		]
		return (
			<div className="flex items-center gap-1 mt-1">
				{items.map(({ on, icon: Icon, title }) => (
					<span
						key={title}
						title={title}
						className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-DanaDemiBold ${
							on
								? 'bg-green-100 text-green-600 dark:bg-green-500/10 dark:text-green-400'
								: 'bg-red-100 text-red-500 dark:bg-red-500/10 dark:text-red-400'
						}`}
					>
						<Icon size={11} />
						{title}
					</span>
				))}
			</div>
		)
	}, [])

	return (
		<div className="w-full bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm h-fit">
			<div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-100 dark:border-white/5">
				<h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white">
					دسته‌بندی‌ها
				</h2>
				<button
					onClick={() => openModal()}
					className="px-3 py-1.5 rounded-lg bg-primary dark:bg-dark-primary text-white text-xs font-DanaMedium cursor-pointer"
				>
					افزودن دسته
				</button>
			</div>

			<div className="space-y-3">
				{categories.map((cat) => (
					<div
						key={cat.id}
						className="flex items-center justify-between p-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e]"
					>
						<div className="flex flex-col">
							<span className="text-sm font-DanaMedium text-gray-700 dark:text-gray-300">
								{cat.name}
							</span>
							<ModeBadges cat={cat} />
						</div>
						<div className="flex items-center gap-1">
							<button
								onClick={() => openModal(cat)}
								className="p-1.5 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5 cursor-pointer"
							>
								<Pen size={16} />
							</button>
							<button
								onClick={() => set({ confirmDeleteId: cat.id })}
								className="p-1.5 rounded text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 cursor-pointer"
							>
								<Trash2 size={16} />
							</button>
						</div>
					</div>
				))}
			</div>

			{form.isModalOpen && (
				<div className="fixed inset-0 z-100 flex items-center justify-center p-4">
					<div
						className="absolute inset-0 bg-black/50 backdrop-blur-sm"
						onClick={closeModal}
					></div>
					<div className="relative bg-white dark:bg-[#2a1015] p-6 rounded-2xl shadow-xl w-full max-w-md space-y-4 max-h-[90vh] overflow-y-auto">
						<h3 className="font-DanaDemiBold text-lg text-gray-800 dark:text-white">
							{form.editingId ? 'ویرایش دسته' : 'دسته جدید'}
						</h3>
						<div>
							<label className="block text-xs text-gray-400 mb-1">
								دسته اصلی (والد)
							</label>
							<select
								value={form.mainCategoryId}
								onChange={(e) => set({ mainCategoryId: e.target.value })}
								className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm outline-none cursor-pointer"
							>
								<option value="">انتخاب کنید...</option>
								{(allMains ?? []).map((mc) => (
									<option key={mc.id} value={mc.id}>
										{mc.name}
									</option>
								))}
							</select>
						</div>

						<div>
							<label className="block text-xs text-gray-400 mb-1">
								نام دسته
							</label>
							<input
								value={form.name}
								onChange={(e) => set({ name: e.target.value })}
								className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm outline-none"
							/>
						</div>

						{/* round-34 — نام عربی دسته (خالی = پشتیبان فارسی) */}
						<ArField
							label="نام دسته"
							value={form.nameAr}
							onChange={(v) => set({ nameAr: v })}
							faReference={form.name}
							maxLength={60}
						/>

						{/* stage-48 — حالت‌های سفارش (به‌جای سوئیچ سایز بندی) */}
						<div className="p-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-100 dark:border-[#3a151c]">
							<p className="text-xs font-DanaDemiBold text-gray-600 dark:text-gray-300 mb-3">
								حالت‌های سفارش محصولات این دسته
							</p>
							<p className="text-[10px] text-gray-400 leading-relaxed mb-3">
								محصولاتِ این دسته به‌طور پیش‌فرض همین حالت‌ها را به ارث می‌برند؛ در
								فرم هر محصول فقط می‌توان محدودترش کرد.
							</p>
							<div className="space-y-2">
								{ORDER_MODE_ITEMS.map(({ key, icon: Icon, title, hint }) => {
									const isOn = form[key]
									return (
										<div
											key={key}
											className={`flex items-center justify-between gap-3 p-3 rounded-lg border transition ${
												isOn
													? 'border-green-200 bg-green-50/50 dark:border-green-500/20 dark:bg-green-500/5'
													: 'border-red-200 bg-red-50/50 dark:border-red-500/20 dark:bg-red-500/5'
											}`}
										>
											<div className="flex items-center gap-2.5 min-w-0">
												<span
													className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
														isOn
															? 'bg-green-100 text-green-600 dark:bg-green-500/10 dark:text-green-400'
															: 'bg-red-100 text-red-500 dark:bg-red-500/10 dark:text-red-400'
													}`}
												>
													<Icon size={16} />
												</span>
												<div className="min-w-0">
													<p className="text-xs font-DanaDemiBold text-gray-700 dark:text-gray-200">
														{title}
													</p>
													<p className="text-[10px] text-gray-400 mt-0.5 leading-relaxed">
														{hint}
													</p>
												</div>
											</div>
											<Toggle
												isOn={isOn}
												onToggle={() => set({ [key]: !isOn })}
											/>
										</div>
									)
								})}
							</div>
							{(!form.courierEnabled ||
								!form.takeawayEnabled ||
								!form.dineInEnabled) && (
								<p className="text-[10px] text-orange-500 dark:text-orange-400 leading-relaxed mt-3 bg-orange-50 dark:bg-orange-500/10 rounded-lg p-2.5">
									⚠️ حالت خاموش یعنی هیچ محصولی از این دسته در آن حالت قابل سفارش
									نیست — کاربر در کارت محصول، سبد و چک‌اوت این محدودیت را می‌بیند.
								</p>
							)}
						</div>

						<div className="flex gap-3 pt-2">
							<button
								onClick={closeModal}
								className="flex-1 py-2 rounded-lg bg-gray-100 dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 text-sm cursor-pointer"
							>
								انصراف
							</button>
							<button
								onClick={handleSave}
								className="flex-1 py-2 rounded-lg bg-primary dark:bg-dark-primary text-white text-sm cursor-pointer"
							>
								ذخیره
							</button>
						</div>
					</div>
				</div>
			)}

			<ConfirmModal
				isOpen={form.confirmDeleteId !== null}
				title="حذف دسته‌بندی"
				message="آیا از حذف این دسته‌بندی مطمئن هستید؟"
				onConfirm={() => {
					if (form.confirmDeleteId) deleteMut.mutate(form.confirmDeleteId)
				}}
				onCancel={() => set({ confirmDeleteId: null })}
			/>
		</div>
	)
})