// ═══════════════════════════════════════════════════════════════
// round-43 — sinshin-food-delivery — فایل 11 از 14
// مسیر مقصد: apps/web/src/hooks/admin/useAdminUsersPage.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty-eight
// ═══════════════════════════════════════════════════════════════

// src/hooks/admin/useAdminUsersPage.ts
// ⬅ نسل جدید: «URL به‌عنوان وضعیت» برای لیست ادمین
//
// چرا؟ نسخه قبلی page/limit/فیلترها را در کاهنده نگه می‌داشت:
//   ✗ رفرش = از دست رفتن فیلترها و صفحه
//   ✗ back/forward مرورگر = بی‌اثر
//   ✗ لینک عمیق قابل اشتراک نبود
//   ✗ الگوی temp/applied دوباره‌کاری بود که URL خودش رایگان می‌دهد
//
// حالا: فیلترهای اعمال‌شده = search params روت (validateSearch با zod).
// کاهنده فقط «درَفت فیلتر داخل مودال» و وضعیت مودال‌ها را دارد.
// نتیجه: loader روت همان فیلترها را می‌بیند (loaderDeps) => پیش‌واکشی روی هاور.
import { useReducer, useCallback, useEffect } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { searchTextField } from '#/utils/searchSchema'
import { toggleUserStatus } from '#/server/admin'
import { useToastStore } from '#/stores/toastStore'
import { usePermissions } from '#/hooks/admin/usePermissions'
import { adminUsersOptions } from '#/utils/queryOptions'
import type { AdminUsersData } from '@sinshin/shared'
import { qk } from '#/utils/queryKeys'
import type { AmountSortDir, UserSortDir } from '#/utils/queryOptions'

// --- اسکیمای search — شهروند URL شدن فیلترها ---
// catch: اگر کاربر URL را دستکاری کرد و مقدار خراب بود، به‌جای خطای روت
// مقدار پیش‌فرض جایگزین می‌شه (رفتار مقاوم TanStack Router + zod)
export const adminUsersSearchSchema = z.object({
  page: z.number().int().min(1).catch(1).default(1),
  limit: z.number().int().min(5).max(100).catch(10).default(10),
  search: searchTextField,
  device: z.string().catch('all').default('all'),
  status: z.string().catch('all').default('all'),
  // رارد ۴۷ — enum شدند (قبلاً رشته‌ی آزاد): مقدار زباله در URL حالا
  // به پیش‌فرض برمی‌گردد، نه اینکه بی‌صدا صعودی (asc) شود
  sortDate: z.enum(['newest', 'oldest', 'none']).catch('newest').default('newest'),
  sortWallet: z.enum(['highest', 'lowest', 'none']).catch('none').default('none'),
  sortSpent: z.enum(['highest', 'lowest', 'none']).catch('none').default('none'),
})
export type AdminUsersSearch = z.infer<typeof adminUsersSearchSchema>

// --- وضعیت: فقط UI محلی — درَفت فیلتر مودال + وضعیت مودال‌ها ---
interface AdminUsersUiState {
  // موقت (قبل از «اعمال فیلتر») — فقط داخل مودال/سایدبار زنده‌ست
  tempSearch: string
  tempDevice: string
  tempStatus: string
  tempSortDate: UserSortDir
  tempSortWallet: AmountSortDir
  tempSortSpent: AmountSortDir
  // رابط کاربری
  isFilterModalOpen: boolean
  // مودال مسدودسازی
  confirmToggle: { id: string; status: string } | null
}

type AdminUsersAction =
  | { type: 'SET_TEMP_SEARCH'; payload: string }
  | { type: 'SET_TEMP_DEVICE'; payload: string }
  | { type: 'SET_TEMP_STATUS'; payload: string }
  | { type: 'SET_TEMP_SORT_DATE'; payload: UserSortDir }
  | { type: 'SET_TEMP_SORT_WALLET'; payload: AmountSortDir }
  | { type: 'SET_TEMP_SORT_SPENT'; payload: AmountSortDir }
  // باز کردن مودال: درَفت‌ها با فیلترهای فعلی URL سینک می‌شن
  | { type: 'OPEN_FILTER'; payload: Pick<AdminUsersSearch, 'search' | 'device' | 'status' | 'sortDate' | 'sortWallet' | 'sortSpent'> }
  | { type: 'CLOSE_FILTER' }
  | { type: 'APPLY_FILTERS' }
  // ⬅ NEW: سینک درَفت‌ها با URL بدون باز کردن مودال —
  // برای سوار شدن اولیه (deep-link/رفرش) و back/forward؛
  // وگرنه باکس فیلتر دسکتاپ بعد از رفرش، پیش‌فرض‌ها را نشان می‌داد نه فیلترهای اعمال‌شده
  | { type: 'SYNC_FILTERS'; payload: Pick<AdminUsersSearch, 'search' | 'device' | 'status' | 'sortDate' | 'sortWallet' | 'sortSpent'> }
  | { type: 'REQUEST_TOGGLE'; payload: { id: string; status: string } }
  | { type: 'CLEAR_TOGGLE' }

