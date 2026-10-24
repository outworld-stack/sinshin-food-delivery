import { useRouterState } from '@tanstack/react-router'
import type { Lang } from '#/i18n'
import { PushAutoPrompt } from './PushAutoPrompt'
import { PwaRegister } from './register-sw'

/** Banners share normal flow, so translated/wrapped text cannot overlap them. */
export function PwaPrompts({ lang }: { lang: Lang }) {
	const hasInlineActions = useRouterState({
		select: (state) => state.location.pathname === '/',
	})
	return (
		<div className="pointer-events-none fixed inset-x-0 bottom-0 z-90 flex max-h-[calc(100dvh-1rem)] flex-col items-center gap-3 overflow-y-auto px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] [&>*]:pointer-events-auto">
			<PwaRegister lang={lang} showAutomaticInstall={!hasInlineActions} />
			<PushAutoPrompt suppressPromotion={hasInlineActions} />
		</div>
	)
}
