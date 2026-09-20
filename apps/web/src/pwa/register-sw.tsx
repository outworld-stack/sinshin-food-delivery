// src/pwa/register-sw.tsx
// ثبت SW + بنر آپدیت (client-only) + install-prompt اندروید + راهنمای iOS
// همه‌چیز داخل useEffect — هیچ رندر SSR نداریم → hydration mismatch صفر

import { useEffect, useState } from 'react'

const DISMISS_KEY = 'sinshin-install-dismissed'
const DISMISS_DAYS = 30

export function PwaRegister() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null)
  const [showUpdate, setShowUpdate] = useState(false)
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null)
  const [showInstall, setShowInstall] = useState(false)
  const [showIosGuide, setShowIosGuide] = useState(false)
  const [standalone, setStandalone] = useState(false)

  useEffect(() => {
    // standalone؟ (نصب‌شده) → هیچ بنری
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true
    setStandalone(isStandalone)
    if (isStandalone) return

    // ── ثبت SW ──
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        // نسخه‌ی waiting؟ → بنر آپدیت (بدون skipWaiting خودکار)
        if (reg.waiting) {
          setWaitingWorker(reg.waiting)
          setShowUpdate(true)
        }
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing
          if (!nw) return
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              setWaitingWorker(nw)
              setShowUpdate(true)
            }
          })
        })

        // reload کنترل‌شده — فقط یک‌بار (فلگ ضد loop)
        let reloaded = false
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (reloaded) return
          reloaded = true
          window.location.reload()
        })
      })
      .catch(() => {/* SW نشد — اپ عادی */ })

    // ── install-prompt اندروید ──
    const onBeforeInstall = (e: Event) => {
      e.preventDefault() // پرامپت خودکار مرورگر نمی‌آید
      setDeferredPrompt(e)
      // فقط اگر قبلاً رد نکرده
      try {
        const raw = localStorage.getItem(DISMISS_KEY)
        if (raw && Date.now() - Number(raw) < DISMISS_DAYS * 86400000) return
      } catch { /* noop */ }
      // نشان نده فوراً — بعد از تعامل کاربر (اینجا: بعد از ۳ ثانیه اگر هنوز آنلاین است)
      setTimeout(() => setShowInstall(true), 3000)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)

    // نصب شد → dismissal پاک شود (uninstall/reinstall → پرامپت برگردد)
    window.addEventListener('appinstalled', () => {
      setShowInstall(false)
      try { localStorage.removeItem(DISMISS_KEY) } catch { /* noop */ }
    })

    // ── iOS راهنما — فقط iOS + غیر standalone ──
    const isIos = /iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent)
    if (isIos) setShowIosGuide(true)

    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall)
  }, [])

  // ── آپدیت: تأیید کاربر → skipWaiting → controllerchange → reload (یک‌بار) ──
  const applyUpdate = () => {
    waitingWorker?.postMessage({ type: 'SKIP_WAITING' })
  }

  // ── نصب اندروید ──
  const doInstall = async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'dismissed') {
      try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch { /* noop */ }
    }
    setDeferredPrompt(null)
    setShowInstall(false)
  }

  // هیچ‌کدام در SSR رندر نمی‌شود — این کامپوننت فقط بعد از mount محتوا دارد
  if (standalone) return null

  return (
    <>
      {/* بنر آپدیت — minimal */}
      {showUpdate && (
        <div style={bannerStyle}>
          <span style={{ fontSize: 13 }}>نسخه‌ی جدید آماده است</span>
          <button onClick={applyUpdate} style={btnStyle}>به‌روزرسانی</button>
        </div>
      )}

      {/* install-prompt اندروید */}
      {showInstall && !showIosGuide && (
        <div style={bannerStyle}>
          <span style={{ fontSize: 13 }}>سین‌شین را روی گوشی خود نصب کنید</span>
          <button onClick={doInstall} style={btnStyle}>نصب</button>
          <button
            onClick={() => {
              setShowInstall(false)
              try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch { /* noop */ }
            }}
            style={{ ...btnStyle, background: 'transparent', color: '#999', border: '1px solid #ddd' }}
          >
            بعداً
          </button>
        </div>
      )}

      {/* راهنمای iOS — فقط بار اول؛ با بستن، این session دیگر نمی‌آید */}
      {showIosGuide && !showUpdate && (
        <div style={bannerStyle}>
          <span style={{ fontSize: 12 }}>
            برای نصب: Share ⬆️ سپس «Add to Home Screen»
          </span>
          <button onClick={() => setShowIosGuide(false)} style={{ ...btnStyle, background: 'transparent', color: '#999', border: '1px solid #ddd' }}>
            بستن
          </button>
        </div>
      )}
    </>
  )
}

// استایل inline — بدون وابستگی به CSS پروژه؛ ساده و بی‌مزاحمت
const bannerStyle: React.CSSProperties = {
  position: 'fixed',
  bottom: 16,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 9999,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  background: 'white',
  borderRadius: 14,
  padding: '10px 16px',
  boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
  border: '1px solid #fde7f2',
  direction: 'rtl',
  fontFamily: 'Vazirmatn, Tahoma, sans-serif',
}

const btnStyle: React.CSSProperties = {
  background: '#f6339a',
  color: 'white',
  border: 0,
  borderRadius: 10,
  padding: '6px 16px',
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
}