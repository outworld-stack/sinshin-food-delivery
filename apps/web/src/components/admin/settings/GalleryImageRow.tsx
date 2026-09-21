// src/components/admin/settings/GalleryImageRow.tsx
import { memo, useCallback, useState } from 'react'
import { FileUploader } from '#/components/FileUploader'
import { Toggle } from '#/components/shared/Toggle'
import type { GalleryImage, GallerySpan } from '#/types/site/gallery'
import { isRealImageUrl } from '#/utils/image'

export interface GalleryImageEditFields {
	alt: string
	span: GallerySpan
	src: string
}

interface GalleryImageRowProps {
	image: GalleryImage
	canMoveUp: boolean
	canMoveDown: boolean
	isBusy: boolean
	onToggleActive: (id: string, isActive: boolean) => void
	onSave: (id: string, fields: GalleryImageEditFields) => void
	onMove: (id: string, direction: 'up' | 'down') => void
	onRequestDelete: (id: string) => void
}

const btnCls =
	'px-3 py-1.5 rounded-lg text-xs font-DanaMedium transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed'

export const GalleryImageRow = memo(function GalleryImageRow({
	image,
	canMoveUp,
	canMoveDown,
	isBusy,
	onToggleActive,
	onSave,
	onMove,
	onRequestDelete,
}: GalleryImageRowProps) {
	const [isEditing, setIsEditing] = useState(false)
	const [alt, setAlt] = useState(image.alt)
	const [span, setSpan] = useState<GallerySpan>(image.span)
	const [src, setSrc] = useState(image.src)

	const startEdit = useCallback(() => {
		setAlt(image.alt)
		setSpan(image.span)
		setSrc(image.src)
		setIsEditing(true)
	}, [image.alt, image.span, image.src])

	const cancelEdit = useCallback(() => setIsEditing(false), [])

	const handleSave = useCallback(() => {
		onSave(image.id, { alt: alt.trim(), span, src })
		setIsEditing(false)
	}, [image.id, alt, span, src, onSave])

	return (
		<li className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 rounded-2xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c]">
			{/* round-12 — عکس آپلودی با <img>؛ گرادیانت موک قدیمی با کلاس */}
			{(() => {
				const current = isEditing ? src : image.src
				if (isRealImageUrl(current)) {
					return (
						<img
							src={current}
							alt={image.alt}
							className={`w-full sm:w-28 h-24 rounded-xl object-cover shrink-0 ${image.isActive ? '' : 'opacity-40'}`}
						/>
					)
				}
				return (
					<div
						className={`w-full sm:w-28 h-24 rounded-xl bg-linear-to-br ${current} shrink-0 ${image.isActive ? '' : 'opacity-40'}`}
						aria-hidden
					/>
				)
			})()}

			<div className="flex-1 min-w-0 space-y-2">
				{isEditing ? (
					<div className="space-y-3">
						{/* key با id + وضعیت ویرایش → هر بار ویرایش، آپلودر از نو شروع می‌شود */}
						<FileUploader
							key={`${image.id}-edit`}
							accept="image/webp"
							fileTypeText="WebP"
							onUploadComplete={setSrc}
						/>
						<div className="flex flex-col sm:flex-row gap-3">
							<input
								value={alt}
								onChange={(e) => setAlt(e.target.value)}
								className="flex-1 px-3 py-2 rounded-lg bg-white dark:bg-[#2a1015] border border-gray-200 dark:border-[#3a151c] text-sm text-gray-800 dark:text-white outline-none focus:border-primary"
								placeholder="متن جایگزین"
							/>
							<select
								value={span}
								onChange={(e) => setSpan(e.target.value as GallerySpan)}
								className="px-3 py-2 rounded-lg bg-white dark:bg-[#2a1015] border border-gray-200 dark:border-[#3a151c] text-sm text-gray-800 dark:text-white outline-none focus:border-primary"
							>
								<option value="wide">عریض (hero)</option>
								<option value="normal">معمولی</option>
							</select>
						</div>
					</div>
				) : (
					<>
						<p className="font-DanaMedium text-sm text-gray-800 dark:text-white truncate">
							{image.alt}
						</p>
						<p className="text-xs text-gray-500 dark:text-gray-400">
							{image.span === 'wide' ? 'چیدمان عریض' : 'چیدمان معمولی'} · ترتیب:{' '}
							{image.sortOrder}
						</p>
					</>
				)}
			</div>

			<div className="flex items-center gap-2 shrink-0 flex-wrap">
				{isEditing ? (
					<>
						<button
							type="button"
							onClick={handleSave}
							disabled={isBusy || !alt.trim()}
							className={`${btnCls} bg-green-100 dark:bg-green-500/10 text-green-600 dark:text-green-400`}
						>
							تایید
						</button>
						<button
							type="button"
							onClick={cancelEdit}
							className={`${btnCls} bg-gray-200 dark:bg-[#2a1015] text-gray-600 dark:text-gray-300`}
						>
							انصراف
						</button>
					</>
				) : (
					<>
						<button
							type="button"
							onClick={() => onMove(image.id, 'up')}
							disabled={isBusy || !canMoveUp}
							className={`${btnCls} bg-gray-200 dark:bg-[#2a1015] text-gray-600 dark:text-gray-300`}
						>
							↑
						</button>
						<button
							type="button"
							onClick={() => onMove(image.id, 'down')}
							disabled={isBusy || !canMoveDown}
							className={`${btnCls} bg-gray-200 dark:bg-[#2a1015] text-gray-600 dark:text-gray-300`}
						>
							↓
						</button>
						<button
							type="button"
							onClick={startEdit}
							disabled={isBusy}
							className={`${btnCls} bg-blue-100 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400`}
						>
							ویرایش
						</button>
						<button
							type="button"
							onClick={() => onRequestDelete(image.id)}
							disabled={isBusy}
							className={`${btnCls} bg-red-100 dark:bg-red-500/10 text-red-500`}
						>
							حذف
						</button>
						<Toggle
							isOn={image.isActive}
							onToggle={() => onToggleActive(image.id, !image.isActive)}
							disabled={isBusy}
						/>
					</>
				)}
			</div>
		</li>
	)
})
