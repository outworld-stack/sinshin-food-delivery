import type { QueryClient } from '@tanstack/react-query'
import { qk } from './queryKeys'

/** Refresh derived prices, ordering restrictions and packaging selections. */
export function invalidateProductQueries(queryClient: QueryClient) {
	return Promise.all([
		qk.adminProductsAll,
		qk.adminProductDetailsAll,
		qk.productsByMainPrefix,
		qk.productByIdAll,
		qk.cartDetailsAll,
		qk.checkoutPreviewPrefix,
	].map((queryKey) => queryClient.invalidateQueries({ queryKey })))
}

/** Category membership and purchase flags appear in several independent caches. */
export function invalidateCategoryQueries(queryClient: QueryClient) {
	return Promise.all([
		...[
			qk.categories,
			qk.adminMainCategories,
			qk.activeMainCategories,
			qk.adminPurchaseState,
		].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
		invalidateProductQueries(queryClient),
	])
}

export function invalidatePackagingQueries(queryClient: QueryClient) {
	return Promise.all([
		queryClient.invalidateQueries({ queryKey: qk.packagingItems }),
		invalidateProductQueries(queryClient),
	])
}
