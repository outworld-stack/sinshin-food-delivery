// src/hooks/admin/useAdminOrdersPage.ts
// ⬅ NEW GENERATION: «URL as State» برای سفارشات ادمین
// (همان الگوی موفق صفحه‌ی کاربران — دسته‌ی قبل)
//
// چرا؟ نسخه قبلی page/limit/فیلترها را در reducer نگه می‌داشت:
//   ✗ رفرش = از دست رفتن فیلترها و صفحه
//   ✗ back/forward مرورگر = بی‌اثر
//   ✗ لینک عمیق قابل اشتراک نبود (مثلاً «سفارشات لغوشده، صفحه ۳»)
//   ✗ queryFn داخل همین هوک بود => loader روت نمی‌توانست prefetch کند
//
// حالا: فیلترهای اعمال‌شده = search params روت (validateSearch با zod)؛
// کوئری از فکتوری مرکزی adminOrdersOptions می‌خرد (کلید + queryFn + staleTime یکجا)؛
// reducer فقط «درَفت فیلتر داخل مودال» و وضعیت مودال را دارد.
import { useReducer, useCallback, useEffect } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { searchTextField } from '#/utils/searchSchema'
import { useAuthStore } from '#/stores/authStore'
import { adminOrdersOptions, admin2FilterOptions, courierFilterOptions } from '#/utils/queryOptions'

// --- اسکیمای search — فیلترها شهروند URL شدن ---
// catch: URL دستکاری‌شده با مقدار خراب → پیش‌فرض جایگزین، نه خطای روت
export const adminOrdersSearchSchema = z.object({
  page: z.number().int().min(1).catch(1).default(1),
  limit: z.number().int().min(5).max(100).catch(10).default(10),
  search: searchTextField,
  status: z.string().catch('all').default('all'),
  sortDate: z.string().catch('newest').default('newest'),
  sortAmount: z.string().catch('none').default('none'),
  admin2: z.string().catch('all').default('all'),
  courier: z.string().catch('all').default('all'),
})
export type AdminOrdersSearch = z.infer<typeof adminOrdersSearchSchema>

// --- State: فقط UI محلی — درَفت فیلتر مودال + وضعیت مودال ---
interface AdminOrdersUiState {
  // موقت (قبل از «اعمال فیلتر») — فقط داخل مودال/سایدبار زنده‌ست
  tempSearch: string
  tempStatus: string
  tempSortDate: string
  tempSortAmount: string
  tempAdmin2: string
  tempCourier: string
  // UI
  isFilterModalOpen: boolean
}

type AdminOrdersAction =
  | { type: 'SET_TEMP_SEARCH'; payload: string }
  | { type: 'SET_TEMP_STATUS'; payload: string }
  | { type: 'SET_TEMP_SORT_DATE'; payload: string }
  | { type: 'SET_TEMP_SORT_AMOUNT'; payload: string }
  | { type: 'SET_TEMP_ADMIN2'; payload: string }
  | { type: 'SET_TEMP_COURIER'; payload: string }
  // باز کردن مودال: درَفت‌ها با فیلترهای فعلی URL سینک می‌شن
  | { type: 'OPEN_FILTER'; payload: Pick<AdminOrdersSearch, 'search' | 'status' | 'sortDate' | 'sortAmount' | 'admin2' | 'courier'> }
  | { type: 'CLOSE_FILTER' }
  | { type: 'APPLY_FILTERS' }
  // ⬅ NEW: سینک درَفت‌ها با URL بدون باز کردن مودال —
  // برای mount اولیه (deep-link/رفرش) و back/forward؛
  // وگرنه باکس فیلتر دسکتاپ بعد از رفرش، پیش‌فرض‌ها را نشان می‌داد نه فیلترهای اعمال‌شده
  | { type: 'SYNC_FILTERS'; payload: Pick<AdminOrdersSearch, 'search' | 'status' | 'sortDate' | 'sortAmount' | 'admin2' | 'courier'> }

const initialUiState: AdminOrdersUiState = {
  tempSearch: '', tempStatus: 'all', tempSortDate: 'newest', tempSortAmount: 'none',
  tempAdmin2: 'all', tempCourier: 'all',
  isFilterModalOpen: false,
}

function adminOrdersReducer(state: AdminOrdersUiState, action: AdminOrdersAction): AdminOrdersUiState {
  switch (action.type) {
    case 'SET_TEMP_SEARCH': return { ...state, tempSearch: action.payload }
    case 'SET_TEMP_STATUS': return { ...state, tempStatus: action.payload }
    case 'SET_TEMP_SORT_DATE': return { ...state, tempSortDate: action.payload }
    case 'SET_TEMP_SORT_AMOUNT': return { ...state, tempSortAmount: action.payload }
    case 'SET_TEMP_ADMIN2': return { ...state, tempAdmin2: action.payload }
    case 'SET_TEMP_COURIER': return { ...state, tempCourier: action.payload }
    case 'OPEN_FILTER':
      // درَفت = وضعیت فعلی URL (بعد از back/refresh هم درست سینک می‌شه)
      return {
        ...state,
        isFilterModalOpen: true,
        tempSearch: action.payload.search,
        tempStatus: action.payload.status,
        tempSortDate: action.payload.sortDate,
        tempSortAmount: action.payload.sortAmount,
        tempAdmin2: action.payload.admin2,
        tempCourier: action.payload.courier,
      }
    case 'CLOSE_FILTER': return { ...state, isFilterModalOpen: false }
    // اعمال واقعی توسط navigate انجام می‌شه — اینجا فقط مودال بسته می‌شه
    case 'APPLY_FILTERS': return { ...state, isFilterModalOpen: false }
    // سینک خارجی (mount/back/forward) — مودال باز نمی‌شه
    case 'SYNC_FILTERS':
      return {
        ...state,
        tempSearch: action.payload.search,
        tempStatus: action.payload.status,
        tempSortDate: action.payload.sortDate,
        tempSortAmount: action.payload.sortAmount,
        tempAdmin2: action.payload.admin2,
        tempCourier: action.payload.courier,
      }
    default: return state
  }
}

