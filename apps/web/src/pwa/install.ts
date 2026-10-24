export const PWA_INSTALL_REQUEST_EVENT = 'sinshin:install-request'

// appinstalled can fire in a normal browser tab. Remember it for this window
// so buttons mounted by later route changes agree with the root install hook.
// Do not persist across page loads: the user may uninstall the app later.
const installedWindows = new WeakSet<Window>()

export function rememberPwaInstallation(): void {
	if (typeof window !== 'undefined') installedWindows.add(window)
}

export interface InstallPromptEvent extends Event {
	prompt(): Promise<void>
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function isInstalledPwa(): boolean {
	if (typeof window === 'undefined') return false
	return (
		installedWindows.has(window) ||
		window.matchMedia?.('(display-mode: standalone)').matches === true ||
		(window.navigator as Navigator & { standalone?: boolean }).standalone ===
			true
	)
}

export function isIosInstallDevice(): boolean {
	if (typeof navigator === 'undefined') return false
	return (
		/iphone|ipad|ipod/i.test(navigator.userAgent) ||
		(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
	)
}
