// src/utils/qrSvg.ts
// round-12 — مارک‌آپ خام SVG از QRCodeSVG (qrcode.react موجود؛ صفر وابستگی جدید).
// چرا offscreen؟ موتور چاپ (printDocument) سند HTML رشته‌ای می‌سازد — QR باید
// به‌صورت مارک‌آپ داخل آن درج شود. این‌جا کامپوننت در یک div جدا رندر و
// بلافاصله outerHTML خوانده و unmount می‌شود.

import { QRCodeSVG } from 'qrcode.react'
import { createRoot } from 'react-dom/client'

/**
 * QR → رشتهٔ `<svg>…</svg>` — resolve بعد از paint (ایفکت رسم canvas/svg
 * qrcode.react در useLayoutEffect اجرا می‌شود؛ دوبار rAF + تایمر کوتاه
 * تضمین می‌کند که المان در DOM است).
 */
export function qrSvgMarkup(value: string, size = 200): Promise<string> {
	return new Promise((resolve, reject) => {
		if (typeof document === 'undefined') {
			reject(new Error('qrSvgMarkup is client-only'))
			return
		}
		const holder = document.createElement('div')
		holder.style.display = 'none'
		document.body.appendChild(holder)

		const root = createRoot(holder)
		root.render(
			<QRCodeSVG
				value={value}
				size={size}
				bgColor="#ffffff"
				fgColor="#1a0a0e"
				level="M"
				marginSize={0}
			/>,
		)

		const finish = () => {
			const svg = holder.querySelector('svg')
			const markup = svg?.outerHTML ?? ''
			root.unmount()
			holder.remove()
			if (markup) resolve(markup)
			else reject(new Error('QR render failed'))
		}
		requestAnimationFrame(() => {
			requestAnimationFrame(() => setTimeout(finish, 30))
		})
	})
}
