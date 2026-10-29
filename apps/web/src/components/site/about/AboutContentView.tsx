import { type AboutContentDto, isArticleBlockUrl } from '@sinshin/shared'
import { Link } from '@tanstack/react-router'
import { ArticleBlocksRenderer } from '#/components/site/articles/ArticleBlocksRenderer'
import { ArticleLocationMap } from '#/components/site/articles/ArticleLocationMap'
import { ArticleRouteButton } from '#/components/site/articles/ArticleRouteButton'
import { useI18n } from '#/i18n'
import { isNeshanCoord } from '#/utils/neshanLinks'

/** Existing installations may still have Tailwind gradients in their image fields. */
function AboutImage({
	src,
	alt,
	hero = false,
}: {
	src: string
	alt: string
	hero?: boolean
}) {
	if (!src.trim()) return null
	const frame = hero
		? 'aspect-[4/3] lg:aspect-[4/5]'
		: 'aspect-[16/9] max-h-[32rem]'
	return isArticleBlockUrl(src) ? (
		<img
			src={src}
			alt={alt}
			loading={hero ? 'eager' : 'lazy'}
			decoding="async"
			className={`w-full object-cover ${frame}`}
		/>
	) : (
		<div
			className={`w-full bg-linear-to-br ${src} ${frame}`}
			role="img"
			aria-label={alt}
		/>
	)
}

export function AboutContentView({ content }: { content: AboutContentDto }) {
	const { t } = useI18n()
	const location = content.location
	const hasLocation = location && isNeshanCoord(location.lat, location.lng)
	const hasHeroImage = Boolean(content.heroGradient.trim())
	const hasTeam = Boolean(
		content.teamTitle.trim() || content.teamGradient.trim(),
	)

	return (
		<article className="py-8 sm:py-12 lg:py-20">
			<div className="mx-auto max-w-7xl space-y-12 px-4 sm:space-y-16 sm:px-6 lg:space-y-24 lg:px-8">
				<section
					aria-labelledby="about-heading"
					className={`relative overflow-hidden rounded-3xl border border-primary/10 bg-white shadow-sm dark:border-[#3a151c] dark:bg-[#2a1015] ${hasHeroImage ? 'grid lg:grid-cols-2' : ''}`}
				>
					<div className="flex flex-col items-start justify-center p-6 sm:p-10 lg:p-14">
						<p className="mb-5 flex items-center gap-2 text-sm font-DanaMedium text-primary dark:text-dark-primary">
							<span
								className="h-1.5 w-7 rounded-full bg-current"
								aria-hidden="true"
							/>
							{t['about.eyebrow']}
						</p>
						<h1
							id="about-heading"
							className="text-3xl leading-snug font-MorabbaBold text-gray-900 sm:text-4xl lg:text-5xl dark:text-white"
						>
							{content.heroTitle || t['about.title']}
						</h1>
						{content.heroText.trim() && (
							<p className="mt-6 max-w-2xl whitespace-pre-line text-base leading-9 font-DanaRegular text-gray-600 sm:text-lg dark:text-gray-300">
								{content.heroText}
							</p>
						)}
						<div className="mt-8 flex flex-wrap gap-3">
							<Link
								to="/products"
								className="rounded-xl bg-primary px-6 py-3 text-sm font-DanaDemiBold text-white transition hover:opacity-90 dark:bg-dark-primary"
							>
								{t['about.menu']}
							</Link>
							{hasLocation && (
								<a
									href="#restaurant-location"
									className="rounded-xl border border-gray-200 px-6 py-3 text-sm font-DanaMedium text-gray-700 transition hover:border-primary dark:border-[#4a1a24] dark:text-gray-200"
								>
									{t['about.visit']}
								</a>
							)}
						</div>
					</div>
					{hasHeroImage && (
						<div className="overflow-hidden">
							<AboutImage
								src={content.heroGradient}
								alt={t['about.heroAlt']}
								hero
							/>
						</div>
					)}
				</section>

				{content.blocks && <ArticleBlocksRenderer doc={content.blocks} />}

				{hasTeam && (
					<section
						aria-labelledby={
							content.teamTitle.trim() ? 'about-team-heading' : undefined
						}
					>
						{content.teamTitle.trim() && (
							<h2
								id="about-team-heading"
								className="mb-7 text-2xl font-MorabbaBold text-gray-900 sm:text-3xl dark:text-white"
							>
								{content.teamTitle}
							</h2>
						)}
						{content.teamGradient.trim() && (
							<div className="overflow-hidden rounded-3xl">
								<AboutImage src={content.teamGradient} alt={content.teamAlt} />
							</div>
						)}
					</section>
				)}

				{hasLocation && (
					<section
						id="restaurant-location"
						aria-labelledby="about-location-heading"
						className="scroll-mt-28 overflow-hidden rounded-3xl border border-gray-200 bg-white dark:border-[#3a151c] dark:bg-[#2a1015]"
					>
						<div className="p-6 sm:p-8">
							<p className="mb-2 text-sm font-DanaMedium text-primary dark:text-dark-primary">
								{t['about.visit']}
							</p>
							<h2
								id="about-location-heading"
								className="text-2xl font-MorabbaBold text-gray-900 sm:text-3xl dark:text-white"
							>
								{t['about.locationTitle']}
							</h2>
							{location.address && (
								<address className="mt-4 whitespace-pre-line text-sm leading-7 text-gray-600 not-italic dark:text-gray-300">
									{location.address}
								</address>
							)}
						</div>
						<div className="px-4 sm:px-8">
							<ArticleLocationMap
								lat={location.lat}
								lng={location.lng}
								label={t['about.locationTitle']}
							/>
						</div>
						<div className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
							<p className="max-w-lg text-sm leading-7 text-gray-500 dark:text-gray-400">
								{t['about.locationText']}
							</p>
							<ArticleRouteButton lat={location.lat} lng={location.lng} />
						</div>
					</section>
				)}
			</div>
		</article>
	)
}
