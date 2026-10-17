// src/hooks/site/useArticlesPage.ts

import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useReducer } from 'react'
import { useI18n } from '#/i18n'
import { articleCategoriesOptions, articlesOptions } from '#/utils/queryOptions'

// --- وضعیت: فقط UI — سورتِ اعمال‌شده از URL میاد ---
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
	| { type: 'OPEN_FILTER'; subCategory: string; sort: SortBy }
	| { type: 'SYNC_FILTERS'; subCategory: string; sort: SortBy }
	| { type: 'CLOSE_FILTER' }
	| { type: 'RESET_COUNT' }
	| { type: 'LOAD_MORE' }

const initialState: ArticlesState = {
	tempSubCategory: 'all',
	tempSortBy: DEFAULT_SORT,
	isFilterOpen: false,
	// stage-84 — ۱۲ = مضربِ ۶: در ۲ و ۳ ستونه (sm/lg) ردیف‌ها پُر می‌مانند
	visibleCount: 12,
}

function articlesReducer(
	state: ArticlesState,
	action: ArticlesAction,
): ArticlesState {
	switch (action.type) {
		case 'SET_TEMP_SUB':
			return { ...state, tempSubCategory: action.payload }
		case 'SET_TEMP_SORT':
			return { ...state, tempSortBy: action.payload }
		// APPLY فقط مودال رو می‌بنده — سورت/sub توسط پیمایش به URL رفت
		case 'APPLY_FILTERS':
			return { ...state, isFilterOpen: false, visibleCount: 12 }
		case 'OPEN_FILTER':
			return {
				...state,
				isFilterOpen: true,
				tempSubCategory: action.subCategory,
				tempSortBy: action.sort,
			}
		case 'SYNC_FILTERS':
			return {
				...initialState,
				tempSubCategory: action.subCategory,
				tempSortBy: action.sort,
			}
		case 'CLOSE_FILTER':
			return { ...state, isFilterOpen: false }
		case 'RESET_COUNT':
			return { ...state, visibleCount: 12 }
		case 'LOAD_MORE':
			return { ...state, visibleCount: state.visibleCount + 6 }
		default:
			return state
	}
}

// ═══ stage-60 — سنجاش ویژه (فلگ‌دارها جزو ۴ آیتم اول) با تصادفِ قطعی ═══
// PRNG کوچک (mulberry32) + hash رشته‌ای: seed = وضعیت فیلتر فعلی
// (دسته + زیردسته + سورت). همان فیلتر ⇒ همان جایگاه‌ها (بدون فلیک روی
// ری‌رندرها)؛ فیلتر/سورت متفاوت ⇒ جایگاه‌های تازه («جای دقیق تصادفی»).

/** FNV-1a — رشته‌ی seed را به عدد ۳۲بیتی بدون علامت می‌برد */
function hashSeed(str: string): number {
	let h = 2166136261
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i)
		h = Math.imul(h, 16777619)
	}
	return h >>> 0
}

/** mulberry32 — PRNG قطعی و سبک (همان seed ⇒ همان دنباله) */
function mulberry32(seed: number): () => number {
	let a = seed
	return () => {
		a |= 0
		a = (a + 0x6d2b79f5) | 0
		let t = Math.imul(a ^ (a >>> 15), 1 | a)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

/** Fischer-Yates با PRNG داده‌شده (کپی آرایه — ورودی دست‌نخورده) */
function shuffleWithRng<T>(arr: readonly T[], rng: () => number): T[] {
	const a = [...arr]
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1))
		;[a[i], a[j]] = [a[j], a[i]]
	}
	return a
}

