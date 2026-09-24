// src/server/articles.ts — تماماً API
import { authJson, getJson } from '#/lib/api-fetch'
import type { ArticleCategoryDto, ArticleDto, ArticleSummaryDto } from '@sinshin/shared'

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
  return getJson<ArticleDto | null>(`/articles/${input.data.id}`)
}

// ─── ادمین ───

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
}): Promise<{ success: boolean }> {
  return authJson<{ success: boolean }>('/admin/articles', 'POST', input)
}

export async function updateArticle(input: {
  id: string
  title: string
  excerpt: string
  content: string
  profileImage?: string
  galleryImages?: string[]
  categoryId: string
  subCategoryId?: string | null
  processes: { title: string; items: string[] }[]
}): Promise<{ success: boolean }> {
  return authJson<{ success: boolean }>(`/admin/articles/${input.id}`, 'PATCH', input)
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
}): Promise<{ success: boolean }> {
  return authJson<{ success: boolean }>('/admin/articles/categories', 'POST', input)
}

export async function updateArticleCategory(input: {
  id: string
  name: string
  hasSubCategories: boolean
  subCategories: string[]
}): Promise<void> {
  await authJson<unknown>(`/admin/articles/categories/${input.id}`, 'PATCH', input)
}

export async function deleteArticleCategory(id: string): Promise<{ success: boolean; message?: string }> {
  return authJson<{ success: boolean; message?: string }>(
    `/admin/articles/categories/${id}`,
    'DELETE',
  )
}




export type { ArticleCategoryDto as ArticleCategory } from '@sinshin/shared'