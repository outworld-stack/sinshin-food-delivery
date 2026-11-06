import { useEffect, useRef, useState } from 'react'
import type { useContentTranslationDraft } from '#/hooks/admin/useContentTranslationDraft'
import { useToastStore } from '#/stores/toastStore'

export function ContentTranslationTools({
	translation,
	disabled,
}: {
	translation: ReturnType<typeof useContentTranslationDraft>
	disabled?: boolean
}) {
	const [running, setRunning] = useState(false)
	const mounted = useRef(true)
	const active = useRef(false)
	useEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
		}
	}, [])
	const showToast = useToastStore((state) => state.showToast)
	return (
		<button
			type="button"
			disabled={
				disabled ||
				running ||
				translation.busy ||
				translation.eligibleCount === 0
			}
			className="px-3 py-2 rounded-lg border text-xs cursor-pointer disabled:opacity-50"
			onClick={async () => {
				if (disabled || active.current || translation.busy) return
				active.current = true
				setRunning(true)
				try {
					await translation.translateEligible()
					if (mounted.current)
						showToast('ترجمه فیلدهای لازم آماده بازبینی است؛ ذخیره کنید')
				} catch (error) {
					if (mounted.current)
						showToast(
							error instanceof Error ? error.message : 'ترجمه ناموفق بود',
							'error',
						)
				} finally {
					active.current = false
					if (mounted.current) setRunning(false)
				}
			}}
		>
			{running ? 'در حال ترجمه...' : 'ترجمه فقط فیلدهای نیازمند ترجمه'}
		</button>
	)
}