/**
 * ادغام سنجاش‌ها: k=pinned.length جایگاه متمایزِ تصادفی در [0,3] انتخاب
 * می‌شود؛ سنجاش‌ها (به ترتیب shuffle) در آن جایگاه‌ها می‌نشینند و همه‌ی
 * خانه‌های دیگر (۰..۳ و پس از آن) به‌ترتیب با normal پر می‌شوند.
 *
 * stage-62 — رفع باگ لیست‌های کوتاه: قبلاً جایگاه‌ها همیشه از [0,3]
 * انتخاب می‌شدند؛ وقتی total (pinned+normal) کمتر از ۴ بود (مثلاً همه‌ی
 * آیتم‌های یک دسته‌ی کوچک فلگ‌دار باشند)، جایگاهِ ≥ total هرگز در حلقه
 * نمی‌افتاد ⇒ آن سنجاش حذف و خانه‌های میانی از normalِ تمام‌شده «undefined»
 * push می‌کردند (کرش صفحه‌ی مقالات با «reading 'profileImage'»).
 * اکنون دامنه‌ی جایگاه‌ها = min(4, total) است.
 */
function mergePinnedIntoSlots<T>(
	normal: readonly T[],
	pinned: readonly T[],
	rng: () => number,
): T[] {
	if (pinned.length === 0) return [...normal]
	const total = pinned.length + normal.length
	const slotRange = Math.min(4, total)
	const slots: number[] = []
	while (slots.length < pinned.length) {
		const s = Math.floor(rng() * slotRange)
		if (!slots.includes(s)) slots.push(s)
	}
	const merged: T[] = []
	let ni = 0
	for (let i = 0; i < total; i++) {
		const slotIdx = slots.indexOf(i)
		merged.push(slotIdx !== -1 ? pinned[slotIdx] : normal[ni++])
	}
	return merged
}

