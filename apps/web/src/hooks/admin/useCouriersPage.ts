// src/hooks/admin/useCouriersPage.ts
// ⬅ NEW GENERATION: «URL as State» برای پیک‌ها
// (همان الگوی موفق صفحات کاربران/سفارشات)
//
// چرا؟ نسخه قبلی همه‌چیز را در reducer نگه می‌داشت:
//   ✗ رفرش = از دست رفتن بازه تاریخ و صفحه
//   ✗ back/forward مرورگر = بی‌اثر
//   ✗ بازه‌ی گزارش قابل اشتراک‌گذاری نبود (مهم‌ترین فیلد این صفحه!)
//   ✗ queryFn داخل همین هوک بود => loader روت نمی‌توانست prefetch کند
//
// حالا: همه‌ی فیلترها = search params روت (validateSearch با zod).
// نکته‌ی UX: تاریخ‌ها مستقیم به URL می‌روند (دیت‌پیکر تعویض گسسته دارد،
// نه تایپ پیوسته)؛ فقط جستجو تا دکمه‌ی «اعمال» درَفت می‌ماند.
import { useState, useCallback, useMemo } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { searchTextField } from '#/utils/searchSchema'
import { adminCouriersOptions } from '#/utils/queryOptions'

// --- اسکیمای search — بازه تاریخ + جستجو + صفحه‌بندی، همه در URL ---
// catch: URL دستکاری‌شده با مقدار خراب → پیش‌فرض جایگزین، نه خطای روت
export const adminCouriersSearchSchema = z.object({
  page: z.number().int().min(1).catch(1).default(1),
  limit: z.number().int().min(5).max(100).catch(10).default(10),
  search: searchTextField,
  dateFrom: z.string().catch('').default(''),
  dateTo: z.string().catch('').default(''),
})
export type AdminCouriersSearch = z.infer<typeof adminCouriersSearchSchema>

// --- هوک ---
// فقط یک درَفت محلی باقی مانده (جستجو) — reducer حذف شد؛ useState کفایت می‌کند
export function useCouriersPage() {
  // درَفت جستجو — تا وقتی «اعمال» نشده فچی در کار نیست
  const [tempSearch, setTempSearch] = useState('')

  const navigate = useNavigate({ from: '/admin/couriers/' })
  const search = useSearch({ from: '/admin/couriers/' })

  // کوئری — فکتوری مرکزی؛ همان کلیدی که loader روت با query پر کرده.
  // placeholderData داخل فکتوری: تعویض صفحه/بازه بدون فلیک اسکلتون
  const { data, isLoading } = useQuery(adminCouriersOptions({
    page: search.page, limit: search.limit,
    search: search.search, dateFrom: search.dateFrom, dateTo: search.dateTo,
  }))

  // آمار مشتق — مجموع تحویل‌ها و درآمد
  const stats = useMemo(() => {
    const couriers = data?.couriers ?? []
    const allDeliveries = couriers.flatMap(c => c.trips.flatMap(t => t.deliveries))
    const totalDeliveries = allDeliveries.length
    const totalAmount = allDeliveries.reduce((s, d) => s + d.amount, 0)
    const totalTrips = couriers.reduce((s, c) => s + c.trips.length, 0)
    return { totalDeliveries, totalAmount, totalTrips }
  }, [data])

  // --- هندلرها ---
  const handleSearchChange = useCallback((v: string) => setTempSearch(v), [])

  // تاریخ‌ها مستقیم به URL — تغییر گسسته‌ی دیت‌پیکر؛ page ریست چون بازه‌ی تازه
  const handleDateFrom = useCallback((v: string) => {
    navigate({ search: { ...search, dateFrom: v, page: 1 } })
  }, [navigate, search])

  const handleDateTo = useCallback((v: string) => {
    navigate({ search: { ...search, dateTo: v, page: 1 } })
  }, [navigate, search])

  // اعمال: درَفت جستجو → URL
  const handleApply = useCallback(() => {
    navigate({ search: { ...search, search: tempSearch, page: 1 } })
  }, [navigate, search, tempSearch])

  // پاک‌سازی: همه‌چیز به پیش‌فرض اسکیما (limit کاربر حفظ می‌شود)
  const handleReset = useCallback(() => {
    setTempSearch('')
    navigate({ search: { page: 1, limit: search.limit, search: '', dateFrom: '', dateTo: '' } })
  }, [navigate, search.limit])

  const handlePage = useCallback((p: number) => {
    navigate({ search: { ...search, page: p } })
  }, [navigate, search])

  const handleLimit = useCallback((l: number) => {
    navigate({ search: { ...search, limit: l, page: 1 } })
  }, [navigate, search])

  return {
    // shape قبلی حفظ شده — کامپوننت‌ها بدون تغییر کار می‌کنن
    // dateFrom/dateTo/page/limit دیگر از reducer نیستند؛ از URL می‌آیند (تایپ‌دار)
    state: { tempSearch, dateFrom: search.dateFrom, dateTo: search.dateTo, page: search.page, limit: search.limit },
    data, isLoading, stats,
    handleSearchChange, handleDateFrom, handleDateTo,
    handleApply, handleReset, handlePage, handleLimit,
  }
}