const initialUiState: AdminUsersUiState = {
  tempSearch: '', tempDevice: 'all', tempStatus: 'all',
  tempSortDate: 'newest', tempSortWallet: 'none', tempSortSpent: 'none',
  isFilterModalOpen: false,
  confirmToggle: null,
}

function adminUsersReducer(state: AdminUsersUiState, action: AdminUsersAction): AdminUsersUiState {
  switch (action.type) {
    case 'SET_TEMP_SEARCH': return { ...state, tempSearch: action.payload }
    case 'SET_TEMP_DEVICE': return { ...state, tempDevice: action.payload }
    case 'SET_TEMP_STATUS': return { ...state, tempStatus: action.payload }
    case 'SET_TEMP_SORT_DATE': return { ...state, tempSortDate: action.payload }
    case 'SET_TEMP_SORT_WALLET': return { ...state, tempSortWallet: action.payload }
    case 'SET_TEMP_SORT_SPENT': return { ...state, tempSortSpent: action.payload }
    case 'OPEN_FILTER':
      // درَفت = وضعیت فعلی URL (بعد از back/refresh هم درست سینک می‌شه)
      return {
        ...state,
        isFilterModalOpen: true,
        tempSearch: action.payload.search,
        tempDevice: action.payload.device,
        tempStatus: action.payload.status,
        tempSortDate: action.payload.sortDate,
        tempSortWallet: action.payload.sortWallet,
        tempSortSpent: action.payload.sortSpent,
      }
    case 'CLOSE_FILTER': return { ...state, isFilterModalOpen: false }
    // اعمال واقعی توسط پیمایش انجام می‌شه — اینجا فقط مودال بسته می‌شه
    case 'APPLY_FILTERS': return { ...state, isFilterModalOpen: false }
    // ⬅ NEW: سینک خارجی (سوار شدن/back/forward) — مودال باز نمی‌شه
    case 'SYNC_FILTERS':
      return {
        ...state,
        tempSearch: action.payload.search,
        tempDevice: action.payload.device,
        tempStatus: action.payload.status,
        tempSortDate: action.payload.sortDate,
        tempSortWallet: action.payload.sortWallet,
        tempSortSpent: action.payload.sortSpent,
      }
    case 'REQUEST_TOGGLE': return { ...state, confirmToggle: action.payload }
    case 'CLEAR_TOGGLE': return { ...state, confirmToggle: null }
    default: return state
  }
}

