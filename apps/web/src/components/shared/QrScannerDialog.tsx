// src/components/shared/QrScannerDialog.tsx
// round-12 — بارکدخوان دوربین (مشترک): اسکن کد معرف در داشبورد کاربر +
// اسکن QR سفارش در پنل پیک. مبنای decode: jsQR (بدون وابستگی عرضی).
//
// مسیرها: دوربین زنده (getUserMedia + حلقهٔ decode) → در صورت رد دسترسی یا
// نبود دوربین، بارگذاری عکس (input capture) با همان decoder.

import jsQR from 'jsqr'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Scan, Upload, X } from 'reicon-react'

interface QrScannerDialogProps {
	open: boolean
	title: string
	hint?: string
	onDecode: (text: string) => void
	onClose: () => void
}

type CameraState =
	| { kind: 'starting' }
	| { kind: 'live' }
	| { kind: 'error'; message: string }

const SCAN_INTERVAL_MS = 220
const DECODE_MAX_W = 480

export const QrScannerDialog = memo(function QrScannerDialog({
	open,
	title,
	hint,
	onDecode,
	onClose,
}: QrScannerDialogProps) {
	const videoRef = useRef<HTMLVideoElement>(null)
	const canvasRef = useRef<HTMLCanvasElement | null>(null)
	const streamRef = useRef<MediaStream | null>(null)
	const timerRef = useRef<number | null>(null)
	const [camera, setCamera] = useState<CameraState>({ kind: 'starting' })
	const [fileError, setFileError] = useState<string | null>(null)

	const stopCamera = useCallback(() => {
		if (timerRef.current !== null) {
			window.clearInterval(timerRef.current)
			timerRef.current = null
		}
		streamRef.current?.getTracks().forEach((t) => {
			t.stop()
		})
		streamRef.current = null
	}, [])

	// lifecycle: با باز بودن دیالوگ دوربین روشن، با بستن/آنماونت خاموش
	useEffect(() => {
		if (!open) {
			stopCamera()
			setCamera({ kind: 'starting' })
			setFileError(null)
			return
		}
		let cancelled = false

		const tick = () => {
			const video = videoRef.current
			if (!video || video.readyState < 2) return
			const w = Math.min(video.videoWidth, DECODE_MAX_W)
			const scale = video.videoWidth > 0 ? w / video.videoWidth : 1
			const h = Math.round(video.videoHeight * scale)
			if (w <= 0 || h <= 0) return
			let canvas = canvasRef.current
			if (!canvas) {
				canvas = document.createElement('canvas')
				canvasRef.current = canvas
			}
			canvas.width = w
			canvas.height = h
			const ctx = canvas.getContext('2d', { willReadFrequently: true })
			if (!ctx) return
			ctx.drawImage(video, 0, 0, w, h)
			const data = ctx.getImageData(0, 0, w, h)
			const code = jsQR(data.data, w, h)
			if (code?.data) {
				stopCamera()
				onDecode(code.data)
			}
		}

		const start = async () => {
			try {
				const stream = await navigator.mediaDevices.getUserMedia({
					video: { facingMode: { ideal: 'environment' } },
					audio: false,
				})
				if (cancelled) {
					stream.getTracks().forEach((t) => {
						t.stop()
					})
					return
				}
				streamRef.current = stream
				const video = videoRef.current
				if (!video) return
				video.srcObject = stream
				await video.play()
				setCamera({ kind: 'live' })
				timerRef.current = window.setInterval(tick, SCAN_INTERVAL_MS)
			} catch (err) {
				if (cancelled) return
				const message =
					err instanceof DOMException &&
					(err.name === 'NotAllowedError' || err.name === 'SecurityError')
						? 'دسترسی به دوربین رد شد — از تنظیمات مرورگر اجازهٔ دوربین را روشن کنید یا عکس کد را بارگذاری کنید.'
						: err instanceof DOMException && err.name === 'NotFoundError'
							? 'دوربینی یافت نشد — می‌توانید عکس کد را بارگذاری کنید.'
							: 'راه‌اندازی دوربین ممکن نشد — عکس کد را بارگذاری کنید.'
				setCamera({ kind: 'error', message })
			}
		}
		void start()

		return () => {
			cancelled = true
			stopCamera()
		}
	}, [open, onDecode, stopCamera])

	// fallback: بارگذاری عکس کد — همان decoder، تک‌فریمی
	const handleFile = useCallback(
		async (e: React.ChangeEvent<HTMLInputElement>) => {
			const file = e.target.files?.[0]
			e.target.value = ''
			if (!file) return
			setFileError(null)
			try {
				const url = URL.createObjectURL(file)
				try {
					const img = await new Promise<HTMLImageElement>((resolve, reject) => {
						const el = new Image()
						el.onload = () => resolve(el)
						el.onerror = () => reject(new Error('load-failed'))
						el.src = url
					})
					const scale = Math.min(
						1,
						DECODE_MAX_W / Math.max(1, img.naturalWidth),
					)
					const w = Math.max(1, Math.round(img.naturalWidth * scale))
					const h = Math.max(1, Math.round(img.naturalHeight * scale))
					const canvas = document.createElement('canvas')
					canvas.width = w
					canvas.height = h
					const ctx = canvas.getContext('2d', { willReadFrequently: true })
					if (!ctx) throw new Error('canvas')
					ctx.drawImage(img, 0, 0, w, h)
					const data = ctx.getImageData(0, 0, w, h)
					const code = jsQR(data.data, w, h)
					if (code?.data) {
						onDecode(code.data)
					} else {
						setFileError('کدی در این عکس پیدا نشد — عکس واضح‌تری از کد بگیرید.')
					}
				} finally {
					URL.revokeObjectURL(url)
				}
			} catch {
				setFileError('خواندن عکس ممکن نشد.')
			}
		},
		[onDecode],
	)

	if (!open) return null

	return (
		<div className="fixed inset-0 z-100 flex items-center justify-center p-4">
			<div
				className="absolute inset-0 bg-black/50 backdrop-blur-sm"
				onClick={onClose}
				aria-hidden="true"
			/>
			<div className="relative bg-white dark:bg-[#2a1015] p-6 rounded-2xl shadow-xl w-full max-w-md">
				<div className="flex items-center justify-between mb-4">
					<h3 className="font-DanaDemiBold text-lg text-gray-800 dark:text-white">
						{title}
					</h3>
					<button
						type="button"
						onClick={onClose}
						className="p-2 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition cursor-pointer"
						aria-label="بستن"
					>
						<X size={18} />
					</button>
				</div>

				{hint && (
					<p className="text-xs text-gray-500 dark:text-gray-400 font-DanaMedium leading-relaxed mb-4">
						{hint}
					</p>
				)}

				{/* دوربین — حتی در حالت خطا ویدیو مونت می‌ماند تا استریم دیررس گیر کند */}
				<div className="relative w-full aspect-4/3 bg-black rounded-xl overflow-hidden mb-4">
					<video
						ref={videoRef}
						className="w-full h-full object-cover"
						muted
						playsInline
						autoPlay
					/>
					{camera.kind !== 'live' && (
						<div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
							{camera.kind === 'starting' ? (
								<>
									<Scan size={36} className="text-white/70 animate-pulse" />
									<p className="text-xs text-white/70 font-DanaMedium">
										در حال راه‌اندازی دوربین...
									</p>
								</>
							) : (
								<>
									<Scan size={36} className="text-white/70" />
									<p className="text-xs text-white/80 font-DanaMedium leading-relaxed">
										{camera.message}
									</p>
								</>
							)}
						</div>
					)}
					{/* قاب راهنمای اسکن */}
					{camera.kind === 'live' && (
						<div className="absolute inset-0 pointer-events-none flex items-center justify-center">
							<div className="w-1/2 aspect-square border-2 border-white/70 rounded-2xl" />
						</div>
					)}
				</div>

				{/* بارگذاری عکس — همیشه در دسترس */}
				<label className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 text-sm font-DanaMedium hover:bg-gray-200 dark:hover:bg-[#3a151c] transition cursor-pointer">
					<Upload size={16} />
					بارگذاری عکس کد
					<input
						type="file"
						accept="image/*"
						capture="environment"
						className="hidden"
						onChange={handleFile}
					/>
				</label>
				{fileError && (
					<p className="text-xs text-red-500 font-DanaMedium mt-2 text-center">
						{fileError}
					</p>
				)}
			</div>
		</div>
	)
})
