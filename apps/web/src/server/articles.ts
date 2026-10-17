// ═══════════════════════════════════════════════════════════════
// round-34 — sinshin-food-delivery — فایل 45 از 49
// مسیر مقصد: apps/web/src/server/articles.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty
// ═══════════════════════════════════════════════════════════════

// src/server/articles.ts — تماماً API
import { authJson, getJson } from '#/lib/api-fetch'
import type { ArticleBlocksDoc, ArticleCategoryDto, ArticleDto, ArticleSummaryDto } from '@sinshin/shared'

// ─── عمومی ───

export async function getArticleCategories(): Promise<ArticleCategoryDto[]> {
  return getJson<ArticleCategoryDto[]>('/articles/categories')
}

// round-17 — لیست‌ها ArticleSummaryDto برمی‌گردانند (بدون content/processes/گالری)؛
// جزئیات همان ArticleDto کامل است.
export async function getArticles(input: {
  data: { categorySlug?: string; subCategorySlug?: string }
}): Promise<ArticleSummaryDto[]> {
  const params = new URLSearchParams()
  if (input.data.categorySlug && input.data.categorySlug !== 'all') {
    params.set('category', input.data.categorySlug)
  }
  if (input.data.subCategorySlug && input.data.subCategorySlug !== 'all') {
    params.set('sub', input.data.subCategorySlug)
  }
  const qs = params.toString()
  return getJson<ArticleSummaryDto[]>(`/articles${qs ? `?${qs}` : ''}`)
}

export async function getArticleById(input: {
  data: { id: string }
}): Promise<ArticleDto | null> {
  // An invalid route id is a missing article, not an API validation error page.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.data.id)) return null
  return getJson<ArticleDto | null>(`/articles/${encodeURIComponent(input.data.id)}`)
}

// ─── ادمین ───

export async function getAdminArticleCategories(): Promise<ArticleCategoryDto[]> {
  return authJson<ArticleCategoryDto[]>('/admin/articles/categories', 'GET')
}

export async function getAdminArticles(): Promise<ArticleSummaryDto[]> {
  return authJson<ArticleSummaryDto[]>('/admin/articles', 'GET')
}

export async function createArticle(input: {
  title: string
  excerpt: string
  content: string
  author?: string
  profileImage?: string
  galleryImages?: string[]
  categoryId: string
  subCategoryId?: string | null
  processes: { title: string; items: string[] }[]
  /** stage-60 — پرچم «ویژه/سنجاق» (۴ آیتم اول لیست + Aurora) */
  isFeatured?: boolean
  /** stage-82 — سند بلوکی (null = مقاله‌ی متنی ساده) */
  blocks?: ArticleBlocksDoc | null
  /** round-34 — محتوای عربی ('' → null = بازگشت به فارسی) */
  titleAr?: string | null
  excerptAr?: string | null
  contentAr?: string | null
  processesAr?: { title: string; items: string[] }[] | null
}): Promise<{ success: boolean }> {
  return authJson<{ success: boolean }>('/admin/articles', 'POST', {
    ...input,
    titleAr: input.titleAr?.trim() || null,
    excerptAr: input.excerptAr?.trim() || null,
    contentAr: input.contentAr?.trim() || null,
    processesAr: input.processesAr && input.processesAr.length > 0 ? input.processesAr : null,
  })
}

export async function updateArticle(input: {
  id: string
  title: string
  excerpt: string
  content: string
  author?: string
  profileImage?: string | null
  galleryImages?: string[]
  categoryId: string
  subCategoryId?: string | null
  processes?: { title: string; items: string[] }[]
  /** stage-60 — پرچم «ویژه/سنجاق» (۴ آیتم اول لیست + Aurora) */
  isFeatured?: boolean
  /** stage-82 — سند بلوکی (null = پاک‌کردن → مقاله‌ی متنی) */
  blocks?: ArticleBlocksDoc | null
  /** round-34 — محتوای عربی ('' → null = بازگشت به فارسی) */
  titleAr?: string | null
  excerptAr?: string | null
  contentAr?: string | null
  processesAr?: { title: string; items: string[] }[] | null
}): Promise<{ success: boolean }> {
  const { id, ...body } = input
  return authJson<{ success: boolean }>(`/admin/articles/${encodeURIComponent(id)}`, 'PATCH', {
    ...body,
    ...(input.titleAr !== undefined ? { titleAr: input.titleAr?.trim() || null } : {}),
    ...(input.excerptAr !== undefined ? { excerptAr: input.excerptAr?.trim() || null } : {}),
    ...(input.contentAr !== undefined ? { contentAr: input.contentAr?.trim() || null } : {}),
    ...(input.processesAr !== undefined ? { processesAr: input.processesAr?.length ? input.processesAr : null } : {}),
  })
}

export async function deleteArticle(id: string): Promise<{ success: boolean }> {
  return authJson<{ success: boolean }>(`/admin/articles/${id}`, 'DELETE')
}

export async function toggleArticleStatus(id: string): Promise<void> {
  await authJson<unknown>(`/admin/articles/${id}/toggle`, 'POST')
}

export async function getAdminArticleDetails(id: string): Promise<ArticleDto | null> {
  return authJson<ArticleDto | null>(`/admin/articles/${id}`, 'GET')
}

// ─── دسته‌بندی مقالات (ادمین) ───

export async function createArticleCategory(input: {
  name: string
  hasSubCategories: boolean
  subCategories: string[]
  /** round-34 — نام عربی + ساب‌دسته‌های عربی (موازی با subCategories) */
  nameAr?: string | null
  subCategoriesAr?: string[] | null
}): Promise<{ success: boolean }> {
  return authJson<{ success: boolean }>('/admin/articles/categories', 'POST', {
    ...input,
    nameAr: input.nameAr?.trim() || null,
    subCategoriesAr: input.subCategoriesAr ?? null,
  })
}

export async function updateArticleCategory(input: {
  id: string
  name: string
  hasSubCategories: boolean
  subCategories: string[]
  /** round-34 — نام عربی + ساب‌دسته‌های عربی (موازی با subCategories) */
  nameAr?: string | null
  subCategoriesAr?: string[] | null
}): Promise<void> {
  const { id, ...body } = input
  await authJson<unknown>(`/admin/articles/categories/${encodeURIComponent(id)}`, 'PATCH', {
    ...body,
    ...(input.nameAr !== undefined ? { nameAr: input.nameAr?.trim() || null } : {}),
    ...(input.subCategoriesAr !== undefined ? { subCategoriesAr: input.subCategoriesAr } : {}),
  })
}

export async function deleteArticleCategory(id: string): Promise<{ success: boolean; message?: string }> {
  return authJson<{ success: boolean; message?: string }>(
    `/admin/articles/categories/${id}`,
    'DELETE',
  )
}




export type { ArticleCategoryDto as ArticleCategory } from '@sinshin/shared'