// --- هوک ---
export function useArticlesPage() {
	const navigate = useNavigate()
	const search = useSearch({ from: '/articles/' })
	const { t } = useI18n()

	// از URL — منبع حقیقت
	const category: string = search.category ?? 'all'
	const subCategory: string = search.subCategory ?? 'all'
	// ⬅ سورت اعمال‌شده = URL (قبلاً کاهنده بود — با رفرش گم می‌شد)
	const appliedSortBy: SortBy = search.sort ?? DEFAULT_SORT
	const [state, dispatch] = useReducer(articlesReducer, {
		...initialState,
		tempSubCategory: subCategory,
		tempSortBy: appliedSortBy,
	})

	// Shared URLs, category changes and history navigation reset the mobile draft.
	useEffect(() => {
		dispatch({ type: 'SYNC_FILTERS', subCategory, sort: appliedSortBy })
	}, [category, subCategory, appliedSortBy])

	// --- دیتا: گزینه‌های مرکزی — loader روت با کوئری پرشون کرده ---
	const { data: categories } = useQuery({
		...articleCategoriesOptions,
		throwOnError: true,
	})
	const { data: articles, isLoading } = useQuery({
		...articlesOptions(category, subCategory),
		throwOnError: true,
	})
	// stage-60 — لیست کامل (بدون فیلتر): مقاله‌های ویژه «فارغ از» دسته/
	// زیردسته‌ی فعال باید در ۴ آیتم اول دیده شوند؛ وقتی خود کاربر روی all
	// است، همان کلید قبلی است و فچ اضافه‌ای نمی‌شود (staleTime یکسان ۶۰s)
	const { data: allArticles } = useQuery({
		...articlesOptions('all', 'all'),
		throwOnError: true,
	})

	// --- مشتق‌شده‌ها ---
	const currentCategory = useMemo(
		() => categories?.find((c) => c.slug === category),
		[categories, category],
	)
	const subCategories = useMemo(
		() => currentCategory?.subCategories ?? [],
		[currentCategory],
	)
	const hasSubCategories = subCategories.length > 0

	// stage-60 — سنجاش ویژه: فلگ‌دارها از «کل» لیست مقالات (فارغ از فیلتر
	// دسته/زیردسته) تا ۴ مورد در جایگاه‌های تصادفی ۰..۳؛ بقیه‌ی فلگ‌دارها
	// (بیش از ۴) مثل آیتم‌های عادی در جریان فیلتر + سورت می‌مانند.
	const sortedArticles = useMemo(() => {
		const rng = mulberry32(
			hashSeed(`${category}|${subCategory}|${appliedSortBy}`),
		)
		const flagged = (allArticles ?? []).filter((a) => a.isFeatured === true)
		const pinned = shuffleWithRng(flagged, rng).slice(0, 4)
		const pinnedIds = new Set(pinned.map((a) => a.id))
		const normal = (articles ?? []).filter((a) => !pinnedIds.has(a.id))
		if (appliedSortBy === 'most-viewed') {
			normal.sort((a, b) => b.views - a.views)
		}
		return mergePinnedIntoSlots(normal, pinned, rng)
	}, [articles, allArticles, category, subCategory, appliedSortBy])

	const visibleArticles = useMemo(
		() => sortedArticles.slice(0, state.visibleCount),
		[sortedArticles, state.visibleCount],
	)
	const hasMore = sortedArticles.length > state.visibleCount

	// --- هندلرها (useCallback) ---
	const handleCategoryClick = useCallback(
		(slug: string) => {
			navigate({
				to: '/articles',
				search: {
					...search,
					category: slug !== 'all' ? slug : undefined,
					subCategory: undefined,
				},
				replace: true,
			})
			dispatch({ type: 'RESET_COUNT' })
		},
		[navigate, search],
	)

	// اعمال: sub + سورت با هم به URL
	const handleApplyFilters = useCallback(() => {
		navigate({
			to: '/articles',
			search: {
				...search,
				subCategory:
					state.tempSubCategory !== 'all' ? state.tempSubCategory : undefined,
				sort: state.tempSortBy !== DEFAULT_SORT ? state.tempSortBy : undefined,
			},
			replace: true,
		})
		dispatch({ type: 'APPLY_FILTERS' })
	}, [navigate, search, state.tempSubCategory, state.tempSortBy])

	const handleOpenFilter = useCallback(() => {
		dispatch({ type: 'OPEN_FILTER', subCategory, sort: appliedSortBy })
	}, [subCategory, appliedSortBy])

	// Desktop controls apply immediately; only the mobile sheet uses a draft.
	const handleSubCategoryChange = useCallback(
		(slug: string) => {
			navigate({
				to: '/articles',
				search: { ...search, subCategory: slug !== 'all' ? slug : undefined },
				replace: true,
			})
			dispatch({ type: 'RESET_COUNT' })
		},
		[navigate, search],
	)
	const handleSortChange = useCallback(
		(sort: SortBy) => {
			navigate({
				to: '/articles',
				search: { ...search, sort: sort !== DEFAULT_SORT ? sort : undefined },
				replace: true,
			})
			dispatch({ type: 'RESET_COUNT' })
		},
		[navigate, search],
	)

	const handleCloseFilter = useCallback(
		() => dispatch({ type: 'CLOSE_FILTER' }),
		[],
	)
	const handleTempSub = useCallback(
		(v: string) => dispatch({ type: 'SET_TEMP_SUB', payload: v }),
		[],
	)
	const handleTempSort = useCallback(
		(v: SortBy) => dispatch({ type: 'SET_TEMP_SORT', payload: v }),
		[],
	)
	const handleLoadMore = useCallback(() => dispatch({ type: 'LOAD_MORE' }), [])

	// آیتم‌های اسکرولر
	const scrollerItems = useMemo(
		() => [
			{
				id: 'all',
				label: t['common.all'],
				isActive: category === 'all',
				onClick: () => handleCategoryClick('all'),
			},
			...(categories ?? []).map((cat) => ({
				id: cat.id,
				label: cat.name,
				isActive: category === cat.slug,
				onClick: () => handleCategoryClick(cat.slug),
			})),
		],
		[categories, category, handleCategoryClick, t],
	)

	return {
		// ساختار قبلی حفظ شده — appliedSortBy هم مثل قبل داخل وضعیت
		state: { ...state, appliedSortBy },
		isLoading,
		hasSubCategories,
		subCategories,
		subCategory,
		visibleArticles,
		hasMore,
		scrollerItems,
		handleCategoryClick,
		handleApplyFilters,
		handleOpenFilter,
		handleCloseFilter,
		handleTempSub,
		handleTempSort,
		handleSubCategoryChange,
		handleSortChange,
		handleLoadMore,
	}
}
