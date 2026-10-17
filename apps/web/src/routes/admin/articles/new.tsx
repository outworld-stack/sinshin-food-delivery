// src/routes/admin/articles/new.tsx
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createArticle } from '#/server/articles'
import { ArticleForm } from '#/components/admin/ArticleForm'
import { qk } from '#/utils/queryKeys'
import { useToastStore } from '#/stores/toastStore'
import { usePermissions } from '#/hooks/admin/usePermissions'
import { PermissionGate } from '#/components/shared/PermissionGate'
import type { ArticleFormData } from '#/types/forms'

export const Route = createFileRoute('/admin/articles/new')({
  component: NewArticlePage,
})

function NewArticlePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const showToast = useToastStore((state) => state.showToast)
  // stage-82 — گارد: ادمین اصلی همیشه؛ ادمین۲ فقط با articlesWrite
  const { permissions } = usePermissions()

  // ورودی کاملاً تایپ‌دار (قبلاً data: any بود) —
  // subCategoryId با ?? null نرمال می‌شه چون اسکیمای سرور null می‌خواد
  // (blocks در data هست — ArticleFormData از استیج-۸۲ سند بلوکی دارد)
  const mutation = useMutation({
    mutationFn: (data: ArticleFormData) =>
      createArticle({ ...data, subCategoryId: data.subCategoryId ?? null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.adminArticles })
      showToast('مقاله جدید با موفقیت افزوده شد')
      navigate({ to: '/admin/articles' })
    }
  })

  if (!permissions.articlesWrite) {
    return <PermissionGate hasAccess={false} pageName="افزودن مقاله جدید" />
  }

  return (
    <div className="space-y-6">
      <h1 className="font-MorabbaBold text-3xl text-gray-800 dark:text-white">افزودن مقاله جدید</h1>
      <ArticleForm onSubmit={mutation.mutate} isSubmitting={mutation.isPending} />
    </div>
  )
}