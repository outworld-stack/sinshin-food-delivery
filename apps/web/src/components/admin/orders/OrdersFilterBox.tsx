// src/components/admin/orders/OrdersFilterBox.tsx
import { memo, useCallback } from 'react'
import {
	AMOUNT_SORT_OPTIONS,
	DATE_SORT_OPTIONS,
	FILTER_INPUT_CLS,
	FILTER_LABEL_CLS,
	MobileFilterTrigger,
	ORDER_STATUS_FILTER_OPTIONS,
} from '#/components/admin/filters'
import type { FilterOption } from '#/types/admin/orders'

interface OrdersFilterBoxProps {
	tempSearch: string
	tempStatus: string
	tempSortDate: string
	tempSortAmount: string
	tempAdmin2: string
	tempCourier: string
	showRoleFilters: boolean // فقط ادمین اصلی
	admin2Options: FilterOption[]
	courierOptions: FilterOption[]
	isMobileModal?: boolean // استایل مدال موبایل
	onSearch: (v: string) => void
	onStatus: (v: string) => void
	onSortDate: (v: string) => void
	onSortAmount: (v: string) => void
	onAdmin2: (v: string) => void
	onCourier: (v: string) => void
	onApply: () => void
}

export const OrdersFilterBox = memo(function OrdersFilterBox({
	tempSearch,
	tempStatus,
	tempSortDate,
	tempSortAmount,
	tempAdmin2,
	tempCourier,
	showRoleFilters,
	admin2Options,
	courierOptions,
	isMobileModal = false,
	onSearch,
	onStatus,
	onSortDate,
	onSortAmount,
	onAdmin2,
	onCourier,
	onApply,
}: OrdersFilterBoxProps) {
	const handleSearch = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => onSearch(e.target.value),
		[onSearch],
	)
	const handleStatus = useCallback(
		(e: React.ChangeEvent<HTMLSelectElement>) => onStatus(e.target.value),
		[onStatus],
	)
	const handleDate = useCallback(
		(e: React.ChangeEvent<HTMLSelectElement>) => onSortDate(e.target.value),
		[onSortDate],
	)
	const handleAmount = useCallback(
		(e: React.ChangeEvent<HTMLSelectElement>) => onSortAmount(e.target.value),
		[onSortAmount],
	)
	const handleAdmin2 = useCallback(
		(e: React.ChangeEvent<HTMLSelectElement>) => onAdmin2(e.target.value),
		[onAdmin2],
	)
	const handleCourier = useCallback(
		(e: React.ChangeEvent<HTMLSelectElement>) => onCourier(e.target.value),
		[onCourier],
	)

	// گرید: ادمین اصلی با فیلترهای نقش → ۸ ستونه، وگرنه ۶
	const gridCls = isMobileModal
		? 'grid grid-cols-2 gap-4 items-end'
		: showRoleFilters
			? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-8 gap-4 lg:gap-3 items-end'
			: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4 lg:gap-3 items-end'

	const mobileInputCls = isMobileModal
		? 'w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#2a1015] border border-gray-200 dark:border-[#3a151c] text-sm text-gray-700 dark:text-gray-300 outline-none focus:border-primary'
		: FILTER_INPUT_CLS

	return (
		<div className={gridCls}>
			<div
				className={isMobileModal ? 'col-span-2' : 'sm:col-span-2 lg:col-span-2'}
			>
				<label className={FILTER_LABEL_CLS}>جستجو (شناسه یا موبایل)</label>
				<input
					type="text"
					value={tempSearch}
					onChange={handleSearch}
					placeholder="ord-1000 یا 0912..."
					className={mobileInputCls}
				/>
			</div>
			<div>
				<label className={FILTER_LABEL_CLS}>وضعیت</label>
				<select
					value={tempStatus}
					onChange={handleStatus}
					className={`${mobileInputCls} cursor-pointer`}
				>
					<option value="all">همه</option>
					{ORDER_STATUS_FILTER_OPTIONS.map((o) => (
						<option key={o.value} value={o.value}>
							{o.label}
						</option>
					))}
				</select>
			</div>
			<div>
				<label className={FILTER_LABEL_CLS}>مرتب‌سازی تاریخ</label>
				<select
					value={tempSortDate}
					onChange={handleDate}
					className={`${mobileInputCls} cursor-pointer`}
				>
					{DATE_SORT_OPTIONS.map((o) => (
						<option key={o.value} value={o.value}>
							{o.label}
						</option>
					))}
				</select>
			</div>
			<div>
				<label className={FILTER_LABEL_CLS}>مرتب‌سازی مبلغ</label>
				<select
					value={tempSortAmount}
					onChange={handleAmount}
					className={`${mobileInputCls} cursor-pointer`}
				>
					{AMOUNT_SORT_OPTIONS.map((o) => (
						<option key={o.value} value={o.value}>
							{o.label}
						</option>
					))}
				</select>
			</div>

			{/* فیلترهای نقش — فقط ادمین اصلی */}
			{showRoleFilters && (
				<>
					<div>
						<label className={FILTER_LABEL_CLS}>ادمین سطح ۲</label>
						<select
							value={tempAdmin2}
							onChange={handleAdmin2}
							className={`${mobileInputCls} cursor-pointer`}
						>
							<option value="all">همه</option>
							{admin2Options.map((a) => (
								<option key={a.id} value={a.id}>
									{a.name}
								</option>
							))}
						</select>
					</div>
					<div>
						<label className={FILTER_LABEL_CLS}>پیک</label>
						<select
							value={tempCourier}
							onChange={handleCourier}
							className={`${mobileInputCls} cursor-pointer`}
						>
							<option value="all">همه</option>
							{courierOptions.map((c) => (
								<option key={c.id} value={c.id}>
									{c.name}
								</option>
							))}
						</select>
					</div>
				</>
			)}

			<div
				className={isMobileModal ? 'col-span-2' : 'sm:col-span-2 lg:col-span-1'}
			>
				<button
					type="button"
					onClick={onApply}
					className="w-full h-9.5 rounded-lg bg-primary dark:bg-dark-primary text-white text-sm font-DanaDemiBold hover:opacity-90 transition cursor-pointer"
				>
					اعمال فیلتر
				</button>
			</div>
		</div>
	)
})

// دکمه باز کردن مدال موبایل — جدا برای DRY
// رارد ۴۸ — دکمه‌ی موبایل از اجزای مشترک فیلترها
export const OrdersFilterTrigger = memo(function OrdersFilterTrigger({
	onClick,
}: {
	onClick: () => void
}) {
	return (
		<MobileFilterTrigger
			label="فیلترهای سفارشات"
			onClick={onClick}
			wrapperCls="sm:hidden mb-4"
		/>
	)
})