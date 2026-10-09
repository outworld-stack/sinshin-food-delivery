// ═══════════════════════════════════════════════════════════════
// phase-2 — sinshin-food-delivery — فایل جدید
// مسیر مقصد: apps/web/src/components/shared/NotificationBell.tsx
// ═══════════════════════════════════════════════════════════════

// src/components/shared/NotificationBell.tsx
import { memo, useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Bell, Check, BellOff, WifiOff } from 'reicon-react'
import { useI18nSafe } from '#/i18n'
import { useNotifications, type NotificationItem } from '#/hooks/shared/useNotifications'

interface NotificationBellProps {
  /** شناسه‌ی کاربر لاگین‌شده — بدون آن زنگ رندر نمی‌شود */
  userId: string | null | undefined
}

/**
 * فاز-۲ — زنگ نوتیفیکیشن هدر.
 *  • نشان خوانده‌نشده + پنل کشویی (max-h + scroll — قاعده‌ی لیست بلند)
 *  • کلیک روی آیتم: خوانده‌شده + ناوبری به url نوتیف
 *  • دکمه‌ی اشتراک پوش وقتی permission=default (یک‌بار می‌پرسد)
 *  • آیتم‌های نو با حاشیه‌ی رنگی؛ خوانده‌شده‌ها کم‌رنگ
 */
export const NotificationBell = memo(function NotificationBell({ userId }: NotificationBellProps) {
  const { t } = useI18nSafe()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const { items, unread, pushState, markRead, markAllRead, enablePush } = useNotifications(userId)

  // بستن با کلیک بیرون / Escape
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const onOpen = useCallback(() => {
    setOpen((o) => !o)
  }, [])

  const onItemClick = useCallback(
    (n: NotificationItem) => {
      if (!n.readAt) void markRead(n.id)
      setOpen(false)
      const target = n.url && n.url.startsWith('/') ? n.url : '/products'
      void navigate({ to: target as never })
    },
    [markRead, navigate],
  )

  if (!userId) return null

  const ico = 'h-[18px] w-[18px] sm:h-5 sm:w-5'

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={onOpen}
        aria-label={t['notify.bell']}
        title={t['notify.bell']}
        aria-expanded={open}
        className="relative flex items-center justify-center p-2 sm:p-2.5 rounded-lg bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10 transition font-DanaMedium"
      >
        <Bell size={20} className={ico} />
        {unread > 0 && (
          <span className="absolute -top-1 -left-1 min-w-4.5 h-4.5 px-1 flex items-center justify-center text-[10px] font-DanaDemiBold rounded-full bg-primary dark:bg-dark-primary text-white shadow">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={t['notify.bell']}
          className="absolute top-full left-0 mt-2 w-[320px] sm:w-95 max-w-[calc(100vw-24px)] bg-white dark:bg-[#1a0a0e] rounded-2xl shadow-2xl border border-gray-200 dark:border-white/10 z-50 overflow-hidden"
        >
          {/* سربرگ */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-white/5">
            <span className="text-sm font-DanaDemiBold text-gray-800 dark:text-gray-100">
              {t['notify.title']}
              {unread > 0 && (
                <span className="text-[10px] text-primary dark:text-dark-primary mr-2">
                  {t['notify.unreadCount'].replace('{n}', String(unread))}
                </span>
              )}
            </span>
            {items.length > 0 && (
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="text-[11px] text-primary dark:text-dark-primary hover:underline font-DanaMedium"
              >
                {t['notify.markAllRead']}
              </button>
            )}
          </div>

          {/* دکمه‌ی اشتراک پوش — فقط وقتی هنوز تصمیم نگرفته */}
          {pushState.state === 'default' && (
            <div className="px-4 py-3 bg-primary/5 dark:bg-dark-primary/5 border-b border-gray-100 dark:border-white/5">
              <button
                type="button"
                onClick={() => void enablePush()}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-primary dark:bg-dark-primary text-white text-xs font-DanaDemiBold hover:opacity-90 transition"
              >
                <Bell size={16} />
                {t['notify.enablePush']}
              </button>
              <p className="mt-1.5 text-[10px] leading-relaxed text-gray-500 dark:text-gray-400 text-center">
                {t['notify.enablePushHint']}
              </p>
            </div>
          )}
          {pushState.state === 'unsupported' && (
            <div className="px-4 py-2.5 bg-yellow-50 dark:bg-yellow-500/5 border-b border-gray-100 dark:border-white/5 flex items-center gap-2">
              <BellOff size={14} className="text-yellow-500 shrink-0" />
              <p className="text-[10px] leading-relaxed text-gray-500 dark:text-gray-400">
                {t['notify.pushUnsupported']}
              </p>
            </div>
          )}

          {/* لیست — قاعده‌ی لیست بلند: max-h + اسکرول */}
          {items.length === 0 ? (
            <div className="px-4 py-10 flex flex-col items-center gap-3 text-gray-400 dark:text-gray-500">
              <WifiOff size={28} />
              <p className="text-xs font-DanaMedium">{t['notify.empty']}</p>
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              {items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => onItemClick(n)}
                  className={`w-full text-right px-4 py-3 flex flex-col gap-1 border-b border-gray-50 dark:border-white/3 last:border-0 transition hover:bg-gray-50 dark:hover:bg-white/3 ${
                    n.readAt ? 'opacity-60' : ''
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {!n.readAt && (
                      <span className="w-2 h-2 rounded-full bg-primary dark:bg-dark-primary shrink-0" />
                    )}
                    <span className="text-xs font-DanaDemiBold text-gray-800 dark:text-gray-100 truncate">
                      {n.title}
                    </span>
                    <span className="mr-auto text-[10px] text-gray-400 dark:text-gray-500 shrink-0">
                      {relativeFa(n.createdAt)}
                    </span>
                  </span>
                  <span className="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400 line-clamp-2">
                    {n.body}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* پانوشت */}
          <div className="px-4 py-2.5 border-t border-gray-100 dark:border-white/5 flex items-center justify-between">
            <span className="text-[10px] text-gray-400 dark:text-gray-500 font-DanaMedium">
              {t['notify.pushEnabled']}
            </span>
            {unread > 0 && (
              <span className="flex items-center gap-1 text-[10px] text-green-500 font-DanaMedium">
                <Check size={12} />
                {t['notify.live']}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
})

/** زمان نسبی فارسی — سبک و بدون وابستگی */
function relativeFa(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return ''
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'همین حالا'
  if (minutes < 60) return `${minutes} دقیقه پیش`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ساعت پیش`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} روز پیش`
  return new Intl.DateTimeFormat('fa-IR', { month: 'short', day: 'numeric' }).format(new Date(iso))
}
