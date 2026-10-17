import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ArticleSummaryDto } from '@sinshin/shared'

type Search = { category?: string; subCategory?: string; sort?: 'newest' | 'most-viewed' }
let search: Search = {}
const navigations: Array<{ search: Search }> = []
const categories = [{ id: 'cat', slug: 'food', name: 'Food', hasSubCategories: true, subCategories: [{ id: 'sub', name: 'Recipes', slug: 'recipes' }] }]
let articles: ArticleSummaryDto[] = []
let allArticles: ArticleSummaryDto[] = []
const t = new Proxy({} as Record<string, string>, { get: (_target, key) => String(key) })

mock.module('@tanstack/react-router', () => ({
  useNavigate: () => (next: { search: Search }) => { navigations.push(next); return Promise.resolve() },
  useSearch: () => search,
  createFileRoute: () => (options: unknown) => options,
  Link: ({ children }: { children: React.ReactNode }) => createElement('a', null, children),
}))
mock.module('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey: string[] }) => ({
    data: options.queryKey[0] === 'article-categories' ? categories
      : options.queryKey[1] === 'all' ? allArticles : articles,
    isLoading: false,
  }),
}))
mock.module('#/utils/queryOptions', () => ({
  articleCategoriesOptions: { queryKey: ['article-categories'] },
  articlesOptions: (category: string, sub: string) => ({ queryKey: ['articles', category, sub] }),
}))
mock.module('#/i18n', () => ({ useI18n: () => ({ t }), useI18nSafe: () => ({ t }) }))
mock.module('#/lib/seo', () => ({ seoHead: () => ({}) }))
mock.module('#/components/ArticleCard', () => ({ ArticleCard: () => null }))
mock.module('#/components/CategoryScroller', () => ({ CategoryScroller: () => null }))
mock.module('#/components/EmptyState', () => ({ EmptyState: () => null }))
mock.module('#/components/LoadingSkeletons', () => ({ ArticleCardSkeleton: () => null, ArticlesPageSkeleton: () => null }))
mock.module('#/components/shared/RouteFallbacks', () => ({ RouteError: () => null }))

const { useArticlesPage } = await import('../src/hooks/site/useArticlesPage')
const { ArticlesFilterContent } = await import('../src/components/site/articles/ArticlesFilterContent')
const { ConfirmModal } = await import('../src/components/ConfirmModal')
type Page = ReturnType<typeof useArticlesPage>

// React executes the actual reducer on each render-phase interaction.
function interact(actions: Array<(page: Page) => void> = []): Page {
  let page!: Page
  let step = 0
  function Probe() {
    page = useArticlesPage()
    if (step < actions.length) actions[step++](page)
    return null
  }
  renderToStaticMarkup(createElement(Probe))
  return page
}

search = { category: 'food', subCategory: 'recipes', sort: 'most-viewed' }
let page = interact()
assert.equal(page.subCategory, 'recipes')
assert.equal(page.state.tempSubCategory, 'recipes', 'shared URLs initialize the filter selection')
assert.equal(page.state.tempSortBy, 'most-viewed')

page.handleSubCategoryChange('all')
assert.deepEqual(navigations.at(-1)?.search, { category: 'food', subCategory: undefined, sort: 'most-viewed' })
page.handleSortChange('newest')
assert.deepEqual(navigations.at(-1)?.search, { category: 'food', subCategory: 'recipes', sort: undefined })
page.handleCategoryClick('other')
assert.deepEqual(navigations.at(-1)?.search, { category: 'other', subCategory: undefined, sort: 'most-viewed' })

const beforeDraft = navigations.length
page = interact([
  p => p.handleOpenFilter(),
  p => p.handleTempSort('newest'),
  p => p.handleTempSub('all'),
  p => p.handleCloseFilter(),
  p => p.handleOpenFilter(),
])
assert.equal(navigations.length, beforeDraft, 'mobile draft changes do not navigate before applying')
assert.equal(page.state.tempSortBy, 'most-viewed', 'reopening discards cancelled sorting')
assert.equal(page.state.tempSubCategory, 'recipes', 'reopening discards cancelled subcategories')
page = interact([p => p.handleOpenFilter(), p => p.handleTempSort('newest'), p => p.handleTempSub('all'), p => p.handleApplyFilters()])
assert.equal(page.state.isFilterOpen, false)
assert.deepEqual(navigations.at(-1)?.search, { category: 'food', subCategory: undefined, sort: undefined })

