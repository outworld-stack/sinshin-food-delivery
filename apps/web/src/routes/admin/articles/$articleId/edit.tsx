// ═══════════════════════════════════════════════════════════════
// round-34 — sinshin-food-delivery — فایل 31 از 49
// مسیر مقصد: apps/web/src/routes/admin/articles/$articleId/edit.tsx
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty
// ═══════════════════════════════════════════════════════════════

// src/routes/admin/articles/edit.tsx
import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { updateArticle } from '#/server/articles'
import { adminArticleDetailsOptions } from '#/utils/queryOptions'
import { invalidateArticleQueries } from '#/components/admin/articles/invalidateArticleQueries'
import { ArticleForm } from '#/components/admin/ArticleForm'
import { AdminArticleFormSkeleton } from '#/components/LoadingSkeletons'
import { useToastStore } from '#/stores/toastStore'
import { usePermissions } from '#/hooks/admin/usePermissions'
import { PermissionGate } from '#/components/shared/PermissionGate'
import type { ArticleFormData } from '#/types/forms'

export const Route = createFileRoute('/admin/articles/$articleId/edit')({
  component: EditArticlePage,
})

/**
 * کامپوننت صفحه‌ی ویرایش مقاله
 * صفحه‌ای که ادمین برای ویرایش مقاله‌ی موجود استفاده می‌کند
 */
function EditArticlePage() {
  // گرفتن شناسه‌ی مقاله از پارامتر مسیر
  const { articleId } = Route.useParams()
  // قلاب پیمایش صفحه
  const navigate = useNavigate()
  const router = useRouter()
  const queryClient = useQueryClient()
  const showToast = useToastStore((state) => state.showToast)
  // stage-82 — گارد: ادمین اصلی همیشه؛ ادمین۲ فقط با articlesWrite
  const { permissions, isChecking } = usePermissions()

  const { data: article, isLoading, isError, refetch } = useQuery({
    ...adminArticleDetailsOptions(articleId),
    enabled: permissions.articlesWrite,
  })

  // ورودی کاملاً تایپ‌دار (قبلاً data: any بود) —
  // subCategoryId با ?? null نرمال می‌شه چون اسکیمای سرور null می‌خواد
  const mutation = useMutation({
    mutationFn: (data: ArticleFormData) =>
      updateArticle({ id: articleId, ...data, subCategoryId: data.subCategoryId ?? null }),
    onSuccess: async () => {
      await invalidateArticleQueries(queryClient)
      await router.invalidate()
      showToast('مقاله با موفقیت ویرایش شد')
      navigate({ to: '/admin/articles' })
    }
  })

  // stage-82 — گارد: ادمین اصلی همیشه؛ ادمین۲ فقط با articlesWrite
  // (بعد از همه‌ی هوک‌ها — قانونِ useHookAtTopLevel)
  if (isChecking) return <AdminArticleFormSkeleton />

  if (!permissions.articlesWrite) {
    return <PermissionGate hasAccess={false} pageName="ویرایش مقاله" />
  }

  if (isLoading) {
    return <AdminArticleFormSkeleton />
  }

  if (isError || !article) {
    return <div className="space-y-4 text-center py-12">
      <p role={isError ? 'alert' : undefined}>{isError ? 'دریافت مقاله ناموفق بود.' : 'مقاله پیدا نشد یا حذف شده است.'}</p>
      {isError && <button type="button" onClick={() => refetch()} className="px-4 py-2 rounded-lg bg-primary text-white cursor-pointer">تلاش دوباره</button>}
      <Link to="/admin/articles" className="block text-primary underline">بازگشت به مقالات</Link>
    </div>
  }

  return (
    <div className="space-y-6">
      <h1 className="font-MorabbaBold text-3xl text-gray-800 dark:text-white">ویرایش مقاله: {article.title}</h1>
      <ArticleForm key={articleId} initialData={{
        ...article,
        profileImage: article.profileImage ?? '',
        // round-34 — نرمال‌سازی فیلدهای عربی (null → '' = پشتیبان فارسی)
        // stage-60 — پرچم «ویژه» (نیامد = خاموش)
        isFeatured: article.isFeatured ?? false,
        // stage-82 — سند بلوکی (null = مقاله‌ی متنی قدیمی — فرم از متن ساده شروع می‌کند)
        blocks: article.blocks ?? null,
        titleAr: article.titleAr ?? '',
        excerptAr: article.excerptAr ?? '',
        contentAr: article.contentAr ?? '',
        processesAr: article.processesAr ?? [],
      }} onSubmit={mutation.mutate} isSubmitting={mutation.isPending} />
    </div>
  )
}
