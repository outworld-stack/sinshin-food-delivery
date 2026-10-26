// ═══════════════════════════════════════════════════════════════
// stage-100 — sinshin-food-delivery — فایل جدید
// مسیر مقصد: apps/web/src/components/site/product-detail/DualSparksBackground.tsx
// انیمیشن سومِ صفحه‌ی «محصول ویژه» — انتخابی توسط ادمین اصلی.
//
// منبع: کد کارفرما (DualSparks) — منطق انیمیشن کاملاً دست‌نخورده. فقط
// این‌ها به قراردادهای این ریپو وصل شد (بدون تغییر رفتار):
//   ① cn(clsx) در ریپو نیست ⇒ join ساده
//   ② NodeJS.Timeout ⇒ ReturnType<typeof setTimeout> (تایپ مرورگری)
//   ③ رنگ/پس‌زمینه‌ی پیش‌فرض به تم سین‌شین: جرقه لایت = primary قرمز،
//      دارک = dark-primary فیروزه‌ای؛ wash پس‌زمینه هم‌رنگِ بدنه‌ی سایت
//      (لایت سفید، دارک #1a0a0e) — isDarkMode همان کلاس .dark ریشه است
//   ④ React.FC/ReactNode ⇒ تایپ‌های نامی React 19
//   ⑤ پوشش fixed inset-0 z-0 pointer-events-none — همان لایه‌بندی
//      ShaderBackground (پس‌زمینه در پسِ محتوا؛ محتوا relative می‌ماند)
// ═══════════════════════════════════════════════════════════════

import { type FC, type ReactNode, useCallback, useEffect, useRef } from 'react'

interface DualSparksProps {
	sparkColor?: string
	sparkColorDark?: string
	sparkSize?: number
	sparkCount?: number
	duration?: number
	easing?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'
	waveInterval?: number
	maxRadius?: number
	ringsPerWave?: number
	ringSpacing?: number
	enableInward?: boolean
	corners?: 'both' | 'left' | 'right'
	backgroundColor?: string
	backgroundColorDark?: string
	clearBackground?: boolean
	backgroundOpacity?: number
	className?: string
	children?: ReactNode
	forceDarkMode?: boolean
}

interface Spark {
	x: number
	y: number
	angle: number
	radius: number
	startTime: number
	waveId: number
	ringIndex: number
	direction: 'outward' | 'inward'
	corner: 'left' | 'right'
}