// --- هوک ---
export function useAdminUsersPage() {
  const [state, dispatch] = useReducer(adminUsersReducer, initialUiState)
  const navigate = useNavigate({ from: '/admin/users/' })
  const search = useSearch({ from: '/admin/users/' })
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.showToast)
  const { permissions, isChecking } = usePermissions()

  // ⬅ NEW: سینک درَفت‌ها با URL — سوار شدن اولیه (deep-link/رفرش) و back/forward.
  // بدون این، باکس فیلتر دسکتاپ بعد از رفرش پیش‌فرض‌ها را نشان می‌داد.
  // وابستگی‌ها فیلدبه‌فیلد است تا آبجکت search با هر رندر، افکت را دوباره اجرا نکند
  useEffect(() => {
    dispatch({
      type: 'SYNC_FILTERS',
      payload: {
        search: search.search, device: search.device, status: search.status,
        sortDate: search.sortDate, sortWallet: search.sortWallet, sortSpent: search.sortSpent,
      },
    })
  }, [search.search, search.device, search.status,
    search.sortDate, search.sortWallet, search.sortSpent])

  // کوئری — فکتوری مرکزی؛ همان کلیدی که loader روت با کوئری پر کرده.
  // preload-on-intent (هاور روی «کاربران» در سایدبار) => ناوبری آنی
  const { data, isLoading } = useQuery(adminUsersOptions({
    page: search.page, limit: search.limit,
    search: search.search, device: search.device, status: search.status,
    sortDate: search.sortDate, sortWallet: search.sortWallet, sortSpent: search.sortSpent,
  }))

  // مسدودسازی — ⬅ NEW: آپدیت اپتیمیستیک با بازگردانی
  // قبلاً: کلیک → انتظار سرور → نامعتبرسازی → رفرش.
  // حالا: کلیک → همان لحظه دکمه عوض می‌شه → سرور تأیید می‌کنه؛
  // اگر خطا شد، تصویر لحظه‌ای برمی‌گرده (و MutationCache سراسری پیام شناور می‌دهد)
  const toggleMutation = useMutation({
    mutationFn: (userId: string) => toggleUserStatus({ data: { userId } }),
    onMutate: async (userId) => {
      // ریفچ‌های در جریانِ همین لیست را متوقف کن تا تصویر لحظه‌ای تمیز باشد
      await queryClient.cancelQueries({ queryKey: qk.adminUsersAll })

      // تصویر لحظه‌ای همه‌ی صفحات فیلترشده (پریفکس)
      const previous = queryClient.getQueriesData<AdminUsersData>({ queryKey: qk.adminUsersAll })

      // آپدیت اپتیمیستیک در همه‌ی کلیدهای فعال
      queryClient.setQueriesData<AdminUsersData>({ queryKey: qk.adminUsersAll }, (old) => {
        if (!old) return old
        return {
          ...old,
          users: old.users.map(u =>
            u.id === userId
              // round-11 (اسکن L-1): واژگان پلتفرم SUSPENDED است (فیلتر/سرور) —
              // BLOCKED فقط لحظه‌ای ناسازگار بود.
              ? { ...u, status: u.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' }
              : u,
          ),
        }
      })

      return { previous }
    },
    onError: (_err, _userId, ctx) => {
      // بازگردانی — کش به تصویر لحظه‌ایِ قبل از کلیک برمی‌گردد
      if (ctx?.previous) {
        for (const [key, snapshot] of ctx.previous) {
          queryClient.setQueryData(key, snapshot)
        }
      }
    },
    onSuccess: () => {
      showToast('وضعیت کاربر با موفقیت تغییر کرد')
      dispatch({ type: 'CLEAR_TOGGLE' })
    },
    onSettled: () => {
      // در هر صورت (موفق/ناموفق) با سرور هم‌تراز شو — منبع حقیقت
      queryClient.invalidateQueries({ queryKey: qk.adminUsersAll })
    },
  })

  // --- هندلرها ---
  const handleTempSearch = useCallback((v: string) => dispatch({ type: 'SET_TEMP_SEARCH', payload: v }), [])
  const handleTempDevice = useCallback((v: string) => dispatch({ type: 'SET_TEMP_DEVICE', payload: v }), [])
  const handleTempStatus = useCallback((v: string) => dispatch({ type: 'SET_TEMP_STATUS', payload: v }), [])
  const handleTempSortDate = useCallback((v: UserSortDir) => dispatch({ type: 'SET_TEMP_SORT_DATE', payload: v }), [])
  const handleTempSortWallet = useCallback((v: AmountSortDir) => dispatch({ type: 'SET_TEMP_SORT_WALLET', payload: v }), [])
  const handleTempSortSpent = useCallback((v: AmountSortDir) => dispatch({ type: 'SET_TEMP_SORT_SPENT', payload: v }), [])

  const handleOpenFilter = useCallback(() => {
    // درَفت با URL فعلی سینک — بعد از back/refresh هم درست است
    dispatch({
      type: 'OPEN_FILTER',
      payload: {
        search: search.search, device: search.device, status: search.status,
        sortDate: search.sortDate, sortWallet: search.sortWallet, sortSpent: search.sortSpent,
      },
    })
  }, [search])

  const handleCloseFilter = useCallback(() => dispatch({ type: 'CLOSE_FILTER' }), [])

  // اعمال: درَفت → URL (page ریست به ۱ چون نتیجه فیلتر تازه است)
  const handleApplyFilters = useCallback(() => {
    navigate({
      search: {
        ...search,
        search: state.tempSearch,
        device: state.tempDevice,
        status: state.tempStatus,
        sortDate: state.tempSortDate,
        sortWallet: state.tempSortWallet,
        sortSpent: state.tempSortSpent,
        page: 1,
      },
    })
    dispatch({ type: 'APPLY_FILTERS' })
  }, [navigate, search, state.tempSearch, state.tempDevice, state.tempStatus,
    state.tempSortDate, state.tempSortWallet, state.tempSortSpent])

  // صفحه‌بندی → URL (back مرورگر = صفحه قبلی، رفرش = همان صفحه)
  const handlePage = useCallback((p: number) => {
    navigate({ search: { ...search, page: p } })
  }, [navigate, search])

  const handleLimit = useCallback((l: number) => {
    navigate({ search: { ...search, limit: l, page: 1 } })
  }, [navigate, search])

  const handleRequestToggle = useCallback((id: string, status: string) => {
    dispatch({ type: 'REQUEST_TOGGLE', payload: { id, status } })
  }, [])

  const handleConfirmToggle = useCallback(() => {
    if (state.confirmToggle) toggleMutation.mutate(state.confirmToggle.id)
  }, [state.confirmToggle, toggleMutation])

  const handleCancelToggle = useCallback(() => dispatch({ type: 'CLEAR_TOGGLE' }), [])

  return {
    // ساختار قبلی حفظ شده — کامپوننت‌ها بدون تغییر کار می‌کنن
    // page/limit دیگر از کاهنده نیستند؛ از URL می‌آیند (تایپ‌دار)
    state: { ...state, page: search.page, limit: search.limit },
    data, isLoading, permissions, isChecking,
    toggleMutation,
    handleTempSearch, handleTempDevice, handleTempStatus,
    handleTempSortDate, handleTempSortWallet, handleTempSortSpent,
    handleApplyFilters, handlePage, handleLimit,
    handleOpenFilter, handleCloseFilter,
    handleRequestToggle, handleConfirmToggle, handleCancelToggle,
  }
}