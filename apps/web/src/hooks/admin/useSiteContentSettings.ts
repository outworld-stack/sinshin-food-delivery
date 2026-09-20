// src/hooks/admin/useSiteContentSettings.ts
import { useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useToastStore } from '#/stores/toastStore'
import { updateAboutContent } from '#/server/about'
import {
  addGalleryImage, updateGalleryImage,
  deleteGalleryImage, reorderGalleryImage,
} from '#/server/gallery'
import { aboutContentOptions, adminGalleryImagesOptions } from '#/utils/queryOptions'
import { qk } from '#/utils/queryKeys'
import type { AboutContentInput } from '#/types/site/about'
import type {
  AddGalleryImageInput, UpdateGalleryImageInput, ReorderGalleryImageInput,
} from '#/types/site/gallery'

interface Options {
  /** برای ادمین غیراصلی کوئری‌ها اجرا نمی‌شوند (هوک همیشه صدا زده می‌شود) */
  enabled: boolean
}

export function useSiteContentSettings({ enabled }: Options) {
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.showToast)



  // ⬅ NEW: کوئری‌ها از فکتوری مرکزی — قبلاً کلید از contentKeys (شیم بک‌ورد) بود؛
  // حالا با صفحه‌ی عمومی «درباره ما» (aboutContentOptions) یک کش مشترک:
  // ذخیره‌ی محتوا در پنل، سایت عمومی را هم بلافاصله تازه می‌کند
  const aboutQuery = useQuery({ ...aboutContentOptions, enabled })

  // گالری ادمین — staleTime ۵ دقیقه داخل فکتوری
  const galleryQuery = useQuery({ ...adminGalleryImagesOptions, enabled })

  const invalidateContent = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: qk.aboutContent })
    queryClient.invalidateQueries({ queryKey: qk.galleryImages })
    queryClient.invalidateQueries({ queryKey: qk.adminGalleryImages })
  }, [queryClient])

  const aboutMutation = useMutation({
    mutationFn: (input: AboutContentInput) =>
      updateAboutContent({ ...input }),
    onSuccess: () => {
      invalidateContent()
      showToast('محتوای «درباره ما» ذخیره شد')
    },
  })

  const addMutation = useMutation({
    mutationFn: (input: AddGalleryImageInput) =>
      addGalleryImage(input),
    onSuccess: () => {
      invalidateContent()
      showToast('تصویر به گالری اضافه شد')
    },
  })

  const updateMutation = useMutation({
    mutationFn: (input: UpdateGalleryImageInput) =>
      updateGalleryImage(input),
    onSuccess: invalidateContent,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteGalleryImage(id),
    onSuccess: () => {
      invalidateContent()
      showToast('تصویر از گالری حذف شد')
    },
  })

  const reorderMutation = useMutation({
    mutationFn: (input: ReorderGalleryImageInput) =>
      reorderGalleryImage(input),
    onSuccess: invalidateContent,
  })

  const saveAbout = useCallback(
    (input: AboutContentInput) => aboutMutation.mutate(input),
    [aboutMutation.mutate],
  )
  const addImage = useCallback(
    (input: AddGalleryImageInput) => addMutation.mutate(input),
    [addMutation.mutate],
  )
  const patchImage = useCallback(
    (input: UpdateGalleryImageInput) => updateMutation.mutate(input),
    [updateMutation.mutate],
  )
  const removeImage = useCallback(
    (id: string) => deleteMutation.mutate(id),
    [deleteMutation.mutate],
  )
  const moveImage = useCallback(
    (input: ReorderGalleryImageInput) => reorderMutation.mutate(input),
    [reorderMutation.mutate],
  )

  return {
    about: aboutQuery.data,
    gallery: galleryQuery.data ?? [],
    isLoading: enabled && (aboutQuery.isLoading || galleryQuery.isLoading),
    isSavingAbout: aboutMutation.isPending,
    isGalleryBusy:
      addMutation.isPending || updateMutation.isPending ||
      deleteMutation.isPending || reorderMutation.isPending,
    saveAbout, addImage, patchImage, removeImage, moveImage,
  }
}