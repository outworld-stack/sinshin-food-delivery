// src/components/site/gallery/GalleryImage.tsx
import { memo, useCallback } from 'react'
import type { GalleryImage as GalleryImageType } from '#/types/site/gallery'
import { isRealImageUrl } from '#/utils/image'

interface GalleryImageProps {
	image: GalleryImageType
	onOpen: (src: string, alt: string) => void
}

// هر عکس — کلیکش فقط خودش رو درگیر می‌کنه (memo + callback stable از هوک)
export const GalleryImage = memo(function GalleryImage({
	image,
	onOpen,
}: GalleryImageProps) {
	const handleClick = useCallback(() => {
		onOpen(image.src, image.alt)
	}, [onOpen, image.src, image.alt])

	// round-12 — عکس آپلودی URL واقعی است؛ گرادیانت موک قدیمی هم ممکن است باشد
	const isReal = isRealImageUrl(image.src)

	return (
		<button
			type="button"
			onClick={handleClick}
			className="group relative w-full h-69.25 md:h-101 rounded-3xl overflow-hidden cursor-pointer bg-gray-100 dark:bg-[#1a0a0e]"
			aria-label={`بزرگ‌نمایی: ${image.alt}`}
		>
			{isReal ? (
				<img
					src={image.src}
					alt={image.alt}
					loading="lazy"
					decoding="async"
					className="absolute inset-0 w-full h-full object-cover rounded-3xl transition-all duration-700 ease-in-out group-hover:grayscale group-hover:scale-105"
				/>
			) : (
				<div
					className={`absolute inset-0 bg-linear-to-br ${image.src} rounded-3xl transition-all duration-700 ease-in-out group-hover:grayscale group-hover:scale-105`}
				/>
			)}
		</button>
	)
})
