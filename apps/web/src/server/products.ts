// src/server/products.ts — منوی عمومی + سبد + پنل ادمین — همه از API واقعی
// phase-3: مرگ products-admin-mock — ویرایش‌ها دیگر با ری‌استارت نمی‌پرند

import { getJson, postJson, authJson } from '#/lib/api-fetch'
import type {
  ProductId,
  SizeId,
  MainCategory,
  Category,
  Product,
  MainData,
  CartDetails,
} from '@sinshin/shared'

// ─── re-export تایپ‌ها برای صفحات (قرارداد قبلی حفظ) ───

export type { MainCategory, Category, Product }

export interface ProductSize {
  id: SizeId
  name: string
  price: number
}

export interface CartItemInput {
  productId: ProductId
  sizeId?: SizeId | null
  quantity: number
}

// ─── عمومی: منو ───

export async function getActiveMainCategories(): Promise<MainCategory[]> {
  return getJson<MainCategory[]>('/menu/mains')
}

export async function getProductsByMain(
  input: { data: { mainSlug: string } },
): Promise<Product[]> {
  const d = await getJson<MainData>(`/menu/mains/${input.data.mainSlug}/products`)
  return d.products
}

export async function getCategoriesByMain(
  input: { data: { mainSlug: string } },
): Promise<Category[]> {
  return getJson<Category[]>(`/menu/mains/${input.data.mainSlug}/categories`)
}

export async function getCategories(): Promise<Category[]> {
  return getJson<Category[]>('/menu/categories')
}

export async function getProductById(
  input: { data: { id: ProductId } },
): Promise<Product | null> {
  return getJson<Product | null>(`/menu/products/${input.data.id}`)
}

// ─── سبد — قیمت‌گذاری سروری ───

export async function getCartDetails(
  input: { data: { items: CartItemInput[] } },
): Promise<CartDetails> {
  return postJson<CartDetails>('/menu/cart/details', {
    items: input.data.items,
  })
}

// ─── قیمت مؤثر — نمایشی کلاینت (سرور مرجع نهایی در checkout) ───

export function getEffectivePrice(
  product: Product,
  sizeId?: SizeId | null,
): number {
  if (product.sizesEnabled && product.sizes.length > 0) {
    const size = sizeId
      ? product.sizes.find((s) => s.id === sizeId)
      : product.sizes[0]
    return size?.price ?? product.finalPrice
  }
  return product.finalPrice
}

export function getSizeName(
  product: Product,
  sizeId?: SizeId | null,
): string | null {
  if (!product.sizesEnabled || !sizeId) return null
  return product.sizes.find((s) => s.id === sizeId)?.name ?? null
}

// ══════════════════════════════════════════════════════════════
// ⬅ phase-3: Admin — API واقعی به‌جای products-admin-mock
// امضاها همان موک‌اند؛ پرمیشن‌ها هم سمت سرور روی همین روت‌ها
// (productsRead/Write، mainCategoriesRead/Write) چک می‌شوند.
// ══════════════════════════════════════════════════════════════

export interface AdminMutationResult {
  success: boolean
  message?: string
}

// ── Main ها ──

export async function getAdminMainCategories(): Promise<MainCategory[]> {
  return authJson<MainCategory[]>('/admin/menu/mains', 'GET')
}

export async function createMainCategory(input: {
  data: { name: string; slug: string }
}): Promise<AdminMutationResult> {
  return authJson<AdminMutationResult>('/admin/menu/mains', 'POST', {
    name: input.data.name,
    slug: input.data.slug,
  })
}

export async function toggleMainCategory(input: {
  data: { id: string }
}): Promise<{ success: boolean }> {
  await authJson<unknown>(`/admin/menu/mains/${input.data.id}/toggle`, 'POST')
  return { success: true }
}

export async function setDefaultMainCategory(input: {
  data: { id: string }
}): Promise<AdminMutationResult> {
  return authJson<AdminMutationResult>(`/admin/menu/mains/${input.data.id}/default`, 'POST')
}

export async function reorderMainCategory(input: {
  data: { id: string; direction: 'up' | 'down' }
}): Promise<{ success: boolean }> {
  await authJson<unknown>(`/admin/menu/mains/${input.data.id}/reorder`, 'POST', {
    direction: input.data.direction,
  })
  return { success: true }
}

export async function deleteMainCategory(input: {
  data: { id: string }
}): Promise<AdminMutationResult> {
  return authJson<AdminMutationResult>(`/admin/menu/mains/${input.data.id}`, 'DELETE')
}

