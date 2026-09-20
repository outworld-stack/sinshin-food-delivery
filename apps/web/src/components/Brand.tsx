// src/components/Brand.tsx
import { Link } from '@tanstack/react-router'
import type { BrandProps } from '#/types/shared/ui'


export function Brand({ textSize = 'text-xl sm:text-4xl', to = '/' }: BrandProps) {
    return (
        <Link to={to} className="relative inline-block before:absolute before:-inset-2.5 before:block before:skew-y-3 before:bg-primary dark:before:bg-dark-primary transition-all">
            <span className={`relative font-MorabbaBold ${textSize} select-none text-white`}>
                سین شین
            </span>
        </Link>
    )
}