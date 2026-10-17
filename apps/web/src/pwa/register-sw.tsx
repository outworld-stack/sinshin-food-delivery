// ═══════════════════════════════════════════════════════════════
// stage-49 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/pwa/register-sw.tsx
// تغییر (بازخورد ۶): در DEV هم سرویس‌ورکر ثبت می‌شود — اما نه sw.js
//        (workbox، فقط با build:pwa) بلکه sw-push.js سبک و استاتیک؛
//        تا Web Push در حالت توسعه روی دسکتاپ قابل آزمایش باشد.
// ═══════════════════════════════════════════════════════════════

// src/pwa/register-sw.tsx
// ثبت SW + بنر آپدیت (client-only) + install-prompt اندروید + راهنمای iOS
// همه‌چیز داخل useEffect — هیچ رندر SSR نداریم → ناهم‌خوانی هیدریشن صفر
//
// pwa-۲: بستنِ راهنمای iOS «پایدار» است (۳۰ روز، مثل اندروید) — قبلاً فقط
// state بود و با هر رفرش دوباره برمی‌گشت و کاربر iOS را اذیت می‌کرد.
// pwa-۳: بنر آپدیت دکمه‌ی «بعداً» دارد — بستنش فقط برای همین نشست است؛
// جلسه‌ی بعدی (reg.waiting هنوز هست) دوباره پیشنهاد می‌دهد که رفتار درستِ
// آپدیت است.

import { useEffect, useState } from 'react'

const DISMISS_KEY = 'sinshin-install-dismissed'
const IOS_DISMISS_KEY = 'sinshin-ios-dismissed'
const DISMISS_DAYS = 30

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** آیا کاربر اخیراً (ظرف مهلت) این بنر را بسته است؟ */
function dismissedWithin(key: string, days: number): boolean {
  try {
    const raw = localStorage.getItem(key)
    return !!raw && Date.now() - Number(raw) < days * 86400000
  } catch {
    return false
  }
}

/** بستن پایدار — مهلت‌دار */
function markDismissed(key: string): void {
  try {
    localStorage.setItem(key, String(Date.now()))
  } catch {
    /* هیچ‌کاری نمی‌کند */
  }
}

