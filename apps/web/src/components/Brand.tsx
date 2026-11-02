// src/components/Brand.tsx
import { Link } from '@tanstack/react-router'
import type { BrandProps } from '#/types/shared/ui'

export function Brand({
	textSize = 'text-xl sm:text-4xl',
	to = '/',
}: BrandProps) {
	return (
		<Link to={to} className="relative inline-block transition-all">
			{/* Percentage spacing uses the background width: half/full tan(3deg) keeps
                the original corners. Each clipped edge overlaps the center by 1px to avoid seams. */}
			<span aria-hidden="true" className="absolute -inset-2.5">
				<span
					className="absolute inset-0 my-[2.620389%] bg-primary dark:bg-dark-primary
                    before:absolute before:inset-x-0 before:bottom-[calc(100%_-_1px)] before:pt-[calc(5.240778%_+_1px)] before:bg-inherit
                    before:[-webkit-clip-path:polygon(0_0,100%_calc(100%_-_1px),100%_100%,0_100%)] before:[clip-path:polygon(0_0,100%_calc(100%_-_1px),100%_100%,0_100%)]
                    after:absolute after:inset-x-0 after:top-[calc(100%_-_1px)] after:pt-[calc(5.240778%_+_1px)] after:bg-inherit
                    after:[-webkit-clip-path:polygon(0_0,100%_0,100%_100%,0_1px)] after:[clip-path:polygon(0_0,100%_0,100%_100%,0_1px)]"
				/>
			</span>
			<span
				className={`relative font-MorabbaBold ${textSize} select-none text-white`}
			>
				سین شین
			</span>
		</Link>
	)
}
