// src/hooks/site/useProductsPage.ts
import { useReducer, useCallback, useMemo } from 'react'
import { z } from 'zod'
import { useSearch, useNavigate } from '@tanstack/react-router'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { activeMainCategoriesOptions, productsByMainOptions } from '#/utils/queryOptions'
import type { MainCategory, Category, Product } from '#/server/products'

// --- تایپ‌ها ---
export const SORT_KEYS = ['newest', 'most-viewed', 'best-selling', 'fastest-prep', 'expensive', 'cheap'] as const
export type SortKey = (typeof SORT_KEYS)[number]
// اسکیمای مشترک با validateSearch روت — سورت شهروند URL شده
export const sortSchema = z.enum(SORT_KEYS)
const DEFAULT_SORT: SortKey = 'newest'

// Main فعلی — منطق مشترک بین loader (سرور) و هوک (کلاینت).
// فقط همین تابع باید در دو جا یکسان اجرا شه — برای همین exported
export function resolveActiveMain(mains: MainCategory[], tab?: string): MainCategory | null {
  if (tab) {
    const found = mains.find(m => m.slug === tab)
    if (found) return found
    // تب نامعتبر → به‌جای صفحه‌ی خالی، Main پیش‌فرض (بهبود رفتار)
  }
  if (mains.length > 0) return mains.find(m => m.isDefault) ?? mains[0]
  return null
}

// --- State: فقط UI واقعی — سورتِ اعمال‌شده از URL میاد ---
interface ProductsState {
  tempSortBy: SortKey      // سورت داخل مودال — قبل از اعمال
  isFilterOpen: boolean
  visibleCount: number
}

type ProductsAction =
  | { type: 'SET_TEMP_SORT'; payload: SortKey }
  | { type: 'SYNC_TEMP_SORT'; payload: SortKey }
  | { type: 'CLOSE_FILTER' }
  | { type: 'APPLY_FILTERS' }
  | { type: 'RESET_COUNT' }
  | { type: 'LOAD_MORE' }

const initialState: ProductsState = {
  tempSortBy: DEFAULT_SORT,
  isFilterOpen: false,
  visibleCount: 9,
}

function productsReducer(state: ProductsState, action: ProductsAction): ProductsState {
  switch (action.type) {
    case 'SET_TEMP_SORT': return { ...state, tempSortBy: action.payload }
    // سینک با سورتِ URL — payload از هندلر میاد چون سورت در state نیست
    case 'SYNC_TEMP_SORT': return { ...state, tempSortBy: action.payload, isFilterOpen: true }
    case 'CLOSE_FILTER': return { ...state, isFilterOpen: false }
    case 'APPLY_FILTERS': return { ...state, isFilterOpen: false }
    case 'RESET_COUNT': return { ...state, visibleCount: 9 }
    case 'LOAD_MORE': return { ...state, visibleCount: state.visibleCount + 9 }
    default: return state
  }
}

// --- سورت خالص ---
function sortProducts(products: Product[], sortBy: SortKey): Product[] {
  const sorted = [...products]
  switch (sortBy) {
    case 'expensive': return sorted.sort((a, b) => b.finalPrice - a.finalPrice)
    case 'cheap': return sorted.sort((a, b) => a.finalPrice - b.finalPrice)
    case 'most-viewed': return sorted.sort((a, b) => b.views - a.views)
    case 'best-selling': return sorted.sort((a, b) => b.sales - a.sales)
    case 'fastest-prep': return sorted.sort((a, b) => a.prepTime - b.prepTime)
    default: return sorted
  }
}

// --- گزینه‌های سورت (صادرشده — فیلترهای دسکتاپ/موبایل import می‌کنن) ---
export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'newest', label: 'جدیدترین' },
  { key: 'most-viewed', label: 'پربازدیدترین' },
  { key: 'best-selling', label: 'پرفروش‌ترین' },
  { key: 'fastest-prep', label: 'سریع‌ترین آماده‌سازی' },
  { key: 'expensive', label: 'گران‌ترین' },
  { key: 'cheap', label: 'ارزان‌ترین' },
]

