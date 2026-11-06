import type { ContentEntityType } from '@sinshin/shared'
import type { QueryClient } from '@tanstack/react-query'
import { invalidateArticleQueries } from '#/components/admin/articles/invalidateArticleQueries'
import {
	invalidateCategoryQueries,
	invalidatePackagingQueries,
	invalidateProductQueries,
} from './productCache'
import { qk } from './queryKeys'

export function invalidateTranslatedContentQueries(
	queryClient: QueryClient,
	entityType: ContentEntityType,
) {
	switch (entityType) {
		case 'product':
		case 'productSize':
			return invalidateProductQueries(queryClient)
		case 'mainCategory':
		case 'category':
			return invalidateCategoryQueries(queryClient)
		case 'packagingItem':
			return invalidatePackagingQueries(queryClient)
		case 'article':
		case 'articleCategory':
		case 'articleSubCategory':
			return invalidateArticleQueries(queryClient)
		case 'about':
			return Promise.all(
				[qk.aboutContent, qk.adminAboutContent].map((queryKey) =>
					queryClient.invalidateQueries({ queryKey }),
				),
			)
		case 'gallery':
			return Promise.all(
				[qk.galleryImages, qk.adminGalleryImages].map((queryKey) =>
					queryClient.invalidateQueries({ queryKey }),
				),
			)
		case 'terms':
			return Promise.all(
				[qk.termsContent, ['admin', 'terms-content']].map((queryKey) =>
					queryClient.invalidateQueries({ queryKey }),
				),
			)
		case 'temporaryClose':
			return Promise.all(
				[qk.restaurantStatus, qk.settingsRestaurantStatus].map((queryKey) =>
					queryClient.invalidateQueries({ queryKey }),
				),
			)
	}
}
