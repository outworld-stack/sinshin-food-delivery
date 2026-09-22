// src/components/ProductCard.tsx

import { Link } from '@tanstack/react-router'
import { memo, useCallback, useState } from 'react'
import { Cart } from 'reicon-react'
import { useCartStore } from '#/stores/cartStore'
import { useToastStore } from '#/stores/toastStore'
import type { ProductCardProps } from '#/types/shared/ui'
import { formatPrice } from '#/utils/format'

export const ProductCard = memo(function ProductCard({
	product,
	interactive = true,
}: ProductCardProps) {
	const addItem = useCartStore((state) => state.addItem)
	const showToast = useToastStore((state) => state.showToast)

	const hasSizes =
		product.sizesEnabled && product.sizes && product.sizes.length > 0
	const [selectedSizeId, setSelectedSizeId] = useState<string | null>(null)
	const effectiveSizeId = hasSizes
		? (selectedSizeId ?? product.sizes[0].id)
		: null
	const selectedSize = hasSizes
		? product.sizes.find((s) => s.id === effectiveSizeId)
		: null

	const displayPrice = selectedSize ? selectedSize.price : product.finalPrice
	const showDiscount = !hasSizes && product.discountPercentage > 0

	const handleAddToCart = useCallback(() => {
		addItem(product.id, 1, effectiveSizeId)
		showToast('به سبد خرید اضافه شد!')
	}, [addItem, showToast, product.id, effectiveSizeId])

	return (
		<div className="group flex flex-col bg-white dark:bg-[#2a1015] rounded-2xl overflow-hidden border border-gray-300 dark:border-[#3a151c] shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
			{/* سئو-۸: <img> واقعی به‌جای background — alt + lazy + دیده‌شدن در Google Images
          round-12 — interactive=false (پیش‌نمایش فرم محصول): بدون Link — لینک با
          id سنتینل «preview»، preload روی هاور/فوکوس می‌ساخت و 422 پترن UUID
          می‌گرفت (نویز کنسول + RouteError روی کلیک) */}
			{interactive ? (
				<Link
					to="/products/$productId"
					params={{ productId: product.id }}
					className="relative block w-full aspect-4/3 bg-gray-100 dark:bg-[#1a0a0e]"
				>
					{product.profileImage ? (
						<img
							src={product.profileImage}
							alt={product.name}
							loading="lazy"
							decoding="async"
							className="h-full w-full object-cover"
						/>
					) : (
						<div className="absolute inset-0 bg-linear-to-br from-[#f6339a20] to-[#2fd4d120]"></div>
					)}
					{showDiscount && (
						<div className="absolute top-3 left-3 bg-white/90 dark:bg-[#1a0a0e]/90 backdrop-blur-sm text-primary dark:text-dark-primary text-xs font-DanaDemiBold px-3 py-1 rounded-full shadow-md">
							{product.discountPercentage}٪ تخفیف
						</div>
					)}
				</Link>
			) : (
				<div className="relative block w-full aspect-4/3 bg-gray-100 dark:bg-[#1a0a0e]">
					{product.profileImage ? (
						<img
							src={product.profileImage}
							alt={product.name}
							decoding="async"
							className="h-full w-full object-cover"
						/>
					) : (
						<div className="absolute inset-0 bg-linear-to-br from-[#f6339a20] to-[#2fd4d120]"></div>
					)}
					{showDiscount && (
						<div className="absolute top-3 left-3 bg-white/90 dark:bg-[#1a0a0e]/90 backdrop-blur-sm text-primary dark:text-dark-primary text-xs font-DanaDemiBold px-3 py-1 rounded-full shadow-md">
							{product.discountPercentage}٪ تخفیف
						</div>
					)}
				</div>
			)}

			{/* round-14 — موبایل: پدینگ جمع‌تر، قیمت/«تومان» و آیکون سبد کوچک‌تر تا کارت در عرض کم نشکند */}
			<div className="p-3 sm:p-4 flex flex-col flex-1">
				{interactive ? (
					<Link to="/products/$productId" params={{ productId: product.id }}>
						<h3 className="font-DanaDemiBold text-lg text-gray-800 dark:text-white mb-1 hover:text-primary dark:hover:text-dark-primary transition-colors">
							{product.name}
						</h3>
					</Link>
				) : (
					<h3 className="font-DanaDemiBold text-lg text-gray-800 dark:text-white mb-1">
						{product.name}
					</h3>
				)}

				<p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2 font-DanaRegular mb-2 h-10 overflow-hidden">
					{product.description ?? ''}
				</p>

				{hasSizes && (
					<div className="flex flex-wrap gap-1.5 mb-2">
						{product.sizes.map((size) => (
							<button
								key={size.id}
								type="button"
								onClick={() => setSelectedSizeId(size.id)}
								className={`px-2.5 py-1 rounded-lg text-[11px] font-DanaMedium transition cursor-pointer ${
									size.id === effectiveSizeId
										? 'bg-primary dark:bg-dark-primary text-white shadow-sm'
										: 'bg-gray-100 dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#3a151c]'
								}`}
							>
								{size.name}
							</button>
						))}
					</div>
				)}

				<div className="mt-auto flex items-center justify-between gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
					<div className="flex flex-col">
						{showDiscount && (
							<span className="text-[11px] sm:text-xs text-gray-400 line-through font-DanaRegular">
								{formatPrice(product.originalPrice)}
							</span>
						)}
						<div className="flex items-center gap-1">
							<span className="font-DanaDemiBold text-[15px] sm:text-lg text-gray-900 dark:text-white">
								{formatPrice(displayPrice)}
							</span>
							<span className="text-[10px] sm:text-xs text-gray-500 dark:text-gray-400 font-DanaMedium mr-0.5 sm:mr-1">
								تومان
							</span>
						</div>
					</div>

					<button
						onClick={handleAddToCart}
						className="cursor-pointer flex items-center justify-center p-2 sm:p-3 rounded-xl bg-primary dark:bg-dark-primary text-white hover:opacity-90 transition-colors duration-300 shadow-sm hover:shadow-lg hover:shadow-primary/30 dark:hover:shadow-dark-primary/30 shrink-0"
						aria-label="افزودن به سبد خرید"
					>
						<Cart size={24} className="h-[18px] w-[18px] sm:h-6 sm:w-6" />
					</button>
				</div>
			</div>
		</div>
	)
})