// --- هوک ---
export function useProductsPage() {
  const [state, dispatch] = useReducer(productsReducer, initialState)
  const search = useSearch({ from: '/products/' })
  const navigate = useNavigate()

  // ⬅ سورت اعمال‌شده = URL — رفرش/بک/اشتراک‌گذاری حفظش می‌کنه
  const sortBy: SortKey = search.sort ?? DEFAULT_SORT

  // Mainهای فعال — گزینه‌های مرکزی + کلید یکسان با Header/MainLayout
  const { data: activeMains, isLoading: mainsLoading } = useQuery(activeMainCategoriesOptions)

  // Main فعلی — همان منطق loader سرور
  const activeMain = useMemo(
    () => resolveActiveMain(activeMains ?? [], search.tab),
    [activeMains, search.tab],
  )

  const activeMainSlug = activeMain?.slug ?? null

  // دیتا: محصولات + دسته‌های همون Main
  // (loader روت این کوئری رو با query پر کرده → SSR بدون فلیک)
  const { data: mainData, isLoading: productsLoading } = useQuery({
    ...productsByMainOptions(activeMainSlug),
    enabled: !!activeMainSlug,
    placeholderData: keepPreviousData,  // تعویض تب بدون فلیک
  })

  // ---- مشتق‌شده‌ها ----
  const products: Product[] = useMemo(() => mainData?.products ?? [], [mainData])
  const tabCategories: Category[] = useMemo(() => mainData?.categories ?? [], [mainData])

  const activeCategory: string = search.category ?? 'all'

  // فیلتر دسته + سورت
  const filteredProducts = useMemo(() => {
    let res = products
    if (activeCategory !== 'all') {
      const cat = tabCategories.find(c => c.slug === activeCategory)
      if (cat) res = res.filter(p => p.categoryId === cat.id)
    }
    return sortProducts(res, sortBy)
  }, [products, tabCategories, activeCategory, sortBy])

  const visibleProducts = useMemo(
    () => filteredProducts.slice(0, state.visibleCount),
    [filteredProducts, state.visibleCount],
  )
  const hasMore = filteredProducts.length > state.visibleCount

  // تب‌ها فقط اگه > 1 (قانون کارفرما)
  const showTabs = (activeMains ?? []).length > 1

  // ---- هندلرها ----
  const handleTabChange = useCallback((slug: string) => {
    // ...search: سورت فعلی حفظ می‌شه — سورت ذوق کاربره نه تابع تب
    navigate({ to: '/products', search: { ...search, tab: slug, category: undefined }, replace: true })
    dispatch({ type: 'RESET_COUNT' })
  }, [navigate, search])

  const handleCategoryClick = useCallback((slug: string) => {
    navigate({
      to: '/products',
      search: { ...search, category: slug !== 'all' ? slug : undefined },
      replace: true,
    })
    dispatch({ type: 'RESET_COUNT' })
  }, [navigate, search])

  const handleOpenFilter = useCallback(
    () => dispatch({ type: 'SYNC_TEMP_SORT', payload: sortBy }),
    [sortBy],
  )
  const handleCloseFilter = useCallback(() => dispatch({ type: 'CLOSE_FILTER' }), [])

  // اعمال: سورت به URL می‌ره + مودال بسته می‌شه
  const handleApplyFilters = useCallback(() => {
    navigate({ to: '/products', search: { ...search, sort: state.tempSortBy }, replace: true })
    dispatch({ type: 'APPLY_FILTERS' })
  }, [navigate, search, state.tempSortBy])

  // سورت دسکتاپ = مستقیم URL
  const handleDesktopSort = useCallback((key: SortKey) => {
    navigate({ to: '/products', search: { ...search, sort: key }, replace: true })
  }, [navigate, search])

  const handleModalSort = useCallback((key: SortKey) => dispatch({ type: 'SET_TEMP_SORT', payload: key }), [])
  const handleLoadMore = useCallback(() => dispatch({ type: 'LOAD_MORE' }), [])

  // آیتم‌های اسکرولر
  const scrollerItems = useMemo(() => [
    { id: 'all', label: 'همه', isActive: activeCategory === 'all', onClick: () => handleCategoryClick('all') },
    ...tabCategories.map((cat: Category) => ({
      id: cat.id,
      label: cat.name,
      isActive: activeCategory === cat.slug,
      onClick: () => handleCategoryClick(cat.slug),
    })),
  ], [tabCategories, activeCategory, handleCategoryClick])

  return {
    // shape قبلی حفظ شده — کامپوننت‌ها بدون تغییر کار می‌کنن
    state: { ...state, sortBy },
    activeMains: activeMains ?? [],
    activeMain,
    showTabs,
    isLoading: mainsLoading || productsLoading,
    scrollerItems,
    filteredProducts: visibleProducts,
    hasMore,
    handleTabChange,
    handleCategoryClick,
    handleOpenFilter,
    handleCloseFilter,
    handleApplyFilters,
    handleDesktopSort,
    handleModalSort,
    handleLoadMore,
  }
}