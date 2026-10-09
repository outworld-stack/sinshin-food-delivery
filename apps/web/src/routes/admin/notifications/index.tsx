// ═══════════════════════════════════════════════════════════════
// stage-47 — sinshin-food-delivery — فایل ۱
// مسیر مقصد: apps/web/src/routes/admin/notifications/index.tsx
// وضعیت: جایگزینی کامل فایل موجود
// رفع: کرش «useI18n باید داخل I18nProvider استفاده شود» —
//      پنل ادمین طبق معماری i18n هیچ I18nProvider ندارد؛ useI18n
//      فقط داخل سایت (زیر Provider) معتبر است. این صفحه حالا از
//      useI18nSafe استفاده می‌کند (خارج Provider = فارسی خالص).
//      ضمناً authedFetch محلی با authJson مشترک عوض شد: نوسازی
//      توکن روی 401 + هدر زبان + سیگنال SSR — همان الگوی بقیه‌ی
//      صفحات ادمین.
// ═══════════════════════════════════════════════════════════════

// src/routes/admin/notifications/index.tsx
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { Send, BellRing } from 'reicon-react'
import { useI18nSafe } from '#/i18n'
import { authJson } from '#/lib/api-fetch'

/**
 * فاز-۲ — آهنگساز نوتیفیکیشن ادمین.
 *  • پخش عمومی: همه‌ی کاربران (صندوق + پوش مشترکان)
 *  • ارسال تست به یک کاربر (UUID)
 * گارد: /admin (route.tsx والد) فقط admin/admin2 می‌گذرد و
 * ADMIN2_ALLOWED_PREFIXES این مسیر را ندارد → فقط ادمین اصلی.
 */
export const Route = createFileRoute('/admin/notifications/')({
  ssr: false,
  component: AdminNotificationsPage,
})

