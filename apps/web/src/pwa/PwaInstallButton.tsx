import { useEffect, useState } from 'react'
import { useI18n } from '#/i18n'
import {
	isInstalledPwa,
	PWA_INSTALL_REQUEST_EVENT,
	rememberPwaInstallation,
} from './install'

/** An explicit install entry remains available after dismissing the banner. */
export function PwaInstallButton({ className = '' }: { className?: string }) {
	const { t } = useI18n()
	const [installed, setInstalled] = useState(false)
	useEffect(() => {
		const display = window.matchMedia?.('(display-mode: standalone)')
		const refresh = () => setInstalled(isInstalledPwa())
		const onInstalled = () => {
			rememberPwaInstallation()
			setInstalled(true)
		}
		refresh()
		window.addEventListener('appinstalled', onInstalled)
		if (display?.addEventListener) display.addEventListener('change', refresh)
		else display?.addListener?.(refresh)
		return () => {
			window.removeEventListener('appinstalled', onInstalled)
			if (display?.removeEventListener)
				display.removeEventListener('change', refresh)
			else display?.removeListener?.(refresh)
		}
	}, [])
	if (installed) return null
	return (
		<button
			type="button"
			onClick={() => window.dispatchEvent(new Event(PWA_INSTALL_REQUEST_EVENT))}
			className={`inline-flex items-center justify-center min-h-12 px-4 py-3 rounded-2xl border border-primary/30 text-primary dark:text-dark-primary text-sm sm:text-base font-DanaMedium cursor-pointer hover:bg-primary/10 transition ${className}`}
		>
			{t['pwa.install']}
		</button>
	)
}