export function PwaRegister() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null)
  const [showUpdate, setShowUpdate] = useState(false)
  const [deferredPrompt, setDeferredPrompt] = useState<InstallPromptEvent | null>(null)
  const [showInstall, setShowInstall] = useState(false)
  const [showIosGuide, setShowIosGuide] = useState(false)
  const [standalone, setStandalone] = useState(false)

  useEffect(() => {
    // Installed apps still need worker registration and the update banner;
    // only installation prompts are hidden in standalone mode.
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true
    setStandalone(isStandalone)

    // ── ثبت SW ──
    if (!('serviceWorker' in navigator)) return
    let cancelled = false
    let installTimer: ReturnType<typeof setTimeout> | undefined

    // Updating the root registration preserves push subscriptions. Leave
    // other scopes on the same development origin alone.
    if (import.meta.env.DEV) {
      navigator.serviceWorker
        .register('/sw-push.js')
        .catch(() => {/* پوش در dev هم اختیاری است — اپ عادی */ })
      return
    }

    // round-16 — پاک‌کننده‌های ثبتِ SW (داخل then پر می‌شوند؛ cleanup انتها می‌گیردشان)
    const swCleanupFns: Array<() => void> = []

    // stage-77 (P3-8) — ثبت بعد از load: precache کلِ بیلد (js/css/png/woff)
    // نباید با اولین رندرِ صفحه‌ی تازه‌وارد بر سرِ پهنای‌باند ۳G رقابت کند
    // (الگوی استاندارد registration). readyState کامل ⇒ همین حالا.
    let onWindowLoad: (() => void) | null = null
    let hadController = Boolean(navigator.serviceWorker.controller)
    const registerProdSw = () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        if (cancelled) return
        // نسخه‌ی waiting؟ → بنر آپدیت (بدون skipWaiting خودکار)
        if (reg.waiting) {
          setWaitingWorker(reg.waiting)
          setShowUpdate(true)
        }
        const onUpdateFound = () => {
          const nw = reg.installing
          if (!nw) return
          const onStateChange = () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              setWaitingWorker(nw)
              setShowUpdate(true)
            }
          }
          nw.addEventListener('statechange', onStateChange)
          swCleanupFns.push(() => nw.removeEventListener('statechange', onStateChange))
        }
        reg.addEventListener('updatefound', onUpdateFound)
        if (reg.installing) onUpdateFound()

        // بارگذاری مجددِ کنترل‌شده — فقط یک‌بار (فلگ ضد حلقه)
        let reloaded = false
        const onControllerChange = () => {
          if (!hadController) {
            hadController = true
            return
          }
          if (reloaded) return
          reloaded = true
          window.location.reload()
        }
        navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

        // round-16 — پنل زنده روزها باز می‌ماند؛ مرورگر خودش به‌ندرت چک می‌کند.
        // هر ۶ ساعت reg.update() → هات‌فیکس‌ها همان روز دیده می‌شوند.
        const updateTimer = setInterval(() => {
          void reg.update().catch(() => {/* هیچ‌کاری نمی‌کند */})
        }, 6 * 3600_000)

        // round-16 — پاک‌سازی کامل شنونده‌ها و تایمر (قبلاً فقط beforeinstallprompt پاک می‌شد)
        swCleanupFns.push(
          () => {
            clearInterval(updateTimer)
            reg.removeEventListener('updatefound', onUpdateFound)
            navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
          },
        )
      })
      .catch((err) => {
        if (cancelled) return
        // stage-58 — قبلاً اینجا کاملاً بی‌صدا قورت داده می‌شد؛ sw.js شکسته
        // یعنی «هیچ push handlerی در تولید نیست» — حالا: لاگ + fallback به
        // sw-push.js (استاتیک، فقط هندلر پوش) تا پوش هرگز بی‌سرویس‌ورکر
        // نماند و آپدیت بعدی sw.js سالم جایگزینش کند (scope یکسان).
        console.warn('[pwa] ثبت sw.js ناموفق — fallback به sw-push.js:', err)
        navigator.serviceWorker
          .register('/sw-push.js')
          .catch(() => {/* پوش در این مرورگر ممکن نیست — اپ عادی */ })
      })
    }
    if (document.readyState === 'complete') registerProdSw()
    else {
      // stage-77 — قابلیت حذف در unmount (لحظه‌ی بین mount و load)
      onWindowLoad = registerProdSw
      window.addEventListener('load', onWindowLoad, { once: true })
    }

    // ── install-prompt اندروید ──
    const onBeforeInstall = (e: Event) => {
      e.preventDefault() // پرامپت خودکار مرورگر نمی‌آید
      setDeferredPrompt(e as InstallPromptEvent)
      // فقط اگر قبلاً رد نکرده
      if (dismissedWithin(DISMISS_KEY, DISMISS_DAYS)) return
      // نشان نده فوراً — بعد از تعامل کاربر (اینجا: بعد از ۳ ثانیه اگر هنوز آنلاین است)
      clearTimeout(installTimer)
      installTimer = setTimeout(() => setShowInstall(true), 3000)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)

    // نصب شد → بسته‌شدن پاک شود (حذف/نصبِ مجدد → پرامپت برگردد)
    const onAppInstalled = () => {
      clearTimeout(installTimer)
      setStandalone(true)
      setDeferredPrompt(null)
      setShowInstall(false)
      setShowIosGuide(false)
      try { localStorage.removeItem(DISMISS_KEY) } catch { /* هیچ‌کاری نمی‌کند */ }
    }
    window.addEventListener('appinstalled', onAppInstalled)

    // ── iOS راهنما — فقط iOS + غیر standalone + پایدار بسته‌نشده (pwa-۲) ──
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    if (isIos && !isStandalone && !dismissedWithin(IOS_DISMISS_KEY, DISMISS_DAYS)) {
      setShowIosGuide(true)
    }

    return () => {
      cancelled = true
      clearTimeout(installTimer)
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onAppInstalled)
      if (onWindowLoad) window.removeEventListener('load', onWindowLoad)
      for (const fn of swCleanupFns) fn()
    }
  }, [])

  // ── آپدیت: تأیید کاربر → skipWaiting → controllerchange → بارگذاری مجدد (یک‌بار) ──
  const applyUpdate = () => {
    waitingWorker?.postMessage({ type: 'SKIP_WAITING' })
  }

  // ── نصب اندروید ──
  const doInstall = async () => {
    if (!deferredPrompt) return
    const prompt = deferredPrompt
    setDeferredPrompt(null)
    setShowInstall(false)
    try {
      await prompt.prompt()
      const { outcome } = await prompt.userChoice
      if (outcome === 'dismissed') markDismissed(DISMISS_KEY)
    } catch {
      // A dismissed/expired browser prompt can no longer be reused.
    }
  }

  return (
    <>
      {/* بنر آپدیت — مینیمال + «بعداً» (pwa-۳)
          stage-75 (P3-27) — هر سه بنرِ این فایل z-90: زیرِ مودال/بات‌شیتِ
          باز (z-100) و بالای هدر (z-40) — بنرِ اطلاع‌رسانی هرگز دیالوگِ
          فعالِ کاربر را نمی‌پوشاند. */}
      {showUpdate && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-90 flex flex-col lg:flex-row items-center gap-2.5 lg:gap-3 bg-white dark:bg-[#2a1015] rounded-2xl px-5 py-3 shadow-[0_4px_20px_rgba(0,0,0,0.15)] border border-gray-200 dark:border-[#3a151c] max-w-[calc(100vw-2rem)]">
          <span className="text-[13px] text-gray-700 dark:text-gray-200 text-center font-DanaMedium">
            نسخه‌ی جدید آماده است
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={applyUpdate}
              className="px-4 py-1.5 rounded-xl bg-primary text-white text-[13px] font-DanaDemiBold hover:opacity-90 active:scale-95 transition cursor-pointer whitespace-nowrap"
            >
              به‌روزرسانی
            </button>
            <button
              type="button"
              onClick={() => setShowUpdate(false)}
              className="px-3.5 py-1.5 rounded-xl bg-transparent text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-[#3a151c] text-[13px] font-DanaMedium hover:bg-gray-50 dark:hover:bg-[#1a0a0e] transition cursor-pointer whitespace-nowrap"
            >
              بعداً
            </button>
          </div>
        </div>
      )}

      {/* install-prompt اندروید — stage-59: موبایل دو ردیف (متن بالا، دکمه‌ها کنار هم پایین) */}
      {!standalone && showInstall && !showIosGuide && !showUpdate && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-90 flex flex-col lg:flex-row items-center gap-2.5 lg:gap-3 bg-white dark:bg-[#2a1015] rounded-2xl px-5 py-3 shadow-[0_4px_20px_rgba(0,0,0,0.15)] border border-gray-200 dark:border-[#3a151c] max-w-[calc(100vw-2rem)]">
          <span className="color-morph-text text-[13px] sm:text-sm font-DanaDemiBold text-center">
            سین شین را روی دستگاه خود نصب کنید
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={doInstall}
              className="px-5 py-1.5 rounded-xl bg-primary text-white text-[13px] font-DanaDemiBold hover:opacity-90 active:scale-95 transition cursor-pointer whitespace-nowrap"
            >
              نصب
            </button>
            <button
              type="button"
              onClick={() => {
                setShowInstall(false)
                markDismissed(DISMISS_KEY)
              }}
              className="px-3.5 py-1.5 rounded-xl bg-transparent text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-[#3a151c] text-[13px] font-DanaMedium hover:bg-gray-50 dark:hover:bg-[#1a0a0e] transition cursor-pointer whitespace-nowrap"
            >
              بعداً
            </button>
          </div>
        </div>
      )}

      {/* راهنمای iOS — بستنش ۳۰ روز پایدار است (pwa-۲)
          stage-59: همان متن گرادیانی نصب + راهنمای Share در خط دوم */}
      {!standalone && showIosGuide && !showUpdate && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-90 flex flex-col lg:flex-row items-center gap-2.5 lg:gap-3 bg-white dark:bg-[#2a1015] rounded-2xl px-5 py-3 shadow-[0_4px_20px_rgba(0,0,0,0.15)] border border-gray-200 dark:border-[#3a151c] max-w-[calc(100vw-2rem)]">
          <div className="text-center">
            <span className="color-morph-text text-[13px] sm:text-sm font-DanaDemiBold">
              سین شین را روی دستگاه خود نصب کنید
            </span>
            <span className="block text-[11px] text-gray-500 dark:text-gray-400 font-DanaMedium mt-0.5">
              Share ⬆️ سپس «Add to Home Screen»
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setShowIosGuide(false)
                markDismissed(IOS_DISMISS_KEY)
              }}
              className="px-3.5 py-1.5 rounded-xl bg-transparent text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-[#3a151c] text-[13px] font-DanaMedium hover:bg-gray-50 dark:hover:bg-[#1a0a0e] transition cursor-pointer whitespace-nowrap"
            >
              بستن
            </button>
          </div>
        </div>
      )}
    </>
  )
}
