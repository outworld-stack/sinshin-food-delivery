// src/hooks/dashboard/useWalletPage.ts
// ⬅ NEW GENERATION: «URL as State» برای کیف پول
// (همان الگوی موفق صفحات ادمین — کاربران/سفارشات/پیک‌ها)
//
// چرا؟ نسخه قبلی سورت و صفحه‌بندیِ «دو لیست» را در reducer نگه می‌داشت:
//   ✗ رفرش = برگشت به صفحه ۱ و سورت پیش‌فرض
//   ✗ back/forward مرورگر = بی‌اثر
//   ✗ «تراکنش‌های ورودی، صفحه ۲» قابل اشتراک‌گذاری نبود
//
// حالا: هر ۵ فیلد (سورت + ۲ صفحه + ۲ تعداد) = search params روت.
// دو لیست مستقل (تراکنش/زیرمجموعه) → دو گروه جدا در URL.
// reducer حذف شد؛ URL منبع حقیقت است.
import { useCallback, useMemo } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { z } from 'zod'
import { pageField, limitField } from '#/utils/searchSchema'
import type { TransactionSort, ReferralRow, TransactionRowData } from '#/types/dashboard/wallet'

// --- اسکیمای search — سورت و صفحه‌بندی هر دو لیست، همه در URL ---
// catch: URL دستکاری‌شده با مقدار خراب → پیش‌فرض جایگزین، نه خطای روت
export const walletSearchSchema = z.object({
  txSort: z.enum(['newest', 'oldest', 'highest', 'lowest', 'income', 'expense'])
    .catch('newest').default('newest'),
  txPage: pageField,
  txLimit: limitField(5),
  refPage: pageField,
  refLimit: limitField(5),
})
export type WalletSearch = z.infer<typeof walletSearchSchema>

// --- تابع خالص سورت (خارج از کامپوننت → تست‌پذیر؛ مثل قبل) ---
function sortTransactions(txs: TransactionRowData[], sort: TransactionSort): TransactionRowData[] {
  const copy = [...txs]
  switch (sort) {
    case 'newest': return copy.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    case 'oldest': return copy.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    case 'highest': return copy.sort((a, b) => b.amount - a.amount)
    case 'lowest': return copy.sort((a, b) => a.amount - b.amount)
    case 'income': return copy.filter(t => t.type === 'DEPOSIT')
    case 'expense': return copy.filter(t => t.type === 'WITHDRAW')
    default: return copy
  }
}

// --- هوک ---
export function useWalletPage(transactions: TransactionRowData[], referrals: ReferralRow[]) {
  const navigate = useNavigate({ from: '/dashboard/wallet/' })
  const search = useSearch({ from: '/dashboard/wallet/' })

  // تراکنش‌های فیلتر/سورت‌شده — فقط با تغییر وابستگی‌ها
  const sortedTransactions = useMemo(
    () => sortTransactions(transactions, search.txSort),
    [transactions, search.txSort],
  )

  // صفحه‌بندی تراکنش‌ها — safePage مثل قبل (URL ممکن است از محدوده جلوتر باشد:
  // مثلاً بعد از حذف داده، ?txPage=9 وقتی فقط ۲ صفحه هست)
  const txTotalPages = Math.ceil(sortedTransactions.length / search.txLimit)
  const txSafePage = Math.min(search.txPage, txTotalPages || 1)
  const visibleTransactions = useMemo(
    () => sortedTransactions.slice((txSafePage - 1) * search.txLimit, txSafePage * search.txLimit),
    [sortedTransactions, txSafePage, search.txLimit],
  )

  // صفحه‌بندی زیرمجموعه‌ها
  const sortedReferrals = useMemo(
    () => [...referrals].sort((a, b) => new Date(b.registerDate).getTime() - new Date(a.registerDate).getTime()),
    [referrals],
  )
  const refTotalPages = Math.ceil(sortedReferrals.length / search.refLimit)
  const refSafePage = Math.min(search.refPage, refTotalPages || 1)
  const visibleReferrals = useMemo(
    () => sortedReferrals.slice((refSafePage - 1) * search.refLimit, refSafePage * search.refLimit),
    [sortedReferrals, refSafePage, search.refLimit],
  )

  // --- هندلرها — تغییر سورت/تعدادِ یک لیست = ریست صفحه‌ی «همان» لیست ---
  const handleTxSort = useCallback((sort: TransactionSort) => {
    navigate({ search: { ...search, txSort: sort, txPage: 1 } })
  }, [navigate, search])

  const handleTxPage = useCallback((page: number) => {
    navigate({ search: { ...search, txPage: page } })
  }, [navigate, search])

  const handleTxLimit = useCallback((limit: number) => {
    navigate({ search: { ...search, txLimit: limit, txPage: 1 } })
  }, [navigate, search])

  const handleRefPage = useCallback((page: number) => {
    navigate({ search: { ...search, refPage: page } })
  }, [navigate, search])

  const handleRefLimit = useCallback((limit: number) => {
    navigate({ search: { ...search, refLimit: limit, refPage: 1 } })
  }, [navigate, search])

  return {
    // shape قبلی حفظ شده — WalletBalanceCard/TransactionsList/... بدون تغییر کار می‌کنند؛
    // مقادیر از URL می‌آیند (تایپ‌دار) نه reducer
    state: {
      txSort: search.txSort,
      txPage: search.txPage,
      txLimit: search.txLimit,
      refPage: search.refPage,
      refLimit: search.refLimit,
    },
    visibleTransactions,
    txCurrentPage: txSafePage,     // ← صفحه‌ی فعلی (نسخه‌ی ایمن)
    txTotalPages,                  // ← تعداد کل صفحات
    visibleReferrals,
    refCurrentPage: refSafePage,
    refTotalPages,
    handleTxSort, handleTxPage, handleTxLimit,
    handleRefPage, handleRefLimit,
  }
}