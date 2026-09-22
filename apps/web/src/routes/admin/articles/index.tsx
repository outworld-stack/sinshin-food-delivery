// src/routes/admin/articles/index.tsx
// ⬅ NEW: loader پری‌فچ موازی (مقالات + دسته‌ها) + pendingComponent/errorComponent + head noindex

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { Ban, Pen, Plus, Trash2 } from 'reicon-react'
import { ArticleCategoryManager } from '#/components/admin/articles/ArticleCategoryManager'
import { ConfirmModal } from '#/components/ConfirmModal'
import { AdminArticlesPageSkeleton } from '#/components/LoadingSkeletons'
import { RouteError } from '#/components/shared/RouteFallbacks'
import { deleteArticle, toggleArticleStatus } from '#/server/articles'
import { useToastStore } from '#/stores/toastStore'
import { qk } from '#/utils/queryKeys'
import {
        adminArticlesOptions,
        articleCategoriesOptions,
} from '#/utils/queryOptions'

export const Route = createFileRoute('/admin/articles/')({
        component: AdminArticlesPage,
        ssr: false,
        // ⬅ NEW: prefetch — هاور روی لینک «مقالات» در سایدبار => این loader در کلاینت
        // هر دو کوئری صفحه را به‌صورت موازی در کش پر می‌کند؛ ناوبری بدون اسکلتون.
        // داده پشت گارد نقش است؛ سرور رندرش نمی‌کند (صفحه noindex است)
        loader: async ({ context }) => {
                await Promise.all([
                        context.queryClient.query(adminArticlesOptions),
                        context.queryClient.query(articleCategoriesOptions),
                ])
        },

        pendingComponent: AdminArticlesPageSkeleton,
        errorComponent: RouteError,

        head: () => ({
                meta: [
                        { title: 'مدیریت مقالات | سین شین' },
                        { name: 'robots', content: 'noindex, nofollow' },
                ],
        }),
})

