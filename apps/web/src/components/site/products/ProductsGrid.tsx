// ═══════════════════════════════════════════════════════════════
// stage-55 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/components/site/products/ProductsGrid.tsx
// وضعیت: ویرایش فایل موجود (یک تغییر نقطه‌ای)
// تغییر: ورود پلکانی کارت‌ها با کلاس grid-anim (CSS-only)
// ═══════════════════════════════════════════════════════════════

// src/components/site/products/ProductsGrid.tsx
import { memo } from 'react'
import { EmptyState } from '#/components/EmptyState'
import { ProductCard } from '#/components/ProductCard'
import { useI18n } from '#/i18n'
import type { Product } from '#/server/products'

interface ProductsGridProps {
	products: Product[]
	hasMore: boolean
	onLoadMore: () => void
}

export const ProductsGrid = memo(function ProductsGrid({
	products,
	hasMore,
	onLoadMore,
}: ProductsGridProps) {
	const { t } = useI18n()

	if (products.length === 0) {
		return (
			<EmptyState
				title={t['products.emptyTitle']}
				description={t['products.emptyDesc']}
			/>
		)
	}

	return (
		<div className="flex-1">
			{/* Reserve space around the grid for the featured badges' small overhang. */}
			<div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 grid-anim p-2">
				{products.map((product) => (
					<ProductCard key={product.id} product={product} />
				))}
			</div>

			{hasMore && (
				<div className="mt-10 text-center">
					<button
						type="button"
						onClick={onLoadMore}
						className="px-8 py-3 rounded-xl bg-gray-100 dark:bg-[#2a1015] text-gray-700 dark:text-gray-300 font-DanaMedium hover:bg-gray-200 dark:hover:bg-[#3a151c] transition cursor-pointer border border-gray-200 dark:border-white/10"
					>
						{t['products.loadMore']}
					</button>
				</div>
			)}
		</div>
	)
})
