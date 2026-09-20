// src/components/site/gallery/GalleryLightbox.tsx
import { memo, useCallback, useEffect } from 'react'
import { X } from 'reicon-react'

interface GalleryLightboxProps {
  src: string | null
  alt: string
  onClose: () => void
}

// Lightbox — کنترل‌شده از reducer والد، Escape + کلیک-بیرون می‌بنده
export const GalleryLightbox = memo(function GalleryLightbox({ src, alt, onClose }: GalleryLightboxProps) {
  const handleBackdropClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose()
  }, [onClose])

  // Escape — mount فقط وقتی بازه (والد شرطی رندر می‌کنه → effect فقط اون‌موقع life داره)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!src) return null

  return (
    <div
      className="fixed inset-0 z-100 bg-black/80 backdrop-blur-sm items-center justify-center p-4 flex"
      onClick={handleBackdropClick}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 left-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition cursor-pointer"
        aria-label="بستن"
      >
        <X size={28} />
      </button>
      <div className="w-full max-w-4xl h-[70vh] rounded-3xl overflow-hidden shadow-2xl">
        <div className={`w-full h-full bg-linear-to-br ${src}`} role="img" aria-label={alt} />
      </div>
    </div>
  )
})