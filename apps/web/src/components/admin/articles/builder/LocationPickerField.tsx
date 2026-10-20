// src/components/admin/articles/builder/LocationPickerField.tsx
// ═══════════════════════════════════════════════════════════════
// stage-92 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/components/admin/articles/builder/LocationPickerField.tsx (فایل جدید)
// انتخاب‌گرِ بلوک «موقعیت» در صفحه‌ساز.
//
// به‌جای تایپِ دستیِ طول/عرضِ جغرافیایی (خطاپذیر: جابه‌جایی lat/lng،
// ارقامِ فارسی، دقتِ اشتباه) ادمین نقطه را با «کلیک روی نقشهٔ نشان»
// انتخاب می‌کند — همان MapPickerِ تسویه (SDK نشان + آدرسِ معکوس از
// API خودِ سرور). بدون VITE_NESHAN_MAP_KEY همان فیلدهای دستیِ پیش‌تر
// با هشدارِ راه‌اندازی رندر می‌شود (سقوطِ نرم).
//
// نقشه تاشو می‌ماند تا فقط بلوکِ در حالِ ویرایش WebGL بسازد؛
// پیوندهای «تست» همان دیپ‌لینک‌های نهاییِ صفحهٔ مقاله‌اند.
// ═══════════════════════════════════════════════════════════════

import { useState } from 'react'
import { Map as MapIcon } from 'reicon-react'
import { MapPicker } from '#/components/shared/MapPicker'
import { neshanRouteUrl, neshanViewUrl } from '#/utils/neshanLinks'

interface LocationPickerFieldProps {
	lat: number
	lng: number
	onChange: (coords: { lat: number; lng: number }) => void
}

export function LocationPickerField({
	lat,
	lng,
	onChange,
}: LocationPickerFieldProps) {
	const [open, setOpen] = useState(false)
	const [validDraft, setValidDraft] = useState(true)

	return (
		<div className="space-y-2">
			<div className="flex flex-wrap items-center gap-2">
				<button
					type="button"
					onClick={() => setOpen((v) => !v)}
					disabled={open && !validDraft}
					aria-expanded={open}
					className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary dark:bg-dark-primary text-white text-xs font-DanaDemiBold cursor-pointer hover:opacity-90 transition"
				>
					<MapIcon />
					{open ? 'بستن نقشه' : 'انتخاب روی نقشه'}
				</button>
				<span
					className="text-[11px] text-gray-500 dark:text-gray-400 font-DanaMedium bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] rounded-lg px-2 py-1.5"
					dir="ltr"
				>
					{lat.toFixed(6)}, {lng.toFixed(6)}
				</span>
				<a
					href={neshanViewUrl(lat, lng)}
					target="_blank"
					rel="noopener noreferrer"
					title="همان دکمه‌ای که خواننده در صفحهٔ مقاله می‌بیند"
					className="text-[11px] text-primary dark:text-dark-primary font-DanaMedium underline underline-offset-4 cursor-pointer"
				>
					تستِ مشاهده ↗
				</a>
				<a
					href={neshanRouteUrl(lat, lng)}
					target="_blank"
					rel="noopener noreferrer"
					title="پین روی نقطه + مسیر از موقعیتِ کنونی در نشان"
					className="text-[11px] text-primary dark:text-dark-primary font-DanaMedium underline underline-offset-4 cursor-pointer"
				>
					تستِ مسیریابی ↗
				</a>
			</div>
			{open && (
				<MapPicker
					value={{ lat, lng }}
					onChange={onChange}
					onValidityChange={setValidDraft}
				/>
			)}
			{!open && (
				<p className="text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed">
					روی نقشه کلیک کن تا نقطهٔ دقیق انتخاب شود (پین جابه‌جا می‌شود و آدرسِ
					معکوس زیر نقشه می‌آید)؛ در صفحهٔ مقاله نقشهٔ تعاملی + دکمه‌های «مشاهده روی
					نقشه» و «مسیریابی از موقعیت من» دیده می‌شود.
				</p>
			)}
		</div>
	)
}
