import { useNavigate } from '@tanstack/react-router'
import { type CSSProperties, memo, useEffect, useRef, useState } from 'react'
import { tpl, useI18nSafe } from '#/i18n'
import { useCartStore } from '#/stores/cartStore'

// The same duration drives the CSS fuse and its lifetime, including reduced motion.
const ORB_TRAVEL_MS = 5_000
const ORB_FADE_MS = 200

type OrbPhase = 'hidden' | 'running' | 'fading'

export const CartPulseOrb = memo(function CartPulseOrb({
	raised = false,
}: {
	raised?: boolean
}) {
	const navigate = useNavigate()
	const totalItems = useCartStore((state) => state.getTotalItems())
	const addTick = useCartStore((state) => state.addTick)
	const { t, fmt } = useI18nSafe()

	const [phase, setPhase] = useState<OrbPhase>('hidden')
	const travelTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
	const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
	const lastTick = useRef(addTick)

	useEffect(() => {
		// Restoring a saved cart or opening this page must not replay an add event.
		if (addTick === lastTick.current) return
		lastTick.current = addTick

		if (travelTimer.current !== null) clearTimeout(travelTimer.current)
		if (fadeTimer.current !== null) clearTimeout(fadeTimer.current)

		setPhase('running')

		travelTimer.current = setTimeout(() => {
			travelTimer.current = null
			setPhase('fading')
			fadeTimer.current = setTimeout(() => {
				fadeTimer.current = null
				setPhase('hidden')
			}, ORB_FADE_MS)
		}, ORB_TRAVEL_MS)
	}, [addTick])

	useEffect(
		() => () => {
			if (travelTimer.current !== null) clearTimeout(travelTimer.current)
			if (fadeTimer.current !== null) clearTimeout(fadeTimer.current)
		},
		[],
	)

	if (phase === 'hidden' || totalItems === 0) return null

	const fading = phase === 'fading'

	// Include phone widths below sm; this feedback stays visible up to lg.
	return (
		<button
			type="button"
			disabled={fading}
			onClick={() => {
				if (travelTimer.current !== null) clearTimeout(travelTimer.current)
				if (fadeTimer.current !== null) clearTimeout(fadeTimer.current)
				setPhase('hidden')
				navigate({ to: '/cart' })
			}}
			aria-label={tpl(t['cart.orbLabel'], { n: fmt.num(totalItems) })}
			title={t['header.cart']}
			style={
				{
					'--cart-orb-duration': `${ORB_TRAVEL_MS}ms`,
					'--cart-orb-fade-duration': `${ORB_FADE_MS}ms`,
					bottom: raised
						? 'calc(8rem + env(safe-area-inset-bottom))'
						: undefined,
				} as CSSProperties
			}
			className={`cart-orb fixed bottom-safe right-6 z-40 flex lg:hidden w-14 h-14 md:w-16 md:h-16 items-center justify-center rounded-full cursor-pointer animate-pop-in focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary dark:focus-visible:outline-dark-primary ${
				fading
					? 'opacity-0 scale-75 pointer-events-none'
					: 'opacity-100 scale-100'
			}`}
		>
			{/* A keyed fuse restarts at twelve o'clock for every add, including merges. */}
			<span
				key={addTick}
				aria-hidden="true"
				className="cart-orb-fuse pointer-events-none absolute inset-0 rounded-full"
			>
				<span className="cart-orb-ring absolute inset-0 rounded-full" />
			</span>

			<span
				aria-hidden="true"
				className="pointer-events-none absolute inset-1 rounded-full bg-white dark:bg-[#1a0a0e] border border-gray-200 dark:border-white/10 shadow-xl flex items-center justify-center"
			>
				<span className="font-DanaDemiBold text-base md:text-lg text-primary dark:text-dark-primary">
					{fmt.num(totalItems)}
				</span>
			</span>
		</button>
	)
})
