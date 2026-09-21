// src/components/Gallery.tsx

import { EffectCards, Keyboard, Mousewheel, Pagination } from 'swiper/modules'
import { Swiper, SwiperSlide } from 'swiper/react'
import type { GalleryProps } from '#/types/shared/ui'
import { isRealImageUrl } from '#/utils/image'

// استایل‌های خود Swiper
import 'swiper/css'
import 'swiper/css/effect-cards'
import 'swiper/css/pagination'

export function Gallery({ images }: GalleryProps) {
	if (!images || images.length === 0) return null

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
				// تعیین ابعاد استاندارد برای حفظ تناسب
				className="w-full max-w-sm md:max-w-md lg:max-w-none aspect-4/5 lg:aspect-4/3 rounded-2xl"
			>
				{images.map((src, index) => (
					<SwiperSlide
						key={index}
						className="rounded-2xl overflow-hidden shadow-xl bg-white"
					>
						{/* round-12 — عکس‌های آپلودی URL واقعی‌اند؛ رشته‌های گرادیانتِ
                موک قدیمی هنوز در داده‌ها ممکن‌اند — هر دو پشتیبانی می‌شوند */}
						{isRealImageUrl(src) ? (
							<img
								src={src}
								alt={`تصویر ${index + 1} گالری`}
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
