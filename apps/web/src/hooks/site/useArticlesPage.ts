// src/hooks/site/useArticlesPage.ts
import { useReducer, useCallback, useMemo } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { articleCategoriesOptions, articlesOptions } from '#/utils/queryOptions'

// --- State: فقط UI — سورتِ اعمال‌شده از URL میاد ---
export type SortBy = 'newest' | 'most-viewed'
const DEFAULT_SORT: SortBy = 'newest'

interface ArticlesState {
  tempSubCategory: string
  tempSortBy: SortBy
  isFilterOpen: boolean
  visibleCount: number
}

type ArticlesAction =
  | { type: 'SET_TEMP_SUB'; payload: string }
  | { type: 'SET_TEMP_SORT'; payload: SortBy }
  | { type: 'APPLY_FILTERS' }
  | { type: 'OPEN_FILTER'; payload: string }
  | { type: 'CLOSE_FILTER' }
  | { type: 'RESET_COUNT' }
  | { type: 'LOAD_MORE' }

const initialState: ArticlesState = {
  tempSubCategory: 'all',
  tempSortBy: DEFAULT_SORT,
  isFilterOpen: false,
  visibleCount: 8,
}

function articlesReducer(state: ArticlesState, action: ArticlesAction): ArticlesState {
  switch (action.type) {
    case 'SET_TEMP_SUB': return { ...state, tempSubCategory: action.payload }
    case 'SET_TEMP_SORT': return { ...state, tempSortBy: action.payload }
    // APPLY فقط مودال رو می‌بنده — سورت/sub توسط navigate به URL رفت
    case 'APPLY_FILTERS':
      return { ...state, isFilterOpen: false, visibleCount: 8 }
    case 'OPEN_FILTER':
      // tempSub با sub فعلی URL سینک شه — payload از هندلر
      return { ...state, isFilterOpen: true, tempSubCategory: action.payload }
    case 'CLOSE_FILTER': return { ...state, isFilterOpen: false }
    case 'RESET_COUNT': return { ...state, visibleCount: 8 }
    case 'LOAD_MORE': return { ...state, visibleCount: state.visibleCount + 8 }
    default: return state
  }
}

// --- هوک ---
export function useArticlesPage() {
  const [state, dispatch] = useReducer(articlesReducer, initialState)
  const navigate = useNavigate()
  const search = useSearch({ from: '/articles/' })

  // از URL — منبع حقیقت
  const category: string = search.category ?? 'all'
  const subCategory: string = search.subCategory ?? 'all'
  // ⬅ سورت اعمال‌شده = URL (قبلاً reducer بود — با رفرش گم می‌شد)
  const appliedSortBy: SortBy = search.sort ?? DEFAULT_SORT

  // --- دیتا: گزینه‌های مرکزی — loader روت با query پرشون کرده ---
  const { data: categories } = useQuery(articleCategoriesOptions)
  const { data: articles, isLoading } = useQuery(articlesOptions(category, subCategory))

  // --- مشتق‌شده‌ها ---
  const currentCategory = useMemo(
    () => categories?.find(c => c.slug === category),
    [categories, category],
  )
  const subCategories = useMemo(
    () => currentCategory?.subCategories ?? [],
    [currentCategory],
  )
  const hasSubCategories = subCategories.length > 0

  const sortedArticles = useMemo(() => {
    if (appliedSortBy !== 'most-viewed') return articles ?? []
    return [...(articles ?? [])].sort((a, b) => b.views - a.views)
  }, [articles, appliedSortBy])

  const visibleArticles = useMemo(
    () => sortedArticles.slice(0, state.visibleCount),
    [sortedArticles, state.visibleCount],
  )
  const hasMore = sortedArticles.length > state.visibleCount

  // --- هندلرها (useCallback) ---
  const handleCategoryClick = useCallback((slug: string) => {
    navigate({
      to: '/articles',
      search: { ...search, category: slug !== 'all' ? slug : undefined, subCategory: undefined },
      replace: true,
    })
    dispatch({ type: 'RESET_COUNT' })
  }, [navigate, search])

  // اعمال: sub + سورت با هم به URL
  const handleApplyFilters = useCallback(() => {
    navigate({
      to: '/articles',
      search: {
        ...search,
        subCategory: state.tempSubCategory !== 'all' ? state.tempSubCategory : undefined,
        sort: state.tempSortBy !== DEFAULT_SORT ? state.tempSortBy : undefined,
      },
      replace: true,
    })
    dispatch({ type: 'APPLY_FILTERS' })
  }, [navigate, search, state.tempSubCategory, state.tempSortBy])

  const handleOpenFilter = useCallback(() => {
    dispatch({ type: 'OPEN_FILTER', payload: subCategory })
  }, [subCategory])

  const handleCloseFilter = useCallback(() => dispatch({ type: 'CLOSE_FILTER' }), [])
  const handleTempSub = useCallback((v: string) => dispatch({ type: 'SET_TEMP_SUB', payload: v }), [])
  const handleTempSort = useCallback((v: SortBy) => dispatch({ type: 'SET_TEMP_SORT', payload: v }), [])
  const handleLoadMore = useCallback(() => dispatch({ type: 'LOAD_MORE' }), [])

  // آیتم‌های اسکرولر
  const scrollerItems = useMemo(() => [
    { id: 'all', label: 'همه', isActive: category === 'all', onClick: () => handleCategoryClick('all') },
    ...(categories ?? []).map(cat => ({
      id: cat.id,
      label: cat.name,
      isActive: category === cat.slug,
      onClick: () => handleCategoryClick(cat.slug),
    })),
  ], [categories, category, handleCategoryClick])

  return {
    // shape قبلی حفظ شده — appliedSortBy هم مثل قبل داخل state
    state: { ...state, appliedSortBy },
    isLoading,
    hasSubCategories,
    subCategories,
    visibleArticles,
    hasMore,
    scrollerItems,
    handleCategoryClick,
    handleApplyFilters,
    handleOpenFilter,
    handleCloseFilter,
    handleTempSub,
    handleTempSort,
    handleLoadMore,
  }
}