// src/routes/gallery/index.tsx
import { createFileRoute } from '@tanstack/react-router'
import { memo, useMemo } from 'react'
import { useGalleryPage } from '#/hooks/site/useGalleryPage'
import { galleryImagesOptions } from '#/utils/queryOptions'
import { GalleryImage } from '#/components/site/gallery/GalleryImage'
import { GalleryLightbox } from '#/components/site/gallery/GalleryLightbox'
import { GalleryPageSkeleton } from '#/components/LoadingSkeletons'
import { RouteError } from '#/components/shared/RouteFallbacks'
import { SITE_URL } from '#/lib/site'

const GalleryPage = memo(function GalleryPage() {
  const page = useGalleryPage()

  // چیدمان: اولین wide عکس + بقیه — مشابه اصل کارفرما (۴+۸ بعد ۳×۳)
  const layout = useMemo(() => {
    const images = page.images
    if (images.length === 0) return { hero: null, first: [], second: [] }
    // wide اول hero (col-span-8) + بعدی کنارش (col-span-4) — بقیه ۳تایی
    const wideIdx = images.findIndex(i => i.span === 'wide')
    const hero = wideIdx > -1 ? images[wideIdx] : images[0]
    const rest = images.filter(i => i.id !== hero.id)
    return { hero, first: rest.slice(0, 1), second: rest.slice(1) }
  }, [page.images])

  if (page.isLoading) {
    return <GalleryPageSkeleton />
  }

  return (
    <section className="py-10 md:mb-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* هدر — روح کارفرما */}
        <div className="grid gap-2.5 lg:pb-16 pb-10">
          {/* سئو-۷: عنوان صفحه — از h2 به h1 ارتقا (تنها h1 صفحه) */}
          <h1 className="w-full text-center text-gray-900 dark:text-white text-4xl font-DanaDemiBold leading-normal">
            سین شین ما
          </h1>
          <div className="w-full text-center text-gray-600 dark:text-gray-400 text-lg font-DanaMedium leading-8">
            با محیطی آرام آرامش چشیدن طعم غذای لذیذ ما را تجربه کنید
          </div>
        </div>

        <div className="flex flex-col">
          {/* ردیف hero — مثل اصل: ۴ + ۸ */}
          {layout.hero && (
            <div className="grid md:grid-cols-12 gap-8 lg:mb-11 mb-7">
              <div className="md:col-span-4">
                {layout.first[0]
                  ? <GalleryImage image={layout.first[0]} onOpen={page.handleOpen} />
                  : <div className="w-full h-full rounded-3xl bg-gray-100 dark:bg-[#1a0a0e]" />
                }
              </div>
              <div className="md:col-span-8">
                <GalleryImage image={layout.hero} onOpen={page.handleOpen} />
              </div>
            </div>
          )}

          {/* ردیف دوم — ۳ ستونی */}
          <div className="grid md:grid-cols-3 grid-cols-1 gap-8">
            {layout.second.map(img => (
              <div key={img.id} className="md:h-69.25 h-55">
                <GalleryImage image={img} onOpen={page.handleOpen} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Lightbox — کنترل‌شده */}
      <GalleryLightbox
        src={page.state.lightboxSrc}
        alt={page.state.lightboxAlt}
        onClose={page.handleClose}
      />
    </section>
  )
})

export const Route = createFileRoute('/gallery/')({
  component: GalleryPage,
  // SSR — عکس‌ها قبل از رندر در کش؛ HTML کامل برای کرالر (گالری = محتوای سایت)
  loader: ({ context }) => context.queryClient.query(galleryImagesOptions),
  pendingComponent: GalleryPageSkeleton,
  errorComponent: RouteError,
  head: () => ({
    meta: [
      { title: 'گالری سین‌شین | محیط و غذاها' },
      { name: 'description', content: 'گالری تصاویر فودپارک سین‌شین — محیط آرام، غذاهای متنوع و لحظه‌های خوش.' },
      { property: 'og:title', content: 'گالری سین‌شین' },
      { property: 'og:type', content: 'website' },
    ],
    links: [{ rel: 'canonical', href: `${SITE_URL}/gallery` }],
  }),
})