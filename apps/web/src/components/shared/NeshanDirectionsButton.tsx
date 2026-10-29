import { memo, useEffect, useId, useRef, useState } from 'react'
import { useI18n } from '#/i18n'
import {
	isNeshanCoord,
	type NeshanOrigin,
	type NeshanTarget,
	neshanAppDirectionsUrl,
	neshanPlatform,
	neshanWebDirectionsUrl,
	readNeshanPreference,
	saveNeshanPreference,
} from '#/utils/neshanLinks'

interface NeshanDirectionsButtonProps {
	lat: number
	lng: number
}

export const NeshanDirectionsButton = memo(function NeshanDirectionsButton({
	lat,
	lng,
}: NeshanDirectionsButtonProps) {
	const { t } = useI18n()
	const titleId = useId()
	const hintId = useId()
	const [open, setOpen] = useState(false)
	const [locating, setLocating] = useState(false)
	const [origin, setOrigin] = useState<NeshanOrigin | null>(null)
	const [target, setTarget] = useState<NeshanTarget>('web')
	const [saved, setSaved] = useState<NeshanTarget | null>(null)
	const [appAttempted, setAppAttempted] = useState(false)
	const triggerRef = useRef<HTMLButtonElement | null>(null)
	const dialogRef = useRef<HTMLDialogElement | null>(null)
	const pendingRef = useRef<symbol | null>(null)
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const openRef = useRef(false)
	const launchedRef = useRef(false)
	const valid = isNeshanCoord(lat, lng)

	const cancelPending = () => {
		pendingRef.current = null
		if (timerRef.current !== null) clearTimeout(timerRef.current)
		timerRef.current = null
	}
	const close = () => {
		cancelPending()
		openRef.current = false
		setOpen(false)
		setLocating(false)
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: A new destination invalidates pending GPS and any prepared links.
	useEffect(() => {
		close()
		return () => {
			cancelPending()
			openRef.current = false
		}
	}, [lat, lng])

	useEffect(() => {
		const dialog = dialogRef.current
		if (!open || !dialog) return
		// Native top-layer dialog escapes article animation transforms, traps
		// focus, makes the page inert, and restores focus when closed.
		dialog.showModal()
		const previousOverflow = document.body.style.overflow
		document.body.style.overflow = 'hidden'
		return () => {
			dialog.close()
			document.body.style.overflow = previousOverflow
			// React removes the dialog before passive-effect cleanup, so native
			// focus restoration alone cannot reliably return to the trigger.
			triggerRef.current?.focus({ preventScroll: true })
		}
	}, [open])

	const prepare = () => {
		if (openRef.current || !valid) return
		openRef.current = true
		launchedRef.current = false
		const preference = readNeshanPreference()
		setSaved(preference)
		setTarget(preference ?? 'web')
		setAppAttempted(false)
		setOrigin(null)
		setLocating(true)
		setOpen(true)
		const pending = Symbol('neshan-directions')
		pendingRef.current = pending
		const finish = (position: NeshanOrigin | null) => {
			if (pendingRef.current !== pending) return
			cancelPending()
			setOrigin(position)
			setLocating(false)
		}
		const fallback = () => finish(null)
		if (typeof navigator === 'undefined' || !navigator.geolocation) {
			fallback()
			return
		}
		// Browser GPS timeout may exclude time spent in a permission prompt.
		timerRef.current = setTimeout(fallback, 12_000)
		try {
			navigator.geolocation.getCurrentPosition(
				({ coords }) =>
					finish(
						isNeshanCoord(coords.latitude, coords.longitude)
							? { lat: coords.latitude, lng: coords.longitude }
							: null,
					),
				fallback,
				{ enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
			)
		} catch {
			fallback()
		}
	}

	const webUrl = valid ? neshanWebDirectionsUrl(lat, lng, origin) : undefined
	const launch = (remember: boolean) => {
		if (
			!openRef.current ||
			pendingRef.current ||
			locating ||
			!valid ||
			!webUrl ||
			launchedRef.current
		)
			return
		launchedRef.current = true
		if (remember) saveNeshanPreference(target)
		if (target === 'web') {
			close()
			window.location.assign(webUrl)
			return
		}
		setAppAttempted(true)
		// This call must remain synchronous with the chooser button click.
		// Async GPS callbacks lose browser activation required for app intents.
		const href = neshanAppDirectionsUrl(
			lat,
			lng,
			origin,
			neshanPlatform(navigator),
		)
		try {
			window.location.assign(href)
		} catch {
			window.location.assign(webUrl)
		}
	}

	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				onClick={prepare}
				disabled={open || !valid}
				className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaMedium text-sm cursor-pointer hover:opacity-90 transition disabled:opacity-60"
			>
				{t['article.routeMap']}
			</button>
			{open && (
				<dialog
					ref={dialogRef}
					aria-labelledby={titleId}
					aria-describedby={hintId}
					onCancel={(event) => {
						event.preventDefault()
						close()
					}}
					onKeyDown={(event) => {
						if (event.key === 'Escape') {
							event.preventDefault()
							close()
						}
					}}
					onClick={(event) => {
						if (event.target === event.currentTarget) close()
					}}
					className="m-auto w-[calc(100%_-_2rem)] max-w-md max-h-[90dvh] overflow-y-auto rounded-3xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#241016] p-0 text-start text-gray-900 dark:text-white shadow-2xl backdrop:bg-black/55 backdrop:backdrop-blur-sm"
				>
					<div className="space-y-5 p-6">
						<h2 id={titleId} className="font-MorabbaBold text-xl">
							{t['article.routeChooseTitle']}
						</h2>
						<p
							id={hintId}
							className="text-sm leading-relaxed text-gray-600 dark:text-gray-300"
						>
							{t['article.routeChooseHint']}
						</p>
						{appAttempted ? (
							<div className="space-y-4">
								<output className="block text-sm leading-relaxed">
									{t['article.routeAppFallback']}
								</output>
								<a
									href={webUrl}
									className="block rounded-xl bg-primary dark:bg-dark-primary px-4 py-3 text-center font-DanaMedium text-white"
								>
									{t['article.routeWebsite']}
								</a>
							</div>
						) : (
							<>
								<fieldset className="space-y-3">
									<legend className="sr-only">
										{t['article.routeChooseTitle']}
									</legend>
									{(['web', 'app'] as const).map((choice) => (
										<label
											key={choice}
											className={`flex cursor-pointer items-center gap-3 rounded-2xl border p-4 transition ${target === choice ? 'border-primary dark:border-dark-primary bg-primary/5 dark:bg-dark-primary/10' : 'border-gray-200 dark:border-white/15'}`}
										>
											<input
												type="radio"
												name={`${titleId}-target`}
												value={choice}
												checked={target === choice}
												onChange={() => setTarget(choice)}
												className="size-4 accent-primary dark:accent-dark-primary"
											/>
											<span className="space-y-1">
												<span className="block font-DanaMedium">
													{choice === 'web'
														? t['article.routeWebsite']
														: t['article.routeApp']}
												</span>
												{choice === 'app' && (
													<span className="block text-xs leading-relaxed text-gray-500 dark:text-gray-400">
														{t['article.routeAppHint']}
													</span>
												)}
											</span>
										</label>
									))}
								</fieldset>
								<output
									aria-live="polite"
									className="block text-sm leading-relaxed text-gray-600 dark:text-gray-300"
								>
									{locating
										? t['article.routeLocating']
										: !origin
											? t['article.routeGpsUnavailable']
											: null}
								</output>
								<div className="space-y-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
									<p>{t['article.routeRememberHint']}</p>
									{saved && (
										<div className="flex flex-wrap items-center gap-2">
											{target === saved && (
												<span>{t['article.routeSaved']}</span>
											)}
											<button
												type="button"
												onClick={() => {
													saveNeshanPreference(null)
													setSaved(null)
												}}
												className="cursor-pointer underline underline-offset-4"
											>
												{t['article.routeForget']}
											</button>
										</div>
									)}
								</div>
								<div className="flex gap-3">
									<button
										type="button"
										disabled={locating}
										onClick={() => launch(false)}
										className="flex-1 cursor-pointer rounded-xl border border-gray-300 dark:border-white/20 px-3 py-3 text-sm font-DanaMedium disabled:opacity-50"
									>
										{t['article.routeOnce']}
									</button>
									<button
										type="button"
										disabled={locating}
										onClick={() => launch(true)}
										className="flex-1 cursor-pointer rounded-xl bg-primary dark:bg-dark-primary px-3 py-3 text-sm font-DanaMedium text-white disabled:opacity-50"
									>
										{t['article.routeAlways']}
									</button>
								</div>
							</>
						)}
						<button
							type="button"
							onClick={close}
							className="w-full cursor-pointer rounded-xl py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-white"
						>
							{t['common.cancel']}
						</button>
					</div>
				</dialog>
			)}
		</>
	)
})