// ── دسته‌ها ──

export async function createCategory(input: {
  data: { name: string; mainCategoryId: string; hasSizes?: boolean; sizeNames?: string[] }
}): Promise<AdminMutationResult> {
  return authJson<AdminMutationResult>('/admin/menu/categories', 'POST', {
    name: input.data.name,
    mainCategoryId: input.data.mainCategoryId,
    hasSizes: input.data.hasSizes ?? false,
    sizeNames: input.data.sizeNames ?? [],
  })
}

export async function updateCategory(input: {
  data: { id: string; name: string; mainCategoryId: string; hasSizes?: boolean; sizeNames?: string[] }
}): Promise<AdminMutationResult> {
  await authJson<unknown>(`/admin/menu/categories/${input.data.id}`, 'PATCH', {
    name: input.data.name,
    mainCategoryId: input.data.mainCategoryId,
    hasSizes: input.data.hasSizes ?? false,
    sizeNames: input.data.sizeNames ?? [],
  })
  return { success: true }
}

export async function deleteCategory(input: {
  data: { id: string }
}): Promise<AdminMutationResult> {
  return authJson<AdminMutationResult>(`/admin/menu/categories/${input.data.id}`, 'DELETE')
}

// ── محصولات ──

export async function getAdminProducts(input: {
  data: { page: number; limit: number; search?: string; status?: string; categoryId?: string }
}): Promise<{ products: Product[]; total: number }> {
  const params = new URLSearchParams()
  params.set('page', String(input.data.page))
  params.set('limit', String(input.data.limit))
  if (input.data.search) params.set('search', input.data.search)
  if (input.data.status && input.data.status !== 'all') params.set('status', input.data.status)
  if (input.data.categoryId && input.data.categoryId !== 'all') params.set('categoryId', input.data.categoryId)
  return authJson<{ products: Product[]; total: number }>(`/admin/menu/products?${params}`, 'GET')
}

export async function toggleProductStatus(input: {
  data: { id: string }
}): Promise<{ success: boolean }> {
  await authJson<unknown>(`/admin/menu/products/${input.data.id}/toggle`, 'POST')
  return { success: true }
}

export async function getAdminProductDetails(input: {
  data: { id: string }
}): Promise<Product | null> {
  return authJson<Product | null>(`/admin/menu/products/${input.data.id}`, 'GET')
}

export async function createAdminProduct(input: {
  data: {
    name: string
    description: string
    originalPrice: number
    discountPercentage: number
    prepTime: number
    packagingCost?: number
    categoryId: string
    profileImage?: string
    galleryImages?: string[]
    sizesEnabled?: boolean
    sizes?: { name: string; price: number }[]
    ingredients?: string[]
  }
}): Promise<{ success: boolean; id?: string; message?: string }> {
  return authJson<{ success: boolean; id?: string; message?: string }>('/admin/menu/products', 'POST', {
    name: input.data.name,
    description: input.data.description,
    originalPrice: input.data.originalPrice,
    discountPercentage: input.data.discountPercentage,
    prepTime: input.data.prepTime,
    packagingCost: input.data.packagingCost ?? 0,
    categoryId: input.data.categoryId,
    profileImage: input.data.profileImage || null, // '' → null
    galleryImages: input.data.galleryImages ?? [],
    sizesEnabled: input.data.sizesEnabled ?? false,
    sizes: input.data.sizes ?? [],
    ingredients: input.data.ingredients ?? [],
  })
}

export async function updateAdminProduct(input: {
  data: {
    id: string
    name: string
    description: string
    originalPrice: number
    discountPercentage: number
    prepTime: number
    packagingCost?: number
    profileImage?: string
    galleryImages?: string[]
    sizesEnabled?: boolean
    sizes?: { name: string; price: number }[]
    ingredients?: string[]
  }
}): Promise<{ success: boolean }> {
  await authJson<unknown>(`/admin/menu/products/${input.data.id}`, 'PATCH', {
    name: input.data.name,
    description: input.data.description,
    originalPrice: input.data.originalPrice,
    discountPercentage: input.data.discountPercentage,
    prepTime: input.data.prepTime,
    packagingCost: input.data.packagingCost ?? 0,
    profileImage: input.data.profileImage || null,
    galleryImages: input.data.galleryImages ?? [],
    sizesEnabled: input.data.sizesEnabled ?? false,
    sizes: input.data.sizes ?? [],
    ingredients: input.data.ingredients ?? [],
  })
  return { success: true }
}