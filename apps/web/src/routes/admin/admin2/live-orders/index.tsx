// src/routes/admin/admin2/live-orders/index.tsx
import { createFileRoute, Link } from '@tanstack/react-router'
import { memo, useMemo, useState } from 'react'
import { useAdmin2Panel } from '#/hooks/admin/useAdmin2Panel'
import { LiveOrderCard } from '#/components/admin/admin2/LiveOrderCard'
import { NoteModal } from '#/components/admin/admin2/NoteModal'
import { ConfirmOrderModal } from '#/components/admin/admin2/ConfirmOrderModal'
import { Pagination } from '#/components/Pagination'
import { RouteError } from '#/components/shared/RouteFallbacks'
import { Bell, BellOff, Login4 } from 'reicon-react'
import { LiveOrdersSkeleton } from '#/components/LoadingSkeletons'


// --- حالت لاگین‌نبودن: ورود فقط از صفحه لاگین سایت ---
const NotLoggedIn = memo(function NotLoggedIn() {
  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center gap-4">
      <span className="w-20 h-20 rounded-full bg-gray-100 dark:bg-[#1a0a0e] text-gray-400 flex items-center justify-center">
        <Login4 size={36} />
      </span>
      <h1 className="font-MorabbaBold text-2xl text-gray-800 dark:text-white">ورود لازم است</h1>
      <p className="text-gray-500 dark:text-gray-400 font-DanaMedium text-center max-w-sm leading-relaxed">
        ادمین سطح ۲ فعلاً وارد نشده است. ورود فقط از طریق صفحه ورود سایت انجام می‌شود.
        اگر ادمین دیگری فعال است، ابتدا باید او از پنل خارج شود.
      </p>
      <Link
        to="/login"
        className="px-8 py-3 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaDemiBold hover:opacity-90 transition cursor-pointer"
      >
        رفتن به صفحه ورود
      </Link>
    </div>
  )
})

// --- صفحه اصلی ---
const Admin2Page = memo(function Admin2Page() {
  const page = useAdmin2Panel()
  const [currentPage, setCurrentPage] = useState(1)

  // آیتم ۲۳: صفحه‌بندی بعد از ۲۰ سفارش
  const totalPages = Math.ceil(page.orders.length / page.ordersPerPage)
  const visibleOrders = useMemo(
    () => page.orders.slice((currentPage - 1) * page.ordersPerPage, currentPage * page.ordersPerPage),
    [page.orders, currentPage, page.ordersPerPage]
  )


  // در حال لود سشن — اسکلتون اختصاصی (نه پیام خطا)
  if (page.isLoading) {
    return <LiveOrdersSkeleton />
  }


  // لاگین نیست؟
  if (!page.session?.isAdmin2LoggedIn) {
    return <NotLoggedIn />
  }

  return (
    <div className="space-y-6">
      {/* هدر پنل */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-MorabbaBold text-3xl text-gray-800 dark:text-white">
            سفارشات زنده
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-2 font-DanaMedium flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
            ادمین: {page.session?.admin?.firstName} {page.session?.admin?.lastName}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* دکمه تست — فقط موک */}
          {/* <button
            type="button"
            onClick={() => simulateNewOrder({ data: undefined })}
            className="px-4 py-2 rounded-xl bg-blue-500/10 text-blue-500 text-sm font-DanaMedium cursor-pointer hover:bg-blue-500/20 transition flex items-center gap-1.5"
            title="فقط برای تست live"
          >
            <Play size={14} />
            سفارش تست
          </button> */}
          <button
            type="button"
            onClick={page.handleToggleSound}
            className="p-2.5 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 cursor-pointer hover:bg-gray-200 dark:hover:bg-[#3a151c] transition"
            title={page.state.soundEnabled ? 'قطع صدا' : 'فعال‌سازی صدا'}
          >
            {page.state.soundEnabled ? <Bell size={18} /> : <BellOff size={18} />}
          </button>
        </div>
      </div>

      {/* لیست سفارشات — جدیدها ردیف اول */}
      <div
        id="live-orders-area"
        className="bg-white dark:bg-[#2a1015] p-4 sm:p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm space-y-3"
      >
        {visibleOrders.length > 0 ? (
          visibleOrders.map((order) => (
            <LiveOrderCard
              key={order.id}
              order={order}
              onRequestConfirm={page.handleRequestConfirm}
              onOpenNote={page.handleOpenNote}
            />
          ))
        ) : (
          <div className="text-center py-16 text-gray-400 font-DanaMedium">
            هنوز سفارشی ثبت نشده — منتظر...
          </div>
        )}

        {totalPages > 1 && (
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            itemsPerPage={page.ordersPerPage}
            totalItems={page.orders.length}
            onPageChange={setCurrentPage}
          />
        )}
      </div>

      {/* مودال نکته مشتری — بعد از تیک، مستقیم مودال تایید باز می‌شه */}
      {page.state.noteModalOrder && (
        <NoteModal
          orderId={page.state.noteModalOrder.orderId}
          note={page.state.noteModalOrder.note}
          onClose={page.handleCloseNote}
          onConfirm={() => {
            const orderId = page.state.noteModalOrder!.orderId
            page.handleCloseNote()
            page.handleRequestConfirm(orderId, null, false)  // ⬅️ isConfirmed=false (هنوز PAID)
          }}
        />
      )}

      {/* مودال تایید / تغییر پیک — courierId از کارت می‌آید */}
      {page.state.confirmOrder && (
        <ConfirmOrderModal
          orderId={page.state.confirmOrder.orderId}
          courierId={page.state.confirmOrder.courierId}
          isReassign={page.state.confirmOrder.isReassign}  // ⬅️ پراپ صریح
          onDone={page.handleConfirmDone}
          onCancel={page.handleCancelConfirm}
        />
      )}
    </div>
  )
})

export const Route = createFileRoute('/admin/admin2/live-orders/')({
  component: Admin2Page,
  errorComponent: RouteError,
  head: () => ({
    meta: [
      { title: 'پنل سفارشات زنده | سین شین' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
})