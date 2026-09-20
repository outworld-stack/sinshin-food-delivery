// src/components/ArticleCard.tsx
import { Link } from '@tanstack/react-router';
import type { ArticleCardProps } from '#/types/shared/ui';

export function ArticleCard({ article }: ArticleCardProps) {
  // استخراج روز، ماه و سال شمسی برای نمایش به سبک سین‌شین
  const dateObj = new Date(article.publishedAt);
  const day = dateObj.toLocaleDateString('fa-IR', { day: 'numeric' });
  const month = dateObj.toLocaleDateString('fa-IR', { month: 'long' });
  const year = dateObj.toLocaleDateString('fa-IR', { year: 'numeric' });

  return (
    <div className="flex h-fit gap-x-2.5 sm:block p-2.5 md:pb-2 bg-gray-50 dark:bg-[#2a1015]/50 border border-gray-300 dark:border-[#3a151c] hover:shadow-md hover:shadow-gray-200/50 dark:hover:shadow-black/20 rounded-2xl transition-shadow duration-300">

      {/* عکس مقاله */}
      <Link
        to="/articles/$articleId"
        params={{ articleId: article.id }}
        className="relative w-28 h-28 sm:aspect-4/3 sm:w-auto sm:h-auto shrink-0 sm:mb-4 rounded-2xl rounded-bl-3xl overflow-hidden block"
      >
        <div
          className="absolute inset-0 w-full h-full bg-gray-200 dark:bg-[#2a1015]"
          style={article.profileImage ? { backgroundImage: `url(${article.profileImage})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
        ></div>
      </Link>

      <div className="w-full flex flex-col sm:flex-row items-start justify-between font-DanaMedium">

        {/* عنوان مقاله */}
        <Link
          to="/articles/$articleId"
          params={{ articleId: article.id }}
          className="font-DanaMedium text-sm/7 mt-2.5 ml-1.5 sm:ml-0 sm:mt-0 md:text-lg line-clamp-2 max-w-48 text-zinc-700 dark:text-white hover:text-primary dark:hover:text-dark-primary transition-colors"
        >
          {article.title}
        </Link>

        {/* جزئیات مقاله در سایز بزرگ (دسکتاپ) */}
        <div className="hidden sm:flex gap-5">
          <span className="hidden lg:block w-px h-15 bg-gray-300 dark:bg-white/15"></span>
          <div className="flex flex-col font-DanaDemiBold ml-3 lg:ml-4 -mt-1 text-primary dark:text-dark-primary text-sm text-left">
            <span className="md:text-xl lg:text-2xl">{day}</span>
            <span>{month}</span>
            <span>{year}</span>
          </div>
        </div>

        {/* جزئیات مقاله در سایز موبایل */}
        <div className="flex items-end font-DanaDemiBold w-full justify-between sm:hidden border-t border-t-gray-300 dark:border-t-white/15 pt-4 pb-1.5 mt-2">
          <div className="flex gap-1">
            <span className="text-primary dark:text-dark-primary text-xs">{day}</span>
            <span className="text-primary dark:text-dark-primary text-xs">{month}</span>
            <span className="text-primary dark:text-dark-primary text-xs">{year}</span>
          </div>
          {/* تگ نویسنده */}
          <h4 className="flex items-center gap-x-1 ml-1.5 text-xs h-5 rounded-md pr-2.5 pl-2 bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary">
            {article.author}
          </h4>
        </div>
      </div>
    </div>
  );
}