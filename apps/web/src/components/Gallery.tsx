// ═══════════════════════════════════════════════════════════════
// stage-56 — sinshin-food-delivery — فایل 2 از 5
// مسیر مقصد: apps/web/src/components/Gallery.tsx
// تغییر: leadImage اختیاری — تصویر مستقل سایزِ انتخاب‌شده اسلاید نخست
//        می‌شود؛ تغییر سایز → برگشت نرم به اسلاید نخست (slideTo)
// ═══════════════════════════════════════════════════════════════

// src/components/Gallery.tsx

import { useEffect, useRef } from 'react'
import type { Swiper as SwiperType } from 'swiper'
import { EffectCards, Keyboard, Mousewheel, Pagination } from 'swiper/modules'
import { Swiper, SwiperSlide } from 'swiper/react'
import { tpl, useI18n } from '#/i18n'
import type { GalleryProps } from '#/types/shared/ui'
import { isRealImageUrl } from '#/utils/image'

// استایل‌های خود Swiper
import 'swiper/css'
import 'swiper/css/effect-cards'
import 'swiper/css/pagination'

// رارد ۳۲ — alt دوزبانه («تصویر {n} گالری» با ارقام زبان فعال)
export function Gallery({ images, leadImage }: GalleryProps) {
	const { t, fmt } = useI18n()

	// stage-56 — instance سوایپر را نگه می‌داریم تا با تغییر سایز بتوانیم
	// به اسلاید نخست slideTo کنیم — کل Swiper ریمانت نمی‌شود.
	const swiperRef = useRef<SwiperType | null>(null)

	// stage-56 — تغییر leadImage (انتخاب سایز دیگر) → اسلاید نخست با انیمیشن
	useEffect(() => {
		if (leadImage) swiperRef.current?.slideTo(0, 400)
	}, [leadImage])

	// stage-56 — تصویر مستقل سایز: اسلاید نخست؛ اگر نه lead هست و نه
	// images، گالری‌ای برای نمایش نداریم (رفتار قبلی حفظ شد — این بار lead
	// به‌تنهایی هم برای رندر کافی است)
	if (!leadImage && (!images || images.length === 0)) return null

	// stage-56 — leadImage سرِ صف؛ تکرارش از بقیه حذف می‌شود — کلید اسلاید = src
	// (با تغییر سایز فقط یک اسلاید جدید ساخته می‌شود، بقیه جابه‌جا می‌شوند)
	const slides = leadImage
		? [leadImage, ...(images ?? []).filter((src) => src !== leadImage)]
		: (images ?? [])

	return (
		// اضافه کردن padding برای فضای تنفس افکت سه بعدی
		<div className="mb-8 w-full flex justify-center px-8  overflow-hidden">
			<Swiper
				effect={'cards'}
				grabCursor={true}
				speed={500}
				rewind={true}
				// تنظیمات دقیق افکت برای حرکت نرم‌تر
				cardsEffect={{
					rotate: true,
					perSlideOffset: 8, // فاصله کارت‌های پشتی
					perSlideRotate: 2, // زاویه چرخش کارت‌های پشتی
					slideShadows: false, // غیرفعال کردن سایه‌های زشت پیش‌فرض
				}}
				mousewheel={{ invert: true }}
				keyboard={{ enabled: true }}
				pagination={true}
				modules={[EffectCards, Mousewheel, Keyboard, Pagination]}
				// stage-56 — instance را نگه دار (slideTo در useEffect بالا)
				onSwiper={(s) => {
					swiperRef.current = s
				}}
				// تعیین ابعاد استاندارد برای حفظ تناسب
				className="w-full max-w-sm md:max-w-md lg:max-w-none aspect-4/5 lg:aspect-4/3 rounded-2xl"
			>
				{slides.map((src, index) => (
					<SwiperSlide
						key={src}
						className="rounded-2xl overflow-hidden shadow-xl bg-white"
					>
						{/* round-12 — عکس‌های آپلودی URL واقعی‌اند؛ رشته‌های گرادیانتِ
                موک قدیمی هنوز در داده‌ها ممکن‌اند — هر دو پشتیبانی می‌شوند */}
						{isRealImageUrl(src) ? (
							<img
								src={src}
								alt={tpl(t['gallery.alt'], { n: fmt.num(index + 1) })}
								loading="lazy"
								decoding="async"
								className="absolute inset-0 w-full h-full object-cover"
							/>
						) : (
							<div
								className={`absolute inset-0 w-full h-full bg-linear-to-br ${src}`}
							></div>
						)}
					</SwiperSlide>
				))}
			</Swiper>
		</div>
	)
}