// --- هوک ---
export function useAdminOrdersPage() {
  const [state, dispatch] = useReducer(adminOrdersReducer, initialUiState)
  const navigate = useNavigate({ from: '/admin/orders/' })
  const search = useSearch({ from: '/admin/orders/' })

  // ⬅ NEW: سینک درَفت‌ها با URL — mount اولیه (deep-link/رفرش) و back/forward.
  // بدون این، باکس فیلتر دسکتاپ بعد از رفرش پیش‌فرض‌ها را نشان می‌داد.
  // وابستگی‌ها فیلدبه‌فیلد است تا آبجکت search با هر رندر، افکت را دوباره اجرا نکند
  useEffect(() => {
    dispatch({
      type: 'SYNC_FILTERS',
      payload: {
        search: search.search, status: search.status,
        sortDate: search.sortDate, sortAmount: search.sortAmount,
        admin2: search.admin2, courier: search.courier,
      },
    })
  }, [search.search, search.status, search.sortDate, search.sortAmount, search.admin2, search.courier])

  const role = useAuthStore((s) => s.role)
  const admin2Id = useAuthStore((s) => s.admin2Id)
  const isMainAdmin = role === 'admin'

  // کوئری سفارشات — فکتوری مرکزی؛ همان کلیدی که loader روت با query پر کرده.
  // نقش هم داخل کلیده — کش ادمین اصلی و ادمین۲ جدا (دیتایشون فرق داره)
  const { data, isLoading } = useQuery(adminOrdersOptions({
    page: search.page, limit: search.limit,
    search: search.search, status: search.status,
    sortDate: search.sortDate, sortAmount: search.sortAmount,
    admin2: search.admin2, courier: search.courier,
    role, admin2Id,
  }))

  // گزینه‌های فیلتر — فقط ادمین اصلی (فکتوری: کلید + staleTime یکجا)
  const { data: admin2Options } = useQuery({
    ...admin2FilterOptions,
    enabled: isMainAdmin,
  })

  const { data: courierOptions } = useQuery({
    ...courierFilterOptions,
    enabled: isMainAdmin,
  })

  // --- هندلرها ---
  const handleTempSearch = useCallback((v: string) => dispatch({ type: 'SET_TEMP_SEARCH', payload: v }), [])
  const handleTempStatus = useCallback((v: string) => dispatch({ type: 'SET_TEMP_STATUS', payload: v }), [])
  const handleTempSortDate = useCallback((v: string) => dispatch({ type: 'SET_TEMP_SORT_DATE', payload: v }), [])
  const handleTempSortAmount = useCallback((v: string) => dispatch({ type: 'SET_TEMP_SORT_AMOUNT', payload: v }), [])
  const handleTempAdmin2 = useCallback((v: string) => dispatch({ type: 'SET_TEMP_ADMIN2', payload: v }), [])
  const handleTempCourier = useCallback((v: string) => dispatch({ type: 'SET_TEMP_COURIER', payload: v }), [])

  const handleOpenFilter = useCallback(() => {
    // درَفت با URL فعلی سینک — بعد از back/refresh هم درست است
    dispatch({
      type: 'OPEN_FILTER',
      payload: {
        search: search.search, status: search.status,
        sortDate: search.sortDate, sortAmount: search.sortAmount,
        admin2: search.admin2, courier: search.courier,
      },
    })
  }, [search])

  const handleCloseFilter = useCallback(() => dispatch({ type: 'CLOSE_FILTER' }), [])

  // اعمال: درَفت → URL (page ریست به ۱ چون نتیجه فیلتر تازه است)
  const handleApply = useCallback(() => {
    navigate({
      search: {
        ...search,
        search: state.tempSearch,
        status: state.tempStatus,
        sortDate: state.tempSortDate,
        sortAmount: state.tempSortAmount,
        admin2: state.tempAdmin2,
        courier: state.tempCourier,
        page: 1,
      },
    })
    dispatch({ type: 'APPLY_FILTERS' })
  }, [navigate, search, state.tempSearch, state.tempStatus, state.tempSortDate,
    state.tempSortAmount, state.tempAdmin2, state.tempCourier])

  // صفحه‌بندی → URL (back مرورگر = صفحه قبلی، رفرش = همان صفحه)
  const handlePage = useCallback((p: number) => {
    navigate({ search: { ...search, page: p } })
  }, [navigate, search])

  const handleLimit = useCallback((l: number) => {
    navigate({ search: { ...search, limit: l, page: 1 } })
  }, [navigate, search])

  return {
    // shape قبلی حفظ شده — کامپوننت‌ها بدون تغییر کار می‌کنن
    // page/limit دیگر از reducer نیستند؛ از URL می‌آیند (تایپ‌دار)
    state: { ...state, page: search.page, limit: search.limit },
    data, isLoading, isMainAdmin,
    admin2Options: admin2Options ?? [],
    courierOptions: courierOptions ?? [],
    handleTempSearch, handleTempStatus, handleTempSortDate, handleTempSortAmount,
    handleTempAdmin2, handleTempCourier,
    handleApply, handlePage, handleLimit,
    handleOpenFilter, handleCloseFilter,
  }
}