export const DualSparks: FC<DualSparksProps> = ({
	// stage-100 — رنگ‌های پیش‌فرض = توکن‌های تم سین‌شین (لایت primary / دارک dark-primary)
	sparkColor = '#ed0741',
	sparkColorDark = '#2fd4d1',
	sparkSize = 10,
	sparkCount = 24,
	duration = 3500,
	easing = 'ease-out',
	waveInterval = 1400,
	maxRadius = 800,
	ringsPerWave = 5,
	ringSpacing = 40,
	enableInward = true,
	corners = 'both',
	// wash پیش‌زمینه هم‌رنگِ بدنه‌ی سایت (نیمه‌شفاف)
	backgroundColor = 'rgba(255, 255, 255, 0.15)',
	backgroundColorDark = 'rgba(26, 10, 14, 0.15)',
	clearBackground = true,
	backgroundOpacity = 0.15,
	className = '',
	children,
	forceDarkMode,
}) => {
	const canvasRef = useRef<HTMLCanvasElement>(null)
	const sparksRef = useRef<Spark[]>([])
	const lastWaveTimeRef = useRef<number>(0)
	const lastInwardWaveTimeRef = useRef<number>(700)
	const waveIdRef = useRef<number>(0)
	const containerWidthRef = useRef<number>(0)
	const containerHeightRef = useRef<number>(0)
	const animationIdRef = useRef<number>(0)

	const isDarkMode = useCallback(() => {
		if (forceDarkMode !== undefined) return forceDarkMode
		if (typeof document === 'undefined') return false
		return document.documentElement.classList.contains('dark')
	}, [forceDarkMode])

	const getSparkColor = useCallback(() => {
		return isDarkMode() ? sparkColorDark : sparkColor
	}, [isDarkMode, sparkColor, sparkColorDark])

	const getBackgroundColor = useCallback(() => {
		const baseColor = isDarkMode() ? backgroundColorDark : backgroundColor

		if (backgroundOpacity !== undefined && backgroundOpacity !== 0.15) {
			const match = baseColor.match(
				/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/,
			)
			if (match) {
				const [, r, g, b] = match
				return `rgba(${r}, ${g}, ${b}, ${backgroundOpacity})`
			}
		}
		return baseColor
	}, [isDarkMode, backgroundColor, backgroundColorDark, backgroundOpacity])

	const easeFunc = useCallback(
		(t: number) => {
			switch (easing) {
				case 'linear':
					return t
				case 'ease-in':
					return t * t
				case 'ease-in-out':
					return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
				default:
					return t * (2 - t)
			}
		},
		[easing],
	)

	useEffect(() => {
		const canvas = canvasRef.current
		if (!canvas) return

		const parent = canvas.parentElement
		if (!parent) return

		let resizeTimeout: ReturnType<typeof setTimeout> | undefined

		const resizeCanvas = () => {
			const { width, height } = parent.getBoundingClientRect()
			if (canvas.width !== width || canvas.height !== height) {
				canvas.width = width
				canvas.height = height
				containerWidthRef.current = width
				containerHeightRef.current = height

				sparksRef.current = []
				waveIdRef.current = 0
				lastWaveTimeRef.current = 0
				lastInwardWaveTimeRef.current = 700
			}
		}

		const handleResize = () => {
			clearTimeout(resizeTimeout)
			resizeTimeout = setTimeout(resizeCanvas, 100)
		}

		const ro = new ResizeObserver(handleResize)
		ro.observe(parent)
		window.addEventListener('resize', handleResize)

		resizeCanvas()

		return () => {
			ro.disconnect()
			window.removeEventListener('resize', handleResize)
			clearTimeout(resizeTimeout)
		}
	}, [])

	// biome-ignore lint/correctness/useExhaustiveDependencies: منطقِ کارفرما — این پنج پراپ در.effect فقط از طریق getSparkColor/getBackgroundColor (که خودشان در deps هستند) خوانده می‌شوند؛ اضافه‌بودنِ مستقیمشان فقط ری‌استارتِ دفاعیِ همان‌هاست (کد کارفرما دست‌نخورده)
	useEffect(() => {
		const canvas = canvasRef.current
		if (!canvas) return
		const ctx = canvas.getContext('2d', { alpha: true })
		if (!ctx) return

		const animate = (timestamp: number) => {
			if (clearBackground) {
				ctx.fillStyle = getBackgroundColor()
				ctx.fillRect(0, 0, canvas.width, canvas.height)
			} else {
				ctx.clearRect(0, 0, canvas.width, canvas.height)
			}

			const currentSparkColor = getSparkColor()

			if (timestamp - lastWaveTimeRef.current >= waveInterval) {
				const currentWaveId = waveIdRef.current++

				for (let ringIndex = 0; ringIndex < ringsPerWave; ringIndex++) {
					const ringDelay = ringIndex * 150

					for (let i = 0; i < sparkCount; i++) {
						const angleOffset = ringIndex % 2 === 0 ? 0 : Math.PI / sparkCount
						const angle = (2 * Math.PI * i) / sparkCount + angleOffset

						if (corners === 'both' || corners === 'left') {
							sparksRef.current.push({
								x: 0,
								y: 0,
								angle: angle,
								radius: ringIndex * ringSpacing,
								startTime: timestamp + ringDelay,
								waveId: currentWaveId,
								ringIndex: ringIndex,
								direction: 'outward',
								corner: 'left',
							})
						}

						if (corners === 'both' || corners === 'right') {
							sparksRef.current.push({
								x: containerWidthRef.current,
								y: 0,
								angle: angle,
								radius: ringIndex * ringSpacing,
								startTime: timestamp + ringDelay,
								waveId: currentWaveId + 1,
								ringIndex: ringIndex,
								direction: 'outward',
								corner: 'right',
							})
						}
					}
				}

				waveIdRef.current += 2
				lastWaveTimeRef.current = timestamp
			}

			if (
				enableInward &&
				timestamp - lastInwardWaveTimeRef.current >= waveInterval
			) {
				const currentWaveId = waveIdRef.current++
				const maxScreenRadius =
					Math.sqrt(
						containerWidthRef.current * containerWidthRef.current +
							containerHeightRef.current * containerHeightRef.current,
					) /
						2 +
					100

				for (let ringIndex = 0; ringIndex < ringsPerWave; ringIndex++) {
					const ringDelay = ringIndex * 150

					for (let i = 0; i < sparkCount; i++) {
						const angleOffset =
							ringIndex % 2 === 0 ? Math.PI / sparkCount / 2 : 0
						const angle = (2 * Math.PI * i) / sparkCount + angleOffset

						if (corners === 'both' || corners === 'left') {
							sparksRef.current.push({
								x: 0,
								y: 0,
								angle: angle,
								radius: maxScreenRadius - ringIndex * ringSpacing,
								startTime: timestamp + ringDelay,
								waveId: currentWaveId,
								ringIndex: ringIndex,
								direction: 'inward',
								corner: 'left',
							})
						}

						if (corners === 'both' || corners === 'right') {
							sparksRef.current.push({
								x: containerWidthRef.current,
								y: 0,
								angle: angle + Math.PI,
								radius: maxScreenRadius - ringIndex * ringSpacing,
								startTime: timestamp + ringDelay,
								waveId: currentWaveId + 1,
								ringIndex: ringIndex,
								direction: 'inward',
								corner: 'right',
							})
						}
					}
				}

				waveIdRef.current += 2
				lastInwardWaveTimeRef.current = timestamp
			}

			sparksRef.current = sparksRef.current.filter((spark) => {
				const elapsed = timestamp - spark.startTime

				if (elapsed < 0) return true
				if (elapsed >= duration) return false

				const progress = elapsed / duration
				const eased = easeFunc(progress)

				let currentRadius: number

				if (spark.direction === 'outward') {
					const expansionDistance = eased * maxRadius
					currentRadius = spark.radius + expansionDistance
				} else {
					const maxScreenRadius =
						Math.sqrt(
							containerWidthRef.current * containerWidthRef.current +
								containerHeightRef.current * containerHeightRef.current,
						) /
							2 +
						100
					const contractionDistance = eased * maxScreenRadius
					currentRadius = spark.radius - contractionDistance

					if (currentRadius < 0) return false
				}

				const fadeStart = 0.6
				const opacity =
					progress < fadeStart
						? 1
						: 1 - (progress - fadeStart) / (1 - fadeStart)

				const lineLength = sparkSize * (1 - eased * 0.3)

				const x1 = spark.x + currentRadius * Math.cos(spark.angle)
				const y1 = spark.y + currentRadius * Math.sin(spark.angle)

				const lineAngle =
					spark.direction === 'inward' ? spark.angle + Math.PI : spark.angle
				const x2 = x1 + lineLength * Math.cos(lineAngle)
				const y2 = y1 + lineLength * Math.sin(lineAngle)

				const shadowBlur = isDarkMode() ? 15 : 8
				const lineWidth = isDarkMode() ? 2.5 : 2

				ctx.shadowBlur = shadowBlur
				ctx.shadowColor = currentSparkColor
				ctx.strokeStyle = currentSparkColor
				ctx.globalAlpha = opacity
				ctx.lineWidth = lineWidth
				ctx.lineCap = 'round'
				ctx.beginPath()
				ctx.moveTo(x1, y1)
				ctx.lineTo(x2, y2)
				ctx.stroke()

				return true
			})

			ctx.shadowBlur = 0
			ctx.globalAlpha = 1

			animationIdRef.current = requestAnimationFrame(animate)
		}

		animationIdRef.current = requestAnimationFrame(animate)

		const observer = new MutationObserver(() => {
			sparksRef.current = []
			waveIdRef.current = 0
			lastWaveTimeRef.current = 0
			lastInwardWaveTimeRef.current = 700
		})

		if (typeof document !== 'undefined') {
			observer.observe(document.documentElement, {
				attributes: true,
				attributeFilter: ['class'],
			})
		}

		return () => {
			cancelAnimationFrame(animationIdRef.current)
			observer.disconnect()
		}
	}, [
		sparkColor,
		sparkColorDark,
		sparkSize,
		sparkCount,
		duration,
		waveInterval,
		maxRadius,
		ringsPerWave,
		ringSpacing,
		enableInward,
		corners,
		backgroundColor,
		backgroundColorDark,
		clearBackground,
		backgroundOpacity,
		easeFunc,
		getSparkColor,
		getBackgroundColor,
		isDarkMode,
	])

	return (
		<div
			className={`relative overflow-hidden${className ? ` ${className}` : ''}`}
		>
			<canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
			{children && <div className="relative z-10">{children}</div>}
		</div>
	)
}

export default DualSparks

/**
 * پس‌زمینه‌ی تمام‌صفحه‌ی صفحه‌ی محصول ویژه — پوششِ fixed همان لایه‌ی
 * ShaderBackground (z-0، پسِ محتوا، بی‌تعامل با اشاره‌گر). موج‌های
 * جرقه هر ۱٫۴ ثانیه از دو گوشه‌ی بالا پخش/جمع می‌شوند؛ تعویض تم همان
 * لحظه رنگ‌ها را عوض می‌کند (MutationObserver داخل خود DualSparks).
 */
export function DualSparksBackground() {
	return (
		<div
			// stage-101 — نشانگر DOM برای تست/E2E: کدام انیمیشن رندر شده
			data-featured-bg="sparks"
			className="fixed inset-0 z-0 overflow-hidden pointer-events-none"
			aria-hidden="true"
		>
			<DualSparks className="h-full w-full" />
		</div>
	)
}
