// src/routes/admin/articles/new.tsx
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createArticle } from '#/server/articles'
import { ArticleForm } from '#/components/admin/ArticleForm'
import { qk } from '#/utils/queryKeys'
import { useToastStore } from '#/stores/toastStore'
import type { ArticleFormData } from '#/types/forms'

export const Route = createFileRoute('/admin/articles/new')({
  component: NewArticlePage,
})

function NewArticlePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const showToast = useToastStore((state) => state.showToast)

  // ورودی کاملاً تایپ‌دار (قبلاً data: any بود) —
  // subCategoryId با ?? null نرمال می‌شه چون اسکیمای سرور null می‌خواد
  const mutation = useMutation({
    mutationFn: (data: ArticleFormData) =>
      createArticle({ ...data, subCategoryId: data.subCategoryId ?? null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.adminArticles })
      showToast('مقاله جدید با موفقیت افزوده شد')
      navigate({ to: '/admin/articles' })
    }
  })

  return (
    <div className="space-y-6">
      <h1 className="font-MorabbaBold text-3xl text-gray-800 dark:text-white">افزودن مقاله جدید</h1>
      <ArticleForm onSubmit={mutation.mutate} isSubmitting={mutation.isPending} />
    </div>
  )
}