import { useCallback, useEffect, useRef, useState } from 'react'
import {
	type InstallPromptEvent,
	isInstalledPwa,
	isIosInstallDevice,
	PWA_INSTALL_REQUEST_EVENT,
	rememberPwaInstallation,
} from './install'

const DISMISS_KEY = 'sinshin-install-dismissed'
const IOS_DISMISS_KEY = 'sinshin-ios-dismissed'
const DISMISS_MS = 30 * 86400000

function dismissedWithin(key: string): boolean {
	try {
		const raw = localStorage.getItem(key)
		return !!raw && Date.now() - Number(raw) < DISMISS_MS
	} catch {
		return false
	}
}

function markDismissed(key: string): void {
	try {
		localStorage.setItem(key, String(Date.now()))
	} catch {
		/* Storage is optional. */
	}
}

/** Installation access is independent of service-worker support and build mode. */
export function usePwaInstall() {
	const [standalone, setStandalone] = useState(false)
	const [showInstall, setShowInstall] = useState(false)
	const [showIosGuide, setShowIosGuide] = useState(false)
	const [showInstallGuide, setShowInstallGuide] = useState(false)
	const promptRef = useRef<InstallPromptEvent | null>(null)
	const promptingRef = useRef(false)
	const installedRef = useRef(false)
	const mountedRef = useRef(false)
	const generationRef = useRef(0)
	const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

	const requestInstall = useCallback(async () => {
		if (!mountedRef.current || installedRef.current || promptingRef.current)
			return
		clearTimeout(timerRef.current)
		setShowInstall(false)
		setShowIosGuide(false)
		const prompt = promptRef.current
		if (!prompt) {
			setShowInstallGuide(true)
			return
		}
		// The event is single-use. Consume before calling the browser, while the
		// click's user activation is still live (never defer prompt() to an effect).
		promptRef.current = null
		promptingRef.current = true
		setShowInstallGuide(false)
		const generation = generationRef.current
		try {
			await prompt.prompt()
			const { outcome } = await prompt.userChoice
			if (
				!mountedRef.current ||
				generation !== generationRef.current ||
				installedRef.current
			)
				return
			if (outcome === 'dismissed') markDismissed(DISMISS_KEY)
			// Acceptance does not prove that the OS completed installation.
		} catch {
			if (
				mountedRef.current &&
				generation === generationRef.current &&
				!installedRef.current
			) {
				setShowInstallGuide(true)
			}
		} finally {
			if (generation === generationRef.current) promptingRef.current = false
		}
	}, [])

	useEffect(() => {
		mountedRef.current = true
		generationRef.current += 1
		installedRef.current = isInstalledPwa()
		setStandalone(installedRef.current)

		const hideInstall = () => {
			clearTimeout(timerRef.current)
			promptRef.current = null
			setShowInstall(false)
			setShowIosGuide(false)
			setShowInstallGuide(false)
		}
		const onBeforeInstall = (event: Event) => {
			event.preventDefault()
			if (installedRef.current) return
			promptRef.current = event as InstallPromptEvent
			clearTimeout(timerRef.current)
			if (dismissedWithin(DISMISS_KEY)) return
			timerRef.current = setTimeout(() => {
				if (
					mountedRef.current &&
					!installedRef.current &&
					!promptingRef.current &&
					promptRef.current
				) {
					setShowInstall(true)
				}
			}, 3000)
		}
		const onAppInstalled = () => {
			rememberPwaInstallation()
			installedRef.current = true
			setStandalone(true)
			hideInstall()
			try {
				localStorage.removeItem(DISMISS_KEY)
			} catch {
				/* Storage is optional. */
			}
		}
		const onRequest = () => {
			void requestInstall()
		}
		const media = window.matchMedia?.('(display-mode: standalone)')
		const onDisplayMode = () => {
			if (!isInstalledPwa()) return
			installedRef.current = true
			setStandalone(true)
			hideInstall()
		}
		window.addEventListener('beforeinstallprompt', onBeforeInstall)
		window.addEventListener('appinstalled', onAppInstalled)
		window.addEventListener(PWA_INSTALL_REQUEST_EVENT, onRequest)
		if (media?.addEventListener) media.addEventListener('change', onDisplayMode)
		else media?.addListener?.(onDisplayMode)

		if (
			isIosInstallDevice() &&
			!installedRef.current &&
			!dismissedWithin(IOS_DISMISS_KEY)
		) {
			setShowIosGuide(true)
		}

		return () => {
			mountedRef.current = false
			generationRef.current += 1
			promptingRef.current = false
			promptRef.current = null
			clearTimeout(timerRef.current)
			window.removeEventListener('beforeinstallprompt', onBeforeInstall)
			window.removeEventListener('appinstalled', onAppInstalled)
			window.removeEventListener(PWA_INSTALL_REQUEST_EVENT, onRequest)
			if (media?.removeEventListener)
				media.removeEventListener('change', onDisplayMode)
			else media?.removeListener?.(onDisplayMode)
		}
	}, [requestInstall])

	return {
		standalone,
		showInstall,
		showIosGuide,
		showInstallGuide,
		requestInstall,
		dismissInstall: () => {
			clearTimeout(timerRef.current)
			setShowInstall(false)
			markDismissed(DISMISS_KEY)
		},
		dismissIosGuide: () => {
			setShowIosGuide(false)
			markDismissed(IOS_DISMISS_KEY)
		},
		closeInstallGuide: () => {
			setShowInstallGuide(false)
		},
	}
}
