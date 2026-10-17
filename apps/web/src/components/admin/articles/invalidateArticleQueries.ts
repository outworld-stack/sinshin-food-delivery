import type { QueryClient } from '@tanstack/react-query'
import { qk } from '#/utils/queryKeys'

/** Editing categories can change article labels, slugs and subcategory IDs. */
export async function invalidateArticleQueries(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: qk.articleCategories }),
    queryClient.invalidateQueries({ queryKey: qk.adminArticleCategories }),
    queryClient.invalidateQueries({ queryKey: qk.adminArticles }),
    queryClient.invalidateQueries({ queryKey: qk.articlesAll }),
    queryClient.invalidateQueries({ queryKey: ['admin-article-details'] }),
  ])
}
