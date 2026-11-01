// ═══════════════════════════════════════════════════════════════
// hundred-eleven (فاز ۱ — آمار واقعی) — sinshin-food-delivery
// مسیر مقصد: apps/web/src/lib/product-stats-beacon.ts
//
// بیکن‌های آمار بازدید/افزودن‌به‌سبد — fail-silent اصولی: هرگز
// رندر/UX/سبد را نمی‌گیرد (نه await، نه توست، نه throw) و در SSR
// کاری نمی‌کند. دداپ و شمارش تماماً سمت سرور (کوکی sinshin_vid +
// ردیس ۲۴h + سقف نرخ IP) — کلاینت فقط «رویداد» را می‌فرستد.
// ═══════════════════════════════════════════════════════════════

// src/lib/product-stats-beacon.ts
import { apiBase } from '#/lib/api'

/** POST بیکنِ بدون-انتظار — keepalive تا با ترکِ زودهنگامِ صفحه هم برود */
const beacon = (path: string): void => {
	if (typeof window === 'undefined') return // SSR هیچ نمی‌فرستد
	void fetch(`${apiBase()}${path}`, {
		method: 'POST',
		keepalive: true,
		// VITE_API_URL may use another origin; deduplication needs its cookie.
		credentials: 'include',
	}).catch(() => {
		/* آمار هرگز UX را نمی‌گیرد */
	})
}

/** بازدید صفحه‌ی محصول — یک‌بار به‌ازای مانتِ هر محصول (صفحه‌ی جزئیات) */
export const trackProductView = (productId: string): void =>
	beacon(`/menu/products/${productId}/view`)

/** افزودن به سبد — فقط از چوک‌پوینتِ cartStore.addItem (بدون دریف) */
export const trackCartAdd = (productId: string): void =>
	beacon(`/menu/products/${productId}/cart-event`)
