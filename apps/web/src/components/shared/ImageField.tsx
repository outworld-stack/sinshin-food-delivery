// src/components/shared/ImageField.tsx
import { memo, useState, useCallback } from 'react'
import { FileUploader } from '#/components/FileUploader'
import { ConfirmModal } from '#/components/ConfirmModal'
import { X } from 'reicon-react'

interface ImageFieldProps {
  label: string
  /** نوع فایل — پیش‌فرض وب‌پی */
  accept?: string
  fileTypeText?: string
  /** چندتایی (گالری) یا تکی (پروفایل) */
  multiple?: boolean
  /** عکس‌های فعلی — URL واقعی سرور (یا رشته‌ی گرادیانتِ موک قدیمی) */
  images: string[]
  onAdd: (url: string) => void
  onRemove: (index: number) => void
}

// phase-3 — گذار: URL واقعی با <img>؛ گرادیانت موک تا سیم‌کیری کامل فرم‌ها
const isRealUrl = (s: string) => s.startsWith('/') || s.startsWith('http')

export const ImageField = memo(function ImageField({
  label, accept = 'image/webp', fileTypeText, multiple = false, images, onAdd, onRemove,
}: ImageFieldProps) {
  const [toDelete, setToDelete] = useState<number | null>(null)

  const handleUpload = useCallback((url: string) => onAdd(url), [onAdd])

  const confirmDelete = useCallback(() => {
    if (toDelete !== null) onRemove(toDelete)
    setToDelete(null)
  }, [toDelete, onRemove])

  const uploadText = fileTypeText ?? (multiple ? 'افزودن WebP' : 'PNG')

  return (
    <div>
      <label className="block text-sm font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">{label}</label>
      <FileUploader accept={accept} fileTypeText={uploadText} onUploadComplete={handleUpload} />

      {images.length > 0 && (
        <div className="mt-4 pt-4 border-t border-dashed border-gray-200 dark:border-white/10">
          <span className="block text-xs text-gray-500 dark:text-gray-400 mb-3 font-DanaMedium">
            {multiple ? 'عکس‌های آپلود شده:' : 'عکس فعلی:'}
          </span>
          <div className="flex flex-wrap gap-3">
            {images.map((img, i) => (
              <div key={i} className="relative w-24 h-24">
                {isRealUrl(img) ? (
                  <img
                    src={img}
                    alt={`تصویر ${i + 1}`}
                    className={`w-full h-full object-cover ${multiple ? 'rounded-lg' : 'rounded-xl'}`}
                  />
                ) : (
                  <div className={`w-full h-full ${multiple ? 'rounded-lg' : 'rounded-xl'} bg-linear-to-br ${img}`}></div>
                )}
                <button
                  type="button"
                  onClick={() => setToDelete(i)}
                  className="absolute -top-2 -left-2 bg-red-500 text-white p-1 rounded-full shadow-md cursor-pointer"
                  aria-label="حذف عکس"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={toDelete !== null}
        title="حذف عکس"
        message="آیا از حذف این عکس مطمئن هستید؟"
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  )
})