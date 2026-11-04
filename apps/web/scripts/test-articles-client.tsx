import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ArticleSummaryDto } from '@sinshin/shared'

type Search = { category?: string; subCategory?: string; sort?: 'newest' | 'most-viewed'; page?: number; lang?: 'fa' | 'ar' }
let search: Search = {}
let lang: 'fa' | 'ar' = 'fa'
const navigations: Array<{ search: Search }> = []
const categories = [{ id: 'cat', slug: 'food', name: 'Food', hasSubCategories: true, subCategories: [{ id: 'sub', name: 'Recipes', slug: 'recipes' }] }]
let articles: ArticleSummaryDto[] = []
let allArticles: ArticleSummaryDto[] = []
const t = new Proxy({} as Record<string, string>, { get: (_target, key) => String(key) })

mock.module('@tanstack/react-router', () => ({
  useNavigate: () => (next: { search: Search }) => { navigations.push(next); return Promise.resolve() },
  useSearch: () => search,
  createFileRoute: () => (options: unknown) => options,
  notFound: () => Object.assign(new Error('Not found'), { isNotFound: true }),
  Link: ({ children, to, search, preload: _preload, ...props }: { children: React.ReactNode; to: string; search?: Search; preload?: boolean }) => {
    const query = new URLSearchParams(Object.entries(search ?? {}).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]))
    return createElement('a', { ...props, href: to + (query.size ? `?${query}` : '') }, children)
  },
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
mock.module('#/i18n', () => ({ useI18n: () => ({ t, lang }), useI18nSafe: () => ({ t, lang }) }))
mock.module('#/components/ArticleCard', () => ({ ArticleCard: () => null }))
mock.module('#/components/CategoryScroller', () => ({ CategoryScroller: () => null }))
mock.module('#/components/EmptyState', () => ({ EmptyState: () => null }))
mock.module('#/components/LoadingSkeletons', () => ({ ArticleCardSkeleton: () => null, ArticlesPageSkeleton: () => null }))
mock.module('#/components/shared/RouteFallbacks', () => ({ RouteError: () => null, RouteNotFound: () => null }))

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
assert.deepEqual(navigations.at(-1)?.search, { category: 'food', subCategory: undefined, sort: 'most-viewed', page: undefined })
page.handleSortChange('newest')
assert.deepEqual(navigations.at(-1)?.search, { category: 'food', subCategory: 'recipes', sort: undefined, page: undefined })
page.handleCategoryClick('other')
assert.deepEqual(navigations.at(-1)?.search, { category: 'other', subCategory: undefined, sort: 'most-viewed', page: undefined })

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
assert.deepEqual(navigations.at(-1)?.search, { category: 'food', subCategory: undefined, sort: undefined, page: undefined })

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
assert.equal(interact().visibleArticles.length, 12)
assert.equal(interact([p => p.handleLoadMore()]).visibleArticles.length, 18)

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
  loader(ctx: { context: { queryClient: { query(options: { queryKey: string[] }): Promise<unknown> } }; deps: Search }): Promise<{ page: number }>
  head(ctx: { matches: { context: { lang: 'fa' | 'ar' } }[]; match: { search: Search }; loaderData?: { page: number } }): {
    meta: Array<{ title?: string; name?: string; property?: string; content?: string }>;
    links: Array<{ rel: string; href: string; hrefLang?: string }>
  }
}
assert.equal(route.validateSearch.parse({ sort: 'on' }).sort, undefined, 'invalid legacy sort links recover')
assert.deepEqual(route.validateSearch.parse({ category: ' ', subCategory: '' }), { category: undefined, subCategory: undefined }, 'empty filter links select all articles')
const requested: string[][] = []
const loaderContext = { queryClient: { query: async (options: { queryKey: string[] }) => {
  requested.push(options.queryKey)
  return options.queryKey[0] === 'article-categories' ? categories : options.queryKey[1] === 'all' ? allArticles : articles
} } }
await route.loader({ context: loaderContext, deps: search })
assert(requested.some(key => key.join('/') === 'articles/all/all'), 'SSR preloads featured articles outside the active category')
const pageHtml = renderToStaticMarkup(createElement(route.component))
assert.match(pageHtml, /checked="" value="most-viewed"/, 'desktop filter reflects the applied URL sorting')
assert.match(pageHtml, /checked="" value="recipes"/, 'desktop filter reflects the applied URL subcategory')

