// src/routes/articles/$articleId.tsx
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { getArticleById } from '#/server/articles'
import { formatDate } from '#/utils/format'
import { Gallery } from '#/components/Gallery'
import { ArticleDetailSkeleton } from '#/components/LoadingSkeletons'
import { RouteError, RouteNotFound } from '#/components/shared/RouteFallbacks'
import { useBack } from '#/hooks/useBack'
import { ChevronRight, Feather } from 'reicon-react'

export const Route = createFileRoute('/articles/$articleId')({
  component: ArticleDetailPage,

  // رندر سمت سرور — دریافت مستقیم یک مقاله، نه کل لیست (الگوی صفحه محصول)
  loader: async ({ params }) => {
    const article = await getArticleById({ data: { id: params.articleId } })
    if (!article) throw notFound()
    return article
  },

  pendingComponent: ArticleDetailSkeleton,
  errorComponent: RouteError,
  notFoundComponent: RouteNotFound,

  // سئو داینامیک — عنوان و خلاصه مقاله برای گوگل
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
        { title: `${loaderData.title} | سین شین` },
        { name: 'description', content: loaderData.excerpt },
        { property: 'og:title', content: `${loaderData.title} | سین شین` },
        { property: 'og:description', content: loaderData.excerpt },
        { property: 'og:type', content: 'article' },
      ]
      : [{ title: 'مقاله یافت نشد | سین شین' }],
  }),
})

function ArticleDetailPage() {
  // داده از لودر — بدون کوئری کلاینت
  const article = Route.useLoaderData()
  const back = useBack('/articles')

  // گالری — عکس‌های مقاله یا پیش‌فرض
  const galleryImages = article.galleryImages?.length >= 2
    ? article.galleryImages
    : ['from-blue-400 to-purple-500', 'from-green-400 to-teal-500', 'from-orange-400 to-red-500']

  return (
    <div className="py-10 px-4 max-w-3xl mx-auto">
      <button
        type="button"
        onClick={back}
        className="flex items-center cursor-pointer gap-2 text-gray-600 dark:text-gray-300 hover:text-primary dark:hover:text-dark-primary transition mb-8 font-DanaMedium w-fit"
      >
        <ChevronRight size={20} />
        بازگشت
      </button>

      <div className="flex items-center gap-4 mb-6">
        <div className="w-14 h-14 rounded-full bg-gray-200 dark:bg-[#1a0a0e] flex items-center justify-center text-gray-500 dark:text-gray-400">
          <Feather size={24} />
        </div>
        <div className="flex flex-col">
          <span className="font-DanaDemiBold text-gray-800 dark:text-white text-lg">{article.author}</span>
          <span className="text-sm text-gray-500 dark:text-gray-400">{formatDate(article.publishedAt ?? new Date())}
          </span>
        </div>
      </div>

      <h1 className="font-MorabbaBold text-3xl md:text-4xl text-gray-900 dark:text-white mb-6 leading-snug">
        {article.title}
      </h1>

      <div className="w-full aspect-video rounded-3xl mb-8 shadow-lg bg-gray-200 dark:bg-[#2a1015]"
        style={article.profileImage ? { backgroundImage: `url(${article.profileImage})`, backgroundSize: 'cover' } : undefined}
      ></div>

      <p className="text-lg text-gray-600 dark:text-gray-300 mb-8 leading-relaxed border-r-4 border-primary dark:border-dark-primary pr-4">
        {article.excerpt}
      </p>

      <div className="max-w-none text-gray-700 dark:text-gray-300 leading-loose font-DanaRegular space-y-6 mb-8">
        {article.content.split('\n\n').map((p, i) => <p key={i}>{p}</p>)}
      </div>

      <Gallery images={galleryImages} />

      {article.processes && article.processes.length > 0 && (
        <div className="my-8 bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
          <h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-6 pb-4 border-b border-gray-100 dark:border-white/5">روند تهیه</h2>
          <div className="space-y-6">
            {article.processes.map((proc, i) => (
              <div key={i}>
                <h3 className="font-DanaDemiBold text-lg text-primary dark:text-dark-primary mb-3">{proc.title}</h3>
                <ul className="space-y-2">
                  {proc.items.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-gray-700 dark:text-gray-300">
                      <span className="w-2 h-2 rounded-full bg-black dark:bg-white mt-2 shrink-0"></span>
                      <span className="text-sm font-DanaMedium">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-12 pt-8 border-t border-gray-100 dark:border-white/5 flex items-center gap-3 flex-wrap">
        <span className="font-DanaMedium text-gray-500 dark:text-gray-400">تگ‌ها:</span>
        {article.categorySlug && (
          <Link
            to="/articles"
            search={{ category: article.categorySlug }}
            className="cursor-pointer px-4 py-2 rounded-full bg-gray-100 dark:bg-[#2a1015] text-gray-700 dark:text-gray-300 hover:bg-primary hover:text-white dark:hover:bg-dark-primary transition text-sm font-DanaMedium"
          >
            {article.categoryName}
          </Link>
        )}
        {article.subCategorySlug && (
          <Link
            to="/articles"
            search={{ category: article.categorySlug, subCategory: article.subCategorySlug }}
            className="cursor-pointer px-4 py-2 rounded-full bg-gray-100 dark:bg-[#2a1015] text-gray-700 dark:text-gray-300 hover:bg-primary hover:text-white dark:hover:bg-dark-primary transition text-sm font-DanaMedium"
          >
            {article.subCategoryName}
          </Link>
        )}
      </div>
    </div>
  )
}