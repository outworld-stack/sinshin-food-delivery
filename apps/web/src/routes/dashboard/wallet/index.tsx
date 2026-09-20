// src/routes/dashboard/wallet/index.tsx
// ⬅ NEW: validateSearch (قرارداد URL) + loader (پری‌فچ روی هاور سایدبار)
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { userProfileOptions } from '#/utils/queryOptions'
import { useWalletPage, walletSearchSchema } from '#/hooks/dashboard/useWalletPage'
import { WalletBalanceCard } from '#/components/dashboard/wallet/WalletBalanceCard'
import { WalletStatsRow } from '#/components/dashboard/wallet/WalletStatsRow'
import { ReferralsList } from '#/components/dashboard/wallet/ReferralsList'
import { TransactionsList } from '#/components/dashboard/wallet/TransactionsList'
import { WalletSkeleton } from '#/components/LoadingSkeletons'
import { RouteError } from '#/components/shared/RouteFallbacks'


export const Route = createFileRoute('/dashboard/wallet/')({
  ssr: false,
  // ⬅ NEW: قرارداد URL — سورت/صفحه‌بندی هر دو لیست؛ رفرش/back/اشتراک‌گذاری حفظش می‌کند.
  // catch: مقادیر خرابِ دست‌کاری‌شده به پیش‌فرض برمی‌گردند نه خطای روت
  validateSearch: walletSearchSchema,

  // ⬅ NEW: پری‌فچ — هاور روی «کیف پول» در سایدبار (defaultPreload: 'intent')
  // => پروفایل در کش پر می‌شود؛ ناوبری بدون حتی یک اسکلتون.
  // نکته: سورت/صفحه کلاینتی‌اند (مشتق از پروفایل کش‌شده) → loaderDeps لازم نیست؛
  // تغییرشان loader را دوباره اجرا نمی‌کند (نیازی هم نیست — کوئری مشترک است).
  // سرور اجرا نمی‌شود: داشبورد خصوصیه و گارد والد (/dashboard) قبل از این loader
  // اجرا شده و ریدایرکت لازم را انجام داده.
  loader: async ({ context }) => {
    await context.queryClient.query(userProfileOptions)
  },

  component: WalletPage,
  pendingComponent: WalletSkeleton,
  errorComponent: RouteError,
  // داشبورد خصوصیه — نه ایندکس
  head: () => ({
    meta: [
      { title: 'کیف پول من | سین شین' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
});


function WalletPage() {
  // پروفایل کلاینت‌محور — staleTime از فکتوری (۶۰s)؛
  // loader همین کلید را هنگام هاور پر کرده
  const { data: user, isLoading } = useQuery(userProfileOptions)

  const page = useWalletPage(
    user?.walletTransactions ?? [],
    user?.myReferrals ?? [],
  )

  if (isLoading || !user) {
    return <WalletSkeleton />
  }

  return (
    <div className="max-w-6xl">
      <h1 className="font-MorabbaBold text-3xl text-gray-800 dark:text-white mb-2">کیف پول من</h1>
      <p className="text-gray-500 dark:text-gray-400 mb-8 font-DanaMedium">مدیریت موجودی و تراکنش‌های مالی</p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ستون راست: کارت موجودی (آیتم ۱۲: بدون شارژ) */}
        <div className="lg:col-span-1">
          <WalletBalanceCard balance={user.walletBalance} />
        </div>

        {/* ستون چپ: آمار + لیست‌ها */}
        <div className="lg:col-span-2 space-y-6">
          <WalletStatsRow
            stats={{
              totalReferralProfit: user.totalReferralProfit,
              referralsCount: user.myReferrals.length,
            }}
          />

          <ReferralsList
            referrals={page.visibleReferrals}
            currentPage={page.refCurrentPage}
            totalPages={page.refTotalPages}
            itemsPerPage={page.state.refLimit}
            onPageChange={page.handleRefPage}
            onItemsPerPageChange={page.handleRefLimit}
          />

          <TransactionsList
            transactions={page.visibleTransactions}
            currentSort={page.state.txSort}
            currentPage={page.txCurrentPage}
            totalPages={page.txTotalPages}
            itemsPerPage={page.state.txLimit}
            onSortChange={page.handleTxSort}
            onPageChange={page.handleTxPage}
            onItemsPerPageChange={page.handleTxLimit}
          />
        </div>
      </div>
    </div>
  )
};