// Every archive page is available through real links and SSR, beyond the first 12 cards.
search = {}
allArticles = Array.from({ length: 31 }, (_, index) => article(`archive-${index}`, index))
page = interact()
assert.equal(page.visibleArticles[0]?.id, 'archive-0')
assert.equal(page.visibleArticles.length, 12)
assert.equal(page.nextPageSearch.page, 2)
assert.match(renderToStaticMarkup(createElement(route.component)), /href="\/articles\?page=2"/)
page = interact([p => p.handleLoadMore()])
assert.equal(page.visibleArticles.length, 24, 'normal load-more keeps previously visible cards')
assert.equal(page.nextPageSearch.page, 3, 'the fallback URL advances with appended content')
search = { page: 2 }
page = interact()
assert.equal(page.visibleArticles[0]?.id, 'archive-12')
assert.equal(page.visibleArticles.length, 12, 'direct page 2 renders a distinct SSR slice')
assert.equal(page.previousPageSearch.page, undefined)
page.handleCategoryClick('food')
assert.equal(navigations.at(-1)?.search.page, undefined, 'filters reset the pagination cursor')
assert.deepEqual(await route.loader({ context: loaderContext, deps: search }), { page: 2 })
await assert.rejects(route.loader({ context: loaderContext, deps: { page: 4 } }), { isNotFound: true })
for (const value of ['garbage', -2, 0, 1.5, Infinity]) {
  assert.equal(route.validateSearch.parse({ page: value }).page, undefined)
}
assert.equal(route.validateSearch.parse({ page: '2' }).page, 2)
for (const selectedLang of ['fa', 'ar'] as const) {
  lang = selectedLang
  page = interact()
  assert.equal(page.nextPageSearch.lang, selectedLang === 'ar' ? 'ar' : undefined)
  const head = route.head({ matches: [{ context: { lang } }], match: { search }, loaderData: { page: 2 } })
  const canonical = head.links.find(link => link.rel === 'canonical')?.href
  const parsed = new URL(canonical!)
  assert.equal(parsed.hostname, 'sinshin-foodpark.ir')
  assert.equal(parsed.searchParams.get('page'), '2')
  assert.equal(parsed.searchParams.get('lang'), selectedLang === 'ar' ? 'ar' : null)
  assert.equal(head.meta.find(meta => meta.property === 'og:url')?.content, canonical)
  assert.match(head.meta.find(meta => meta.title)?.title ?? '', /2$/)
  assert(head.links.some(link => link.hrefLang === 'ar' && new URL(link.href).searchParams.get('page') === '2'))
  assert(!head.meta.some(meta => meta.name === 'robots' && meta.content?.includes('noindex')))
}
const filteredHead = route.head({ matches: [{ context: { lang: 'fa' } }], match: { search: { category: 'food', page: 2 } }, loaderData: { page: 2 } })
assert.equal(filteredHead.meta.find(meta => meta.name === 'robots')?.content, 'noindex, follow', 'faceted archives do not create indexable duplicate combinations')
assert.equal(route.head({ matches: [], match: { search: {} } }).meta.find(meta => meta.name === 'robots')?.content, 'noindex, follow')

const modalHtml = renderToStaticMarkup(createElement('form', null, createElement(ConfirmModal, {
  isOpen: true, isPending: true, title: 'Remove image', message: 'Confirm', onCancel: () => {}, onConfirm: () => {},
})))
assert.equal((modalHtml.match(/type="button"/g) ?? []).length, 2, 'image removal must not submit its enclosing article form')
assert.equal((modalHtml.match(/disabled=""/g) ?? []).length, 2)

console.log('Articles client regressions passed (filters, drafts, sorting, pinning, SSR, dialogs).')
