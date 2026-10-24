import { useEffect, useRef, useState } from 'react'
import {
	measureReceiptHtmlHeightPx,
	RECEIPT_PROBE_PX,
} from '#/lib/printDocument'

const PREVIEW_WIDTH_PX = RECEIPT_PROBE_PX + 12

/** Visual scaling is confined to this preview; printing uses a separate document. */
export function ReceiptPreviewPane({ html }: { html: string }) {
	const wrapRef = useRef<HTMLDivElement>(null)
	const [height, setHeight] = useState(360)
	const [scale, setScale] = useState(1)
	useEffect(() => {
		let cancelled = false
		void measureReceiptHtmlHeightPx(html)
			.then((next) => {
				if (!cancelled && next !== null) setHeight(next)
			})
			.catch(() => {})
		return () => {
			cancelled = true
		}
	}, [html])
	useEffect(() => {
		const update = () =>
			setScale(
				Math.min(
					1,
					Math.max(
						0.2,
						(wrapRef.current?.clientWidth ?? PREVIEW_WIDTH_PX) /
							PREVIEW_WIDTH_PX,
					),
				),
			)
		update()
		const observer =
			typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
		if (wrapRef.current) observer?.observe(wrapRef.current)
		window.addEventListener('resize', update)
		return () => {
			observer?.disconnect()
			window.removeEventListener('resize', update)
		}
	}, [])
	return (
		<div
			ref={wrapRef}
			className="w-full overflow-hidden"
			style={{ height: Math.ceil(height * scale) + 6 }}
		>
			<div
				className="relative mx-auto"
				style={{
					width: PREVIEW_WIDTH_PX * scale,
					height: height * scale,
				}}
			>
				<div
					className="absolute left-0 top-0 bg-white shadow-sm"
					style={{
						width: PREVIEW_WIDTH_PX,
						height,
						transform: `scale(${scale})`,
						transformOrigin: 'top left',
					}}
				>
					<iframe
						title="پیش‌نمایش فاکتور"
						srcDoc={html}
						className="block mx-auto border-0 bg-white"
						style={{ width: RECEIPT_PROBE_PX, height: '100%' }}
					/>
				</div>
			</div>
		</div>
	)
}
