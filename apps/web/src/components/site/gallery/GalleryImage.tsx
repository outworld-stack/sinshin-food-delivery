// src/components/site/gallery/GalleryImage.tsx
import { memo, useCallback } from 'react'
import type { GalleryImage as GalleryImageType } from '#/types/site/gallery'

interface GalleryImageProps {
  image: GalleryImageType
  onOpen: (src: string, alt: string) => void
}

// هر عکس — کلیکش فقط خودش رو درگیر می‌کنه (memo + callback stable از هوک)
export const GalleryImage = memo(function GalleryImage({ image, onOpen }: GalleryImageProps) {
  const handleClick = useCallback(() => {
    onOpen(image.src, image.alt)
  }, [onOpen, image.src, image.alt])

  return (
    <button
      type="button"
      onClick={handleClick}
      className="group relative w-full h-69.25 md:h-101 rounded-3xl overflow-hidden cursor-pointer"
      aria-label={`بزرگ‌نمایی: ${image.alt}`}
    >
      <div
        className={`absolute inset-0 bg-linear-to-br ${image.src} object-cover rounded-3xl transition-all duration-700 ease-in-out group-hover:grayscale group-hover:scale-105`}
      />
    </button>
  )
})