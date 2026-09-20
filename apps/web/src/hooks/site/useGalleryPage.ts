// src/hooks/site/useGalleryPage.ts
import { useReducer, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { galleryImagesOptions } from '#/utils/queryOptions'

// --- state: فقط lightbox ---
interface GalleryState {
  lightboxSrc: string | null
  lightboxAlt: string
}

type GalleryAction =
  | { type: 'OPEN_LIGHTBOX'; payload: { src: string; alt: string } }
  | { type: 'CLOSE_LIGHTBOX' }

const initialGalleryState: GalleryState = { lightboxSrc: null, lightboxAlt: '' }

function galleryReducer(state: GalleryState, action: GalleryAction): GalleryState {
  switch (action.type) {
    case 'OPEN_LIGHTBOX': return { lightboxSrc: action.payload.src, lightboxAlt: action.payload.alt }
    case 'CLOSE_LIGHTBOX': return initialGalleryState
    default: return state
  }
}

export function useGalleryPage() {
  const [state, dispatch] = useReducer(galleryReducer, initialGalleryState)

  // فکتوری مرکزی — loader روت هم همین رو پر کرده → بدون فلیک
  const { data: images, isLoading } = useQuery(galleryImagesOptions)

  const handleOpen = useCallback((src: string, alt: string) => {
    dispatch({ type: 'OPEN_LIGHTBOX', payload: { src, alt } })
  }, [])

  const handleClose = useCallback(() => {
    dispatch({ type: 'CLOSE_LIGHTBOX' })
  }, [])

  return { state, images: images ?? [], isLoading, handleOpen, handleClose }
}