function AdminArticlesPage() {
        const queryClient = useQueryClient()
        const showToast = useToastStore((state) => state.showToast)

        // ⬅ NEW: کوئری‌ها — همان کلیدهایی که loader روت با query پر کرده
        const { data: articles, isLoading } = useQuery(adminArticlesOptions)
        const { data: categories } = useQuery(articleCategoriesOptions)

        const [confirmToggleArticle, setConfirmToggleArticle] = useState<
                string | null
        >(null)
        const [confirmDeleteArticle, setConfirmDeleteArticle] = useState<
                string | null
        >(null)

        const toggleMut = useMutation({
                mutationFn: (id: string) => toggleArticleStatus(id),
                onSuccess: () => {
                        queryClient.invalidateQueries({ queryKey: qk.adminArticles })
                        showToast('وضعیت مقاله تغییر کرد')
                        setConfirmToggleArticle(null)
                },
        })

        const deleteMut = useMutation({
                mutationFn: (id: string) => deleteArticle(id),
                onSuccess: () => {
                        queryClient.invalidateQueries({ queryKey: qk.adminArticles })
                        showToast('مقاله حذف شد')
                        setConfirmDeleteArticle(null)
                },
        })

        if (isLoading) {
                return <AdminArticlesPageSkeleton />
        }

        return (
                <div className="space-y-6">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                <div>
                                        <h1 className="font-MorabbaBold text-3xl text-gray-800 dark:text-white">
                                                مدیریت مقالات
                                        </h1>
                                        <p className="text-gray-500 dark:text-gray-400 mt-2 font-DanaMedium">
                                                لیست مقالات و دسته‌بندی‌ها
                                        </p>
                                </div>
                                <Link
                                        to="/admin/articles/new"
                                        className="px-5 py-2.5 rounded-xl bg-primary dark:bg-dark-primary text-white font-DanaMedium hover:opacity-90 transition cursor-pointer flex items-center gap-2 justify-center"
                                >
                                        <Plus size={16} />
                                        افزودن مقاله
                                </Link>
                        </div>

                        <div className="flex flex-col gap-6">
                                {/* باکس اصلی مقالات */}
                                <div className="flex-1 bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
                                        <h2 className="font-DanaDemiBold text-lg text-gray-800 dark:text-white mb-6 pb-4 border-b border-gray-100 dark:border-white/5">
                                                لیست مقالات
                                        </h2>

                                        <div className="space-y-4">
                                                {/* هدر دسکتاپ — round-13: ستون عکس حذف شد */}
                                                <div className="hidden lg:grid lg:grid-cols-5 gap-4 px-4 mb-2 text-xs text-gray-400 dark:text-gray-500 font-DanaMedium border-b border-gray-100 dark:border-white/5 pb-2 text-right">
                                                        <div className="col-span-2">عنوان مقاله</div>
                                                        <div>دسته‌بندی</div>
                                                        <div>وضعیت</div>
                                                        <div className="text-left">مدیریت</div>
                                                </div>

                                                {articles?.map((a) => {
                                                        const cat = categories?.find((c) => c.id === a.categoryId)
                                                        return (
                                                                <div
                                                                        key={a.id}
                                                                        className="border border-gray-300 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] p-4"
                                                                >
                                                                        <div className="hidden lg:grid lg:grid-cols-5 gap-4 items-center text-right">
                                                                                <div className="col-span-2 min-w-0">
                                                                                        <p className="font-DanaDemiBold text-gray-800 dark:text-white text-sm truncate">
                                                                                                {a.title}
                                                                                        </p>
                                                                                        <p className="text-xs text-gray-400 mt-1">{a.author}</p>
                                                                                </div>
                                                                                <div className="text-sm text-gray-600 dark:text-gray-300">
                                                                                        {cat?.name}
                                                                                </div>
                                                                                <div>
                                                                                        <span
                                                                                                className={`text-xs font-DanaDemiBold px-2 py-1 rounded-full ${a.status === 'ACTIVE' ? 'bg-green-100 text-green-600 dark:bg-green-500/10 dark:text-green-400' : 'bg-gray-200 text-gray-600 dark:bg-gray-500/10 dark:text-gray-400'}`}
                                                                                        >
                                                                                                {a.status === 'ACTIVE' ? 'فعال' : 'غیرفعال'}
                                                                                        </span>
                                                                                </div>
                                                                                <div className="flex items-center justify-end gap-2">
                                                                                        <Link
                                                                                                to="/admin/articles/$articleId/edit"
                                                                                                params={{ articleId: a.id }}
                                                                                                className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5 cursor-pointer"
                                                                                        >
                                                                                                <Pen size={18} />
                                                                                        </Link>
                                                                                        <button
                                                                                                onClick={() => setConfirmToggleArticle(a.id)}
                                                                                                className={`p-2 rounded-lg cursor-pointer ${a.status === 'ACTIVE' ? 'text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10' : 'text-green-400 hover:bg-green-50 dark:hover:bg-green-500/10'}`}
                                                                                        >
                                                                                                <Ban size={18} />
                                                                                        </button>
                                                                                        <button
                                                                                                onClick={() => setConfirmDeleteArticle(a.id)}
                                                                                                className="p-2 rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 cursor-pointer"
                                                                                        >
                                                                                                <Trash2 size={18} />
                                                                                        </button>
                                                                                </div>
                                                                        </div>

                                                                        {/* کارت موبایل — round-13: بدون عکس */}
                                                                        <div className="lg:hidden flex items-center justify-between gap-3">
                                                                                <div className="min-w-0">
                                                                                        <p className="font-DanaDemiBold text-gray-800 dark:text-white text-sm truncate">
                                                                                                {a.title}
                                                                                        </p>
                                                                                        <p className="text-xs text-gray-400 mt-1 truncate">
                                                                                                {cat?.name} |{' '}
                                                                                                {a.status === 'ACTIVE' ? 'فعال' : 'غیرفعال'}
                                                                                        </p>
                                                                                </div>
                                                                                <div className="flex gap-2">
                                                                                        <Link
                                                                                                to="/admin/articles/$articleId/edit"
                                                                                                params={{ articleId: a.id }}
                                                                                                className="p-2 text-gray-500 cursor-pointer"
                                                                                        >
                                                                                                <Pen size={16} />
                                                                                        </Link>
                                                                                        <button
                                                                                                onClick={() => setConfirmToggleArticle(a.id)}
                                                                                                className={`p-2 cursor-pointer ${a.status === 'ACTIVE' ? 'text-red-400' : 'text-green-400'}`}
                                                                                        >
                                                                                                <Ban size={16} />
                                                                                        </button>
                                                                                        <button
                                                                                                onClick={() => setConfirmDeleteArticle(a.id)}
                                                                                                className="p-2 text-red-400 cursor-pointer"
                                                                                        >
                                                                                                <Trash2 size={16} />
                                                                                        </button>
                                                                                </div>
                                                                        </div>
                                                                </div>
                                                        )
                                                })}
                                        </div>
                                </div>

                                {/* مدیریت دسته‌بندی مقالات (کامپوننت استخراج‌شده) */}
                                <ArticleCategoryManager />
                        </div>

                        {/* مودال تاییدیه تغییر وضعیت مقاله */}
                        <ConfirmModal
                                isOpen={!!confirmToggleArticle}
                                title="تایید تغییر وضعیت"
                                message="آیا از تغییر وضعیت این مقاله مطمئن هستید؟"
                                onConfirm={() => {
                                        if (confirmToggleArticle) toggleMut.mutate(confirmToggleArticle)
                                }}
                                onCancel={() => setConfirmToggleArticle(null)}
                        />

                        {/* مودال تاییدیه حذف مقاله */}
                        <ConfirmModal
                                isOpen={!!confirmDeleteArticle}
                                title="حذف مقاله"
                                message="آیا از حذف این مقاله مطمئن هستید؟ این عملیات قابل بازگشت نیست."
                                onConfirm={() => {
                                        if (confirmDeleteArticle) deleteMut.mutate(confirmDeleteArticle)
                                }}
                                onCancel={() => setConfirmDeleteArticle(null)}
                        />
                </div>
        )
}
