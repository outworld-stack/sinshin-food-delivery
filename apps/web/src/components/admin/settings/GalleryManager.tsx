// src/components/admin/settings/GalleryManager.tsx
import { memo, useState, useCallback } from 'react'
import { ConfirmModal } from '#/components/ConfirmModal'
import { FileUploader } from '#/components/FileUploader'
import { GalleryImageRow, type GalleryImageEditFields } from './GalleryImageRow'
import type { GalleryImage, GallerySpan, AddGalleryImageInput } from '#/types/site/gallery'

interface GalleryManagerProps {
  images: GalleryImage[]
  isBusy: boolean
  onAdd: (input: AddGalleryImageInput) => void
  onPatch: (id: string, fields: Omit<Partial<GalleryImage>, 'id' | 'sortOrder'>) => void
  onRemove: (id: string) => void
  onMove: (id: string, direction: 'up' | 'down') => void
}

const btnCls =
  'px-4 py-2 rounded-lg text-xs font-DanaMedium transition cursor-pointer disabled:opacity-50'

export const GalleryManager = memo(function GalleryManager({
  images, isBusy, onAdd, onPatch, onRemove, onMove,
}: GalleryManagerProps) {
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [newAlt, setNewAlt] = useState('')
  const [newSpan, setNewSpan] = useState<GallerySpan>('normal')
  const [newImage, setNewImage] = useState('')
  // ریست آپلودر بعد از افزودن — key تغییر می‌کند و پیش‌نمایش پاک می‌شود
  const [uploaderKey, setUploaderKey] = useState(0)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)

  const toggleAdd = useCallback(() => setIsAddOpen((v) => !v), [])
  const handleNewAlt = useCallback((e: React.ChangeEvent<HTMLInputElement>) => setNewAlt(e.target.value), [])

  const handleAddSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    const alt = newAlt.trim()
    if (!alt || !newImage) return // عکس و alt هر دو اجباری
    onAdd({ src: newImage, alt, span: newSpan })
    setNewAlt('')
    setNewSpan('normal')
    setNewImage('')
    setUploaderKey((k) => k + 1)
    setIsAddOpen(false)
  }, [newAlt, newImage, newSpan, onAdd])

  const handleToggleActive = useCallback(
    (id: string, isActive: boolean) => onPatch(id, { isActive }),
    [onPatch],
  )
  const handleSaveEdit = useCallback(
    (id: string, fields: GalleryImageEditFields) => onPatch(id, fields),
    [onPatch],
  )
  const closeDeleteModal = useCallback(() => setDeleteTargetId(null), [])
  const confirmDelete = useCallback(() => {
    if (deleteTargetId) onRemove(deleteTargetId)
    setDeleteTargetId(null)
  }, [deleteTargetId, onRemove])

  const deleteTarget = deleteTargetId ? images.find((i) => i.id === deleteTargetId) : null

  return (
    <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-DanaDemiBold text-lg text-gray-800 dark:text-white">گالری تصاویر</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            تصاویر غیرفعال در سایت نمایش داده نمی‌شوند اما اینجا باقی می‌مانند.
          </p>
        </div>
        <button type="button" onClick={toggleAdd} className={`${btnCls} bg-primary dark:bg-dark-primary text-white`}>
          {isAddOpen ? 'بستن' : '+ افزودن تصویر'}
        </button>
      </div>

      {isAddOpen && (
        <form onSubmit={handleAddSubmit} className="p-4 rounded-2xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="block text-xs font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">متن جایگزین (alt)</span>
              <input value={newAlt} onChange={handleNewAlt} className="w-full px-3 py-2 rounded-lg bg-white dark:bg-[#2a1015] border border-gray-200 dark:border-[#3a151c] text-sm text-gray-800 dark:text-white outline-none focus:border-primary" placeholder="مثلاً: فضای رستوران سین‌شین" />
            </label>
            <label className="block">
              <span className="block text-xs font-DanaMedium text-gray-700 dark:text-gray-300 mb-2">چیدمان</span>
              <select value={newSpan} onChange={(e) => setNewSpan(e.target.value as GallerySpan)} className="w-full px-3 py-2 rounded-lg bg-white dark:bg-[#2a1015] border border-gray-200 dark:border-[#3a151c] text-sm text-gray-800 dark:text-white outline-none focus:border-primary">
                <option value="normal">معمولی</option>
                <option value="wide">عریض (hero)</option>
              </select>
            </label>
          </div>

          {/* آپلود عکس — همان پترن ProductForm */}
          <FileUploader
            key={uploaderKey}
            accept="image/webp"
            fileTypeText="WebP"
            onUploadComplete={setNewImage}
          />

          <button type="submit" disabled={isBusy || !newAlt.trim() || !newImage} className={`${btnCls} bg-green-600 text-white`}>
            {isBusy ? 'در حال افزودن...' : 'افزودن به گالری'}
          </button>
        </form>
      )}

      {images.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">هنوز تصویری اضافه نشده است.</p>
      ) : (
        <ul className="space-y-3">
          {images.map((image, index) => (
            <GalleryImageRow
              key={image.id}
              image={image}
              canMoveUp={index > 0}
              canMoveDown={index < images.length - 1}
              isBusy={isBusy}
              onToggleActive={handleToggleActive}
              onSave={handleSaveEdit}
              onMove={onMove}
              onRequestDelete={setDeleteTargetId}
            />
          ))}
        </ul>
      )}

      <ConfirmModal
        isOpen={deleteTarget !== null}
        title="حذف تصویر"
        message={`آیا از حذف «${deleteTarget?.alt ?? ''}» مطمئن هستید؟ این عملیات قابل بازگشت نیست.`}
        onConfirm={confirmDelete}
        onCancel={closeDeleteModal}
      />
    </div>
  )
})