// src/components/FileUploader.tsx
import { useState, useRef, useCallback } from 'react'
import { apiBase } from '#/lib/api'
import { getAccessToken, tryRefresh } from '#/lib/auth-session'
import { useToastStore } from '#/stores/toastStore'
import type { FileUploaderProps } from '#/types/shared/ui'
import { Upload } from 'reicon-react'

const MAX_BYTES = 2 * 1024 * 1024
const ALLOWED = new Set(['image/png', 'image/webp']) // همان whitelist سرور

/**
 * phase-3 — آپلود «واقعی»:
 * قبلاً progress ساختگی بود و «اسم فایل» به‌عنوان URL برمی‌گشت.
 * حالا: POST /api/uploads + Authorization، progress واقعی (XHR)،
 * refresh روی 401 (تک‌پرواز) و URL واقعی سرور (/uploads/xxx.webp).
 */
export function FileUploader({
  onUploadComplete,
  initialImage,
  accept = 'image/png,image/webp',
  fileTypeText = 'PNG, WEBP',
}: FileUploaderProps) {
  const [preview, setPreview] = useState<string | undefined>(initialImage)
  const [progress, setProgress] = useState(0)
  const [isUploading, setIsUploading] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const showToast = useToastStore((s) => s.showToast)

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files?.[0]
      if (!selected) return
      // اعتبارسنجی کلاینت — فقط UX؛ مرز واقعی همان سرور است
      if (!ALLOWED.has(selected.type)) {
        showToast('فقط PNG یا WebP مجاز است.', 'error')
        e.target.value = ''
        return
      }
      if (selected.size > MAX_BYTES) {
        showToast('حداکثر حجم فایل ۲ مگابایت است.', 'error')
        e.target.value = ''
        return
      }

      setFile(selected)
      setPreview(URL.createObjectURL(selected))
      setIsUploading(true)
      setProgress(0)

      const send = (token: string | null) => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', apiBase() + '/uploads')
        if (token) xhr.setRequestHeader('authorization', `Bearer ${token}`)
        xhr.withCredentials = true
        xhr.responseType = 'json'

        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100))
        }

        xhr.onload = () => {
          if (xhr.status === 401) {
            void tryRefresh().then((ok) => {
              if (ok) send(getAccessToken()) // XHR تازه با توکن تازه
              else {
                setIsUploading(false)
                showToast('نشست شما منقضی شده — دوباره وارد شوید.', 'error')
              }
            })
            return
          }
          setIsUploading(false)
          const body = (xhr.response ?? null) as
            | { url?: string; error?: { message?: string } }
            | null
          if (xhr.status >= 200 && xhr.status < 300 && body?.url) {
            setProgress(100)
            onUploadComplete(body.url) // ← URL واقعی سرور
          } else {
            showToast(body?.error?.message ?? `خطای آپلود (${xhr.status})`, 'error')
          }
        }

        xhr.onerror = () => {
          setIsUploading(false)
          showToast('خطای شبکه هنگام آپلود.', 'error')
        }

        const fd = new FormData()
        fd.append('file', selected)
        xhr.send(fd)
      }
      send(getAccessToken())
    },
    [onUploadComplete, showToast],
  )

  return (
    <div className="space-y-4">
      <div
        onClick={() => !isUploading && inputRef.current?.click()}
        className="border-2 border-dashed border-gray-300 dark:border-[#3a151c] rounded-xl p-6 text-center cursor-pointer hover:border-primary dark:hover:border-dark-primary transition"
      >
        {preview ? (
          <img src={preview} alt="پیش‌نمایش" className="max-h-48 mx-auto rounded-lg" />
        ) : (
          <div className="flex flex-col items-center gap-2 text-gray-400">
            <Upload size={40} />
            <span className="text-sm font-DanaMedium">کلیک کنید یا فایل را رها کنید</span>
            <span className="text-xs text-gray-400">{fileTypeText} (حداکثر ۲MB)</span>
          </div>
        )}
        <input type="file" ref={inputRef} className="hidden" onChange={handleFileChange} accept={accept} />
      </div>

      {isUploading && (
        <div className="w-full bg-gray-200 dark:bg-[#1a0a0e] rounded-full h-2.5 overflow-hidden">
          <div className="bg-primary dark:bg-dark-primary h-2.5 rounded-full transition-all duration-200" style={{ width: `${progress}%` }}></div>
        </div>
      )}

      {file && !isUploading && (
        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-[#1a0a0e] p-2 rounded-lg">
          <span className="truncate">{file.name}</span>
          <button onClick={() => { setFile(null); setPreview(undefined); }} className="text-red-400 hover:text-red-500">حذف</button>
        </div>
      )}
    </div>
  )
}