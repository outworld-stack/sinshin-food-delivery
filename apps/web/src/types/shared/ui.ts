// src/types/ui.ts

export interface PaginationProps {
	currentPage: number
	totalPages: number
	itemsPerPage?: number
	totalItems?: number
	onPageChange: (page: number) => void
	onItemsPerPageChange?: (count: number) => void
	pageSizeOptions?: number[]
}

export interface EmptyStateProps {
	title?: string
	description?: string
}

export interface ProductCardProps {
	product: {
		id: string
		name: string
		description: string | null
		originalPrice: number
		finalPrice: number
		discountPercentage: number
		// ⬅ عوض شد: imageGradient → profileImage (قرارداد API)
		profileImage: string | null
		sizesEnabled: boolean
		sizes: { id: string; name: string; price: number }[]
	}
	/**
	 * round-12 — false = حالت پیش‌نمایش (فرم محصول): بدون Link.
	 * لینک با id سنتینل باعث preload→422 و کلیک→RouteError می‌شد.
	 */
	interactive?: boolean
}

export interface ArticleCardProps {
	article: {
		id: string
		title: string
		excerpt: string
		profileImage: string | null
		author: string
		publishedAt: Date
	}
}

export interface ThemeToggleProps {
	className?: string
}

export interface ScrollerItem {
	id: string
	label: string
	isActive: boolean
	onClick: () => void
}

export interface CategoryScrollerProps {
	items: ScrollerItem[]
}

export interface GalleryProps {
	images: string[]
}

export interface FileUploaderProps {
	onUploadComplete: (url: string) => void
	initialImage?: string
	accept?: string
	fileTypeText?: string
}

export interface WordSliderProps {
	words: string[]
	className?: string
}

export interface AdminChartProps {
	chartType: 'bar' | 'pie' | 'line'
	data: { label: string; value: number }[]
}

export interface SkeletonProps {
	className?: string
}

export interface BrandProps {
	textSize?: string
	to?: string
}

export interface FilterProps {
	tempSearch: string
	setTempSearch: (val: string) => void
	tempStatus: string
	setTempStatus: (val: string) => void
	tempSortDate: string
	setTempSortDate: (val: string) => void
	tempSortAmount: string
	setTempSortAmount: (val: string) => void
	applyFilters: () => void
}

export interface StatusConfig {
	text: string
	color: string
}

export interface AdminUserFilterProps {
	tempSearch: string
	setTempSearch: (val: string) => void
	tempDevice: string
	setTempDevice: (val: string) => void
	tempStatus: string
	setTempStatus: (val: string) => void
	tempSortDate: string
	setTempSortDate: (val: string) => void
	tempSortWallet: string
	setTempSortWallet: (val: string) => void
	tempSortSpent: string
	setTempSortSpent: (val: string) => void
	applyFilters: () => void
}
