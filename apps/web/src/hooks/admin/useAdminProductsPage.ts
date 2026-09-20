// src/hooks/admin/useAdminProductsPage.ts
// ⬅ NEW GENERATION: «URL as State» برای محصولات ادمین
// (همان الگوی موفق کاربران/سفارشات — با یک تفاوت مهم: جستجوی instant)
//
// چرا؟ نسخه قبلی page/limit/فیلترها را در reducer نگه می‌داشت:
//   ✗ رفرش = از دست رفتن فیلترها و صفحه
//   ✗ back/forward مرورگر = بی‌اثر
//   ✗ queryFn داخل همین هوک بود => loader روت نمی‌توانست prefetch کند
//
// تفاوت این صفحه: فیلترها instant اعمال می‌شوند (بدون دکمه‌ی «اعمال»).
// الگوی URL-state برای تایپ پیوسته دو قانون اضافه دارد:
//   ۱) debounce 300ms — نهتنها بهتر از قبل است (قبلاً هر کلید = یک fetch)،
//      بلکه از تحریک loader روت به ازای هر کلید جلوگیری می‌کند
//      (search عمداً در loaderDeps نیست — تایپ هرگز pendingComponent/اسکلتون نمی‌سازد)
//   ۲) replace: true — تایپ، history مرورگر را پر نمی‌کند؛ back دکمه‌ی معنی‌دار می‌ماند
import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { searchTextField } from '#/utils/searchSchema'
import { toggleProductStatus, type Product } from '#/server/products'
import { useToastStore } from '#/stores/toastStore'
import { usePermissions } from '#/hooks/admin/usePermissions'
import { adminProductsOptions, adminCategoriesOptions } from '#/utils/queryOptions'
import { qk } from '#/utils/queryKeys'

// --- اسکیمای search — فیلترها شهروند URL شدن ---
// catch: URL دستکاری‌شده با مقدار خراب → پیش‌فرض جایگزین، نه خطای روت
// (limit پیش‌فرض ۵ — همان رفتار قبلی این صفحه)
export const adminProductsSearchSchema = z.object({
  page: z.number().int().min(1).catch(1).default(1),
  limit: z.number().int().min(5).max(100).catch(5).default(5),
  search: searchTextField,
  status: z.string().catch('all').default('all'),
  categoryId: z.string().catch('all').default('all'),
})
export type AdminProductsSearch = z.infer<typeof adminProductsSearchSchema>

// ردیف دیتای لیست — مشترک بین سرور و optimistic update
export interface AdminProductsData {
  products: Product[]
  total: number
}

