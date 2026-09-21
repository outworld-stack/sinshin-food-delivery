// src/routes/cart/index.tsx

import { asProductId, asSizeId } from '@sinshin/shared'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMemo } from 'react'
import { ArrowsRotate, ChevronRight } from 'reicon-react'
import { ConfirmModal } from '#/components/ConfirmModal'
import { EmptyState } from '#/components/EmptyState'
import { CartPageSkeleton } from '#/components/LoadingSkeletons'
import { RouteError } from '#/components/shared/RouteFallbacks'
import { CartItemsList } from '#/components/site/cart/CartItemsList'
import { CartMobileBar } from '#/components/site/cart/CartMobileBar'
import { CartSummary } from '#/components/site/cart/CartSummary'
import { useCartPage } from '#/hooks/site/useCartPage'
import { useBack } from '#/hooks/useBack'
import { useHydrated } from '#/hooks/useHydrated'
import { cartItemKey } from '#/stores/cartStore'
import { cartDetailsOptions } from '#/utils/queryOptions'

function CartPage() {
	const back = useBack('/products')
	const hasHydrated = useHydrated()
	const page = useCartPage()

	// آیتم‌های استور (فقط id و quantity)
	const items = page.items
	// دیتای قیمت از سرور — فکتوری مرکزی؛
	// آیتم‌ها مستقیم داخل کلید می‌شینن (hash ساختاری — بدون JSON.stringify،
	// مثل checkoutDetails)؛ هر تغییر سبد → ریکوئست تازه، placeholderData بدون فلیک
	const {
		data: cartData,
		isLoading,
		isError,
		refetch,
	} = useQuery({
		...cartDetailsOptions(
			items.map((i) => ({
				productId: asProductId(i.productId),
				sizeId: i.sizeId ? asSizeId(i.sizeId) : null,
				quantity: i.quantity,
			})),
		),
		enabled: items.length > 0,
	})

	// round-12 — ردیف‌هایی که سرور drop کرده (ناموجود/حذف‌شده) ولی هنوز در
	// استور هستند: با ردیف «ناموجود» + دکمهٔ حذف رندر می‌شوند تا صاحب
	// ردیف و راه خروج داشته باشند (قبلاً: تعداد می‌ماند، ردیف و حذف نبود)
	const unavailableItems = useMemo(() => {
		if (!cartData) return []
		const alive = new Set(
			cartData.items.map((i) => cartItemKey(i.id, i.sizeId)),
		)
		return items
			.filter((i) => !alive.has(cartItemKey(i.productId, i.sizeId)))
			.map((i) => ({
				key: cartItemKey(i.productId, i.sizeId),
				quantity: i.quantity,
			}))
	}, [items, cartData])

	// آمار مشتق‌شده — round-12: تعداد هم از پاسخ سرور (فقط اقلام واقعی
	// سفارش‌پذیر)؛ قبلاً تعداد از استور بود و با drop شدن آیتم‌ها «۱ عدد /
	// ۰ تومان» رندر می‌شد
	const cartStats = useMemo(() => {
		const totalItems =
			cartData?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0
		const total = cartData?.total ?? 0
		const totalSavings =
			cartData?.items.reduce(
				(sum, item) =>
					sum + (item.originalPrice - item.finalPrice) * item.quantity,
				0,
			) ?? 0
		return { totalItems, total, totalSavings }
	}, [cartData])

	// اسکلتون اختصاصی هنگام هیدریشن/لودینگ
	if (!hasHydrated || (isLoading && !cartData)) {
		return <CartPageSkeleton />
	}

	// سبد خالی
	if (items.length === 0) {
		return (
			<div className="py-10 px-4">
				<EmptyState
					title="سبد خرید شما خالی است"
					description="هنوز محصولی به سبد خرید اضافه نکرده‌اید. می‌توانید منوی محصولات را مشاهده کنید."
				/>
				<div className="mt-6 text-center">
					<Link
						to="/products"
						className="inline-block px-8 py-3 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaMedium hover:opacity-90 transition cursor-pointer"
					>
						مشاهده محصولات
					</Link>
				</div>
			</div>
		)
	}

	return (
		<div className="py-10 px-4 pb-32 lg:pb-10">
			{/* بازگشت */}
			<button
				type="button"
				onClick={back}
				className="flex items-center cursor-pointer gap-2 text-gray-600 dark:text-gray-300 hover:text-primary dark:hover:text-dark-primary transition mb-10 font-DanaMedium w-fit"
			>
				<ChevronRight size={20} />
				بازگشت
			</button>

			{/* هدر + دکمه خالی کردن */}
			<div className="flex items-center justify-between mb-8">
				<h1 className="font-MorabbaBold text-3xl text-gray-800 dark:text-white">
					سبد خرید
				</h1>
				<button
					type="button"
					onClick={page.handleOpenClearModal}
					className="text-sm text-red-500 hover:text-red-600 transition font-DanaMedium cursor-pointer"
				>
					خالی کردن سبد
				</button>
			</div>

			{/* round-12 — خطای دریافت قیمت (مثلاً 422/شبکه): قبلاً کاملاً خاموش
          می‌مرد و «۰ تومان» نشان می‌داد؛ حالا بنر + تلاش مجدد */}
			{isError && (
				<div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
					<p className="text-sm text-red-500 dark:text-red-400 font-DanaMedium leading-relaxed">
						قیمت‌های سبد از سرور دریافت نشد. اتصال یا موارد سبد را بررسی کنید.
					</p>
					<button
						type="button"
						onClick={() => void refetch()}
						className="px-4 py-2 rounded-xl bg-red-500 text-white text-sm font-DanaMedium hover:bg-red-600 transition cursor-pointer flex items-center gap-2 shrink-0"
					>
						<ArrowsRotate size={14} />
						تلاش مجدد
					</button>
				</div>
			)}

			{/* گرید اصلی */}
			<div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
				<CartItemsList
					items={cartData?.items ?? []}
					unavailableItems={unavailableItems}
					onIncrement={page.handleIncrement}
					onDecrement={page.handleDecrement}
					onRemove={page.handleRemove}
				/>
				<CartSummary
					totalItems={cartStats.totalItems}
					total={cartStats.total}
					totalSavings={cartStats.totalSavings}
				/>
			</div>

			{/* نوار موبایل */}
			<CartMobileBar total={cartStats.total} />

			{/* مودال تایید خالی کردن */}
			<ConfirmModal
				isOpen={page.state.isClearModalOpen}
				title="خالی کردن سبد خرید"
				message="آیا از خالی کردن سبد خرید خود مطمئن هستید؟ تمام محصولات از سبد شما حذف خواهند شد."
				onConfirm={page.handleConfirmClear}
				onCancel={page.handleCloseClearModal}
			/>
		</div>
	)
}

export const Route = createFileRoute('/cart/')({
	component: CartPage,
	pendingComponent: CartPageSkeleton,
	errorComponent: RouteError,
	head: () => ({
		meta: [
			{ title: 'سبد خرید | سین شین' },
			{ name: 'robots', content: 'noindex, nofollow' },
		],
	}),
})