function AdminNotificationsPage() {
  // stage-47 — ادمین خارج از I18nProvider است؛ نسخه‌ی امن = فارسی خالص
  const { t } = useI18nSafe()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [targeted, setTargeted] = useState(0)
  const [testUserId, setTestUserId] = useState('')
  const [testStatus, setTestStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  const valid = title.trim().length >= 2 && body.trim().length >= 2
  const urlClean = url.trim() === '' || url.trim().startsWith('/')

  const sendBroadcast = async () => {
    if (!valid || !urlClean) return
    setStatus('sending')
    try {
      const json = await authJson<{ targeted?: number }>('/notifications/broadcast', 'POST', {
        title: title.trim(),
        body: body.trim(),
        ...(url.trim() ? { url: url.trim() } : {}),
      })
      setStatus('sent')
      setTargeted(json.targeted ?? 0)
    } catch {
      setStatus('error')
    }
  }

  const sendTest = async () => {
    if (testUserId.trim().length < 30 || !valid) return
    setTestStatus('sending')
    try {
      await authJson('/notifications/send', 'POST', {
        userId: testUserId.trim(),
        title: title.trim(),
        body: body.trim(),
        ...(url.trim() ? { url: url.trim() } : {}),
      })
      setTestStatus('sent')
    } catch {
      setTestStatus('error')
    }
  }

  const inputCls =
    'w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-white/10 outline-none text-sm text-gray-800 dark:text-white focus:border-primary dark:focus:border-dark-primary transition'

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* سربرگ */}
      <div className="flex items-center gap-3">
        <span className="w-12 h-12 rounded-2xl bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary flex items-center justify-center">
          <BellRing size={24} />
        </span>
        <div>
          <h1 className="text-xl font-DanaDemiBold text-gray-800 dark:text-gray-100">
            {t['admin.notify.title']}
          </h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {t['admin.notify.subtitle']}
          </p>
        </div>
      </div>

      {/* فرم */}
      <div className="bg-white dark:bg-[#2a1015] rounded-2xl border border-gray-200 dark:border-white/10 p-6 space-y-4">
        <div>
          <label className="block text-xs font-DanaMedium text-gray-500 dark:text-gray-400 mb-2">
            {t['admin.notify.notifTitle']}
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 120))}
            placeholder="مثلاً: 🎉 کمپین ویژه آخر هفته"
            className={inputCls}
            dir="rtl"
          />
          <p className="text-[10px] text-gray-400 mt-1">{title.length}/120</p>
        </div>

        <div>
          <label className="block text-xs font-DanaMedium text-gray-500 dark:text-gray-400 mb-2">
            {t['admin.notify.body']}
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, 300))}
            placeholder="مثلاً: با کد WEEKEND همه‌ی پیتزاها ۲۰٪ تخفیف دارند!"
            rows={3}
            className={`${inputCls} resize-none`}
            dir="rtl"
          />
          <p className="text-[10px] text-gray-400 mt-1">{body.length}/300</p>
        </div>

        <div>
          <label className="block text-xs font-DanaMedium text-gray-500 dark:text-gray-400 mb-2">
            {t['admin.notify.url']}
          </label>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="/products"
            className={inputCls}
            dir="ltr"
          />
          {url.trim() !== '' && !urlClean && (
            <p className="text-[10px] text-red-500 mt-1">فقط مسیر داخلی (شروع با /) مجاز است.</p>
          )}
        </div>

        {/* ارسال به همه */}
        <button
          type="button"
          disabled={!valid || !urlClean || status === 'sending'}
          onClick={() => void sendBroadcast()}
          className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-primary dark:bg-dark-primary text-white text-sm font-DanaDemiBold hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Send size={18} />
          {status === 'sending' ? t['admin.notify.sending'] : t['admin.notify.send']}
        </button>

        {status === 'sent' && (
          <p className="text-xs text-green-600 dark:text-green-400 font-DanaMedium text-center bg-green-50 dark:bg-green-500/10 rounded-xl py-3">
            ✓ {t['admin.notify.sent'].replace('{n}', String(targeted))}
          </p>
        )}
        {status === 'error' && (
          <p className="text-xs text-red-500 font-DanaMedium text-center">
            ارسال ناموفق بود — دوباره تلاش کن.
          </p>
        )}
      </div>

      {/* ارسال تست */}
      <div className="bg-white dark:bg-[#2a1015] rounded-2xl border border-gray-200 dark:border-white/10 p-6 space-y-4">
        <div>
          <label className="block text-xs font-DanaMedium text-gray-500 dark:text-gray-400 mb-2">
            {t['admin.notify.test']}
          </label>
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-2">
            عنوان/متن همین فرم بالا استفاده می‌شود — با موبایل خودت تست کن (اول زنگ سایت را فعال کن).
          </p>
          <input
            type="text"
            value={testUserId}
            onChange={(e) => setTestUserId(e.target.value)}
            placeholder={t['admin.notify.testUserId']}
            className={inputCls}
            dir="ltr"
          />
        </div>
        <button
          type="button"
          disabled={!valid || testUserId.trim().length < 30 || testStatus === 'sending'}
          onClick={() => void sendTest()}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-primary dark:border-dark-primary text-primary dark:text-dark-primary text-sm font-DanaDemiBold hover:bg-primary/5 dark:hover:bg-dark-primary/5 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {testStatus === 'sending' ? t['admin.notify.sending'] : t['admin.notify.sendTest']}
        </button>
        {testStatus === 'sent' && (
          <p className="text-xs text-green-600 dark:text-green-400 font-DanaMedium text-center">
            ✓ ارسال شد — نوتیفیکیشن روی گوشی/تب کاربر می‌رسد.
          </p>
        )}
        {testStatus === 'error' && (
          <p className="text-xs text-red-500 font-DanaMedium text-center">
            ارسال ناموفق — شناسه را چک کن.
          </p>
        )}
      </div>
    </div>
  )
}