// --- هوک ---
export function useAdminProductsPage() {
  const navigate = useNavigate({ from: '/admin/products/' })
  const search = useSearch({ from: '/admin/products/' })
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.showToast)
  const { permissions, isChecking } = usePermissions()

  // درَفت جستجو — ورودی فوری (input هرگز منتظر URL نمی‌ماند)؛
  // با debounce به URL می‌رود و از URL هم سینک می‌شود (back/refresh/لینک اشتراکی)
  const [tempSearch, setTempSearch] = useState(search.search)
  const [confirmToggle, setConfirmToggle] = useState<{ id: string; status: string } | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // سینک درَفت با URL — برای back/forward و mount اولیه با search param
  useEffect(() => {
    setTempSearch(search.search)
  }, [search.search])

  // پاک‌سازی تایمر debounce در unmount (نباید بعد از خروج navigate کند)
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
  }, [])

  // کتگوری‌ها — فکتوری مشترک با فرم محصول/کوپن (staleTime ۶۰s یکجا)
  const { data: catData } = useQuery(adminCategoriesOptions)

  // کوئری محصولات — فکتوری مرکزی؛ همان کلیدی که loader روت با query پر کرده.
  // placeholderData داخل فکتوری: تایپ/تعویض صفحه بدون فلیک اسکلتون
  const { data, isLoading } = useQuery(adminProductsOptions({
    page: search.page, limit: search.limit,
    search: search.search, status: search.status, categoryId: search.categoryId,
  }))

  // فعال/غیرفعال کردن — ⬅ NEW: آپدیت اپتیمیستیک با rollback
  // قبلاً: کلیک → انتظار سرور → invalidate → رفرش.
  // حالا: کلیک → همان لحظه کلید وضعیت عوض می‌شه → سرور تأیید می‌کنه؛
  // اگر خطا شد، snapshot برمی‌گرده (و MutationCache سراسری toast می‌دهد)
  const toggleMutation = useMutation({
    mutationFn: (id: string) => toggleProductStatus({ data: { id } }),
    onMutate: async (id) => {
      // ریفچ‌های در جریانِ همین لیست را متوقف کن تا snapshot تمیز باشد
      await queryClient.cancelQueries({ queryKey: qk.adminProductsAll })

      // snapshot همه‌ی فیلترها/صفحات (پریفکس)
      const previous = queryClient.getQueriesData<AdminProductsData>({ queryKey: qk.adminProductsAll })

      // آپدیت اپتیمیستیک در همه‌ی کلیدهای فعال
      queryClient.setQueriesData<AdminProductsData>({ queryKey: qk.adminProductsAll }, (old) => {
        if (!old) return old
        return {
          ...old,
          products: old.products.map(p =>
            p.id === id
              ? { ...p, status: p.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }
              : p,
          ),
        }
      })

      return { previous }
    },
    onError: (_err, _id, ctx) => {
      // rollback — کش به snapshot قبل از کلیک برمی‌گردد
      if (ctx?.previous) {
        for (const [key, snapshot] of ctx.previous) {
          queryClient.setQueryData(key, snapshot)
        }
      }
    },
    onSuccess: () => {
      showToast('وضعیت محصول تغییر کرد')
      setConfirmToggle(null)
    },
    onSettled: () => {
      // در هر صورت (موفق/ناموفق) با سرور هم‌تراز شو — منبع حقیقت
      queryClient.invalidateQueries({ queryKey: qk.adminProductsAll })
      // phase-3: وضعیت عمومی محصول عوض شد — منو و جزئیات عمومی هم تازه شوند
      queryClient.invalidateQueries({ queryKey: qk.productsByMainPrefix })
      queryClient.invalidateQueries({ queryKey: qk.productByIdAll })
    },
  })

  // مشتق‌شده‌ها
  const products = data?.products ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / search.limit)
  const categories = useMemo(() => catData ?? [], [catData])

  // --- هندلرها ---
  // جستجو — instant با debounce + replace:
  // هر کلید fetch نمی‌سازد (بهتر از قبل) و history را هم شلوغ نمی‌کند
  const handleSearch = useCallback((v: string) => {
    setTempSearch(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      // فرم تابعی search — بدون stale closure؛ page ریست چون نتیجه‌ی تازه است
      navigate({ search: (prev) => ({ ...prev, search: v, page: 1 }), replace: true })
    }, 300)
  }, [navigate])

  // وضعیت/دسته — تعویض گسسته‌ی سلکت؛ مستقیم به URL (back = برگشت فیلتر)
  const handleStatus = useCallback((v: string) => {
    navigate({ search: { ...search, status: v, page: 1 } })
  }, [navigate, search])

  const handleCategory = useCallback((v: string) => {
    navigate({ search: { ...search, categoryId: v, page: 1 } })
  }, [navigate, search])

  // صفحه‌بندی → URL (back مرورگر = صفحه قبلی، رفرش = همان صفحه)
  const handlePage = useCallback((p: number) => {
    navigate({ search: { ...search, page: p } })
  }, [navigate, search])

  const handleLimit = useCallback((l: number) => {
    navigate({ search: { ...search, limit: l, page: 1 } })
  }, [navigate, search])

  const handleRequestToggle = useCallback((id: string, status: string) => {
    setConfirmToggle({ id, status })
  }, [])

  const handleConfirmToggle = useCallback(() => {
    if (confirmToggle) toggleMutation.mutate(confirmToggle.id)
  }, [confirmToggle, toggleMutation])

  const handleCancelToggle = useCallback(() => setConfirmToggle(null), [])

  return {
    // shape قبلی حفظ شده — کامپوننت‌ها بدون تغییر کار می‌کنن
    // status/categoryId/page/limit از URL می‌آیند (تایپ‌دار)؛
    // search = درَفت محلیِ سینک‌شده با URL (ورودی هرگز از تایپ عقب نمی‌افتد)
    state: {
      search: tempSearch,
      status: search.status,
      categoryId: search.categoryId,
      page: search.page,
      limit: search.limit,
      confirmToggle,
    },
    data, isLoading, permissions, isChecking,
    products, total, totalPages, categories,
    handleSearch, handleStatus, handleCategory,
    handlePage, handleLimit,
    handleRequestToggle, handleConfirmToggle, handleCancelToggle,
  }
}