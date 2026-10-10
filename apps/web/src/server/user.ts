// ═══════════════════════════════════════════════════════════════
// stage-56 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/server/user.ts
// تغییر: getMyOrders — «سفارشات من» با صفحه‌بندی سروری (page/limit/
//        sort + پاکتِ { orders, total, totalSpent })
// ═══════════════════════════════════════════════════════════════

// src/server/user.ts — پروفایل + سفارشات + نظرات + آدرس — تماماً API
// بدون هیچ موک

import type {
	AddressDto,
	AdminReviewDto,
	ProductId,
	ProductReviewDto,
	UserOrder,
	UserOrdersData,
	UserProfileDto,
} from '@sinshin/shared'
import { authJson } from '#/lib/api-fetch'

// ─── re-export با اسم‌های قدیمی فرانت (هیچ فایل دیگری عوض نمی‌شود) ───

export type {
	UserProfileDto,
	UserOrder,
	AddressDto,
	ProductReviewDto,
	ProductId,
}
export type { OrderBreakdown, UserOrderItem as OrderItem } from '@sinshin/shared'
// رارد ۴۷ — نام‌های مستعارِ بدون مصرف‌کننده (UserAddress/UserDevice/WalletTransaction/
// UserReferral) حذف شدند؛ هر مصرف‌کننده‌ی آینده مستقیم از @sinshin/shared می‌خواند.

// ─── پروفایل ───

export async function getUserProfile(
	opts: { light?: boolean } = {},
): Promise<UserProfileDto> {
	// کار-۶: light — حالت سبک برای لایه‌های همیشگی (هدر/لایوت/چک‌اوت)
	const qs = opts.light ? '?light=true' : ''
	return authJson<UserProfileDto>(`/orders/profile${qs}`, 'GET')
}

// ── stage-56 — «سفارشات من» با صفحه‌بندی سروری ──
// صفحه/حد/مرتب‌سازی به GET /orders می‌روند؛ پاسخ { orders, total, totalSpent }.
// sort همان مقادیر صفحه‌ی داشبورد است (newest/oldest/expensive/cheap).
export async function getMyOrders(
	opts: { page?: number; limit?: number; sort?: string } = {},
): Promise<UserOrdersData> {
	const params = new URLSearchParams()
	if (opts.page) params.set('page', String(opts.page))
	if (opts.limit) params.set('limit', String(opts.limit))
	if (opts.sort) params.set('sort', opts.sort)
	const q = params.toString()
	return authJson<UserOrdersData>(`/orders${q ? `?${q}` : ''}`, 'GET')
}

// round-12 — bind معرف پس از ثبت‌نام (اسکن QR / ورود دستی کد در داشبورد کاربر)
export async function applyReferralCode(
	code: string,
): Promise<{ referrerCode: string }> {
	return authJson<{ referrerCode: string }>(
		'/orders/profile/apply-referral',
		'POST',
		{ code },
	)
}

export async function updateUserProfile(input: {
	firstName?: string
	lastName?: string
	email?: string
}): Promise<{ success: boolean }> {
	// phase-3 — واقعی: فرانت first/last دارد، مدل سرور name تک‌فیلدی؛ الحاق همین‌جا
	const name =
		[input.firstName?.trim(), input.lastName?.trim()]
			.filter(Boolean)
			.join(' ') || null
	await authJson<unknown>('/orders/profile', 'PATCH', {
		name,
		email: input.email?.trim() || null,
	})
	return { success: true }
}

// ─── آدرس‌ها ───

export async function addUserAddress(input: {
	title: string
	address: string
	lat: number
	lng: number
}): Promise<AddressDto> {
	return authJson<AddressDto>('/addresses', 'POST', input)
}

export async function updateUserAddress(input: {
	id: string
	title: string
	address: string
	lat: number
	lng: number
}): Promise<AddressDto> {
	return authJson<AddressDto>(`/addresses/${input.id}`, 'PATCH', {
		title: input.title,
		address: input.address,
		lat: input.lat,
		lng: input.lng,
	})
}

export async function deleteUserAddress(id: string): Promise<{ ok: boolean }> {
	return authJson<{ ok: boolean }>(`/addresses/${id}`, 'DELETE')
}

// ─── سفارشات ───

export async function getOrderDetails(input: {
	data: { id: string }
}): Promise<UserOrder | null> {
	return authJson<UserOrder | null>(`/orders/${input.data.id}`, 'GET')
}

export async function confirmOrderDelivery(input: {
	data: { orderId: string }
}): Promise<void> {
	await authJson<unknown>(`/orders/${input.data.orderId}/deliver`, 'POST')
}

// ─── ردیابی زنده ───

export async function getLiveTracking(input: {
	data: { orderId: string }
}): Promise<{ isEnabled: boolean }> {
	return authJson<{ isEnabled: boolean }>(
		`/orders/${input.data.orderId}/tracking`,
		'GET',
	)
}

// ─── نظرات ───

export async function getOrderReviewedProducts(input: {
	data: { orderId: string }
}): Promise<{ productIds: string[] }> {
	return authJson<{ productIds: string[] }>(
		`/reviews/order/${input.data.orderId}`,
		'GET',
	)
}

export async function submitOrderFeedback(input: {
	data: { orderId: string; productId: string; feedback: string }
}): Promise<{ success: boolean; message?: string }> {
	return authJson<{ success: boolean; message?: string }>('/reviews', 'POST', {
		orderId: input.data.orderId,
		productId: input.data.productId,
		feedback: input.data.feedback,
	})
}

export async function getApprovedProductReviews(input: {
	data: { productId: string }
}): Promise<ProductReviewDto[]> {
	return authJson<ProductReviewDto[]>(
		`/products/${input.data.productId}/reviews`,
		'GET',
	)
}

// ─── مودریشن ادمین (پیام ۵ با API) ───

// رارد ۴۷ — ردیف مودریشن ادمین = قرارداد مشترک (کپی محلی حذف شد)؛
// orderId این‌جا displayId است (برخلاف اندپوینت عمومی که UUID خام می‌فرستد)
// و productName همیشه پر است — تفاوت‌های عمدیِ دو اندپوینت، حالا در قرارداد مستند.
export type AdminReview = AdminReviewDto

export async function getAdminReviews(): Promise<AdminReview[]> {
	return authJson<AdminReview[]>('/admin/reviews', 'GET')
}

export async function moderateReview(data: {
	reviewId: string
	action: 'approve' | 'reject'
}): Promise<{ success: boolean }> {
	return authJson<{ success: boolean }>(
		`/admin/reviews/${data.reviewId}/moderate`,
		'POST',
		{ action: data.action },
	)
}