function article(id: string, views: number, isFeatured = false): ArticleSummaryDto {
  return { id, title: id, excerpt: '', author: '', categoryId: 'cat', views, status: 'ACTIVE', isFeatured,
    publishedAt: '2026-01-01T00:00:00.000Z', categorySlug: 'food', categoryName: 'Food', subCategorySlug: null, subCategoryName: null }
}
articles = [article('low', 1), article('high', 10), article('middle', 5)]
page = interact()
assert.deepEqual(page.visibleArticles.map(a => a.id), ['high', 'middle', 'low'])
assert.deepEqual(articles.map(a => a.id), ['low', 'high', 'middle'], 'sorting leaves the query cache unchanged')
for (let count = 1; count <= 6; count++) {
  allArticles = Array.from({ length: count }, (_, i) => article(`featured-${i}`, i, true))
  articles = allArticles
  page = interact()
  assert.equal(new Set(page.visibleArticles.map(a => a.id)).size, count, 'featured articles remain unique, including short lists')
  assert.deepEqual(interact().visibleArticles, page.visibleArticles, 'featured positions are deterministic')
}
articles = Array.from({ length: 18 }, (_, i) => article(String(i), i))
allArticles = []
assert.equal(interact().visibleArticles.length, 8)
assert.equal(interact([p => p.handleLoadMore()]).visibleArticles.length, 16)

const filterProps = { hasSubCategories: true, subCategories: categories[0].subCategories,
  tempSubCategory: 'recipes', tempSortBy: 'most-viewed' as const,
  onTempSub: () => {}, onTempSort: () => {}, onApply: () => {} }
const filtersHtml = renderToStaticMarkup(createElement('div', null,
  createElement(ArticlesFilterContent, filterProps),
  createElement(ArticlesFilterContent, { ...filterProps, isMobileModal: true }),
))
assert.equal((filtersHtml.match(/value="most-viewed"/g) ?? []).length, 2)
const radioNames = [...filtersHtml.matchAll(/name="([^"]+)"/g)].map(match => match[1])
assert.equal(new Set(radioNames).size, 4, 'desktop and mobile inputs must not share radio groups')

const { Route } = await import('../src/routes/articles/index')
// createFileRoute is mocked above to expose the real route options without a browser.
const route = Route as unknown as {
  component: React.ComponentType
  validateSearch: { parse(value: unknown): Search }
  loader(ctx: { context: { queryClient: { query(options: { queryKey: string[] }): Promise<void> } }; deps: Search }): Promise<void>
}
assert.equal(route.validateSearch.parse({ sort: 'on' }).sort, undefined, 'invalid legacy sort links recover')
assert.deepEqual(route.validateSearch.parse({ category: ' ', subCategory: '' }), { category: undefined, subCategory: undefined }, 'empty filter links select all articles')
const requested: string[][] = []
await route.loader({ context: { queryClient: { query: async options => { requested.push(options.queryKey) } } }, deps: search })
assert(requested.some(key => key.join('/') === 'articles/all/all'), 'SSR preloads featured articles outside the active category')
const pageHtml = renderToStaticMarkup(createElement(route.component))
assert.match(pageHtml, /checked="" value="most-viewed"/, 'desktop filter reflects the applied URL sorting')
assert.match(pageHtml, /checked="" value="recipes"/, 'desktop filter reflects the applied URL subcategory')

const modalHtml = renderToStaticMarkup(createElement('form', null, createElement(ConfirmModal, {
  isOpen: true, isPending: true, title: 'Remove image', message: 'Confirm', onCancel: () => {}, onConfirm: () => {},
})))
assert.equal((modalHtml.match(/type="button"/g) ?? []).length, 2, 'image removal must not submit its enclosing article form')
assert.equal((modalHtml.match(/disabled=""/g) ?? []).length, 2)

console.log('Articles client regressions passed (filters, drafts, sorting, pinning, SSR, dialogs).')
