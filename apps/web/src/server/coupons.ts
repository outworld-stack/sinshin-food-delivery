// src/server/coupons.ts — تماماً API
// phase-9: شکل داده هم‌الگوی قرارداد واقعی سرور (CouponWithConditionsDto) —
// قبلاً تایپ تختِ ساختگی (expiryDate/status/recipientsCount تخت) باعث
// «Invalid Date»، «undefined نفر» و وضعیت همیشگی «منقضی» می‌شد.
// stage-65 — سوییچ «کوپن بی‌صدا» + فچ مصرف‌کنندگان (صفحه‌بندی سروری).

import type {
	CouponConsumersPageDto,
	CouponRule,
	CouponWithConditionsDto,
} from '@sinshin/shared'
import { authJson } from '#/lib/api-fetch'

export async function getAdminCoupons(): Promise<CouponWithConditionsDto[]> {
	return authJson<CouponWithConditionsDto[]>('/admin/coupons', 'GET')
}

/** phase-9: جزئیات یک کوپن — صفحه‌ی اختصاصی */
export async function getAdminCoupon(
	id: string,
): Promise<CouponWithConditionsDto> {
	return authJson<CouponWithConditionsDto>(`/admin/coupons/${id}`, 'GET')
}

export async function createCoupon(input: {
	code: string
	title?: string | null
	discountPercentage: number
	maxUses: number
	/** stage-66 — سقف مصرف به‌ازای کاربر (کوپن عمومی)؛ ۰ = نامحدود (پیش‌فرض) */
	maxPerUser?: number
	isPublic: boolean
	expiryDate: string | null
	rules: CouponRule[]
	/** stage-48 — عضویت در فرآیند کرون‌جاب کوپن‌ها (پیش‌فرض خاموش) */
	cronEnabled?: boolean
	/** stage-65 — ممنوعیت اعلان انتشار ساخت (پیش‌فرض خاموش = اعلان می‌رود) */
	announceSuppressed?: boolean
}): Promise<{ success: boolean; id?: string }> {
	return authJson<{ success: boolean; id?: string }>('/admin/coupons', 'POST', {
		code: input.code,
		title: input.title ?? null,
		discountPercentage: input.discountPercentage,
		maxUses: input.maxUses,
		// stage-66 — سقف per-user (۰ = نامحدود)
		maxPerUser: input.maxPerUser ?? 0,
		isPublic: input.isPublic,
		expiryDate: input.expiryDate,
		cronEnabled: input.cronEnabled ?? false,
		announceSuppressed: input.announceSuppressed ?? false,
		rules: input.rules.map((r) => ({
			type: r.type,
			value: String(r.value),
			quantity: r.quantity,
		})),
	})
}

export async function updateCoupon(input: {
	id: string
	code: string
	title?: string | null
	discountPercentage: number
	maxUses: number
	/** stage-66 — سقف per-user (undefined = دست‌نخورده در ویرایش) */
	maxPerUser?: number
	isPublic: boolean
	expiryDate: string | null
	rules: CouponRule[]
	/** stage-48 — عضویت در فرآیند کرون‌جاب کوپن‌ها (undefined = دست‌نخورده) */
	cronEnabled?: boolean
	/** stage-65 — ممنوعیت اعلان انتشار (undefined = دست‌نخورده) */
	announceSuppressed?: boolean
}): Promise<{ success: boolean }> {
	return authJson<{ success: boolean }>(`/admin/coupons/${input.id}`, 'PATCH', {
		code: input.code,
		title: input.title ?? null,
		discountPercentage: input.discountPercentage,
		maxUses: input.maxUses,
		// stage-66 — سقف per-user (نیامد = دست‌نخورده)
		maxPerUser: input.maxPerUser,
		isPublic: input.isPublic,
		expiryDate: input.expiryDate,
		cronEnabled: input.cronEnabled,
		announceSuppressed: input.announceSuppressed,
		rules: input.rules.map((r) => ({
			type: r.type,
			value: String(r.value),
			quantity: r.quantity,
		})),
	})
}

/** stage-65: حذف واقعی — ردیف + تاریخچهی مصرف (cascade)؛ غیرقابل برگشت */
export async function deleteCoupon(id: string): Promise<{
	success: boolean
	message: string
}> {
	return authJson<{ success: boolean; message: string }>(`/admin/coupons/${id}`, 'DELETE')
}

/** stage-65 — مصرف‌کنندگان واقعی کوپن (تاریخچهی redemption) — صفحه‌بندی سروری */
export async function getCouponConsumers(
	id: string,
	page: number,
	limit = 20,
): Promise<CouponConsumersPageDto> {
	return authJson<CouponConsumersPageDto>(
		`/admin/coupons/${id}/consumers?page=${page}&limit=${limit}`,
		'GET',
	)
}

/** stage-10: فعال/غیرفعال — برگشت‌پذیر (stage-65: حذف سخت از DELETE جداست) */
export async function setCouponActive(
	id: string,
	active: boolean,
): Promise<{ success: boolean; message: string }> {
	return authJson<{ success: boolean; message: string }>(
		`/admin/coupons/${id}/status`,
		'PATCH',
		{
			active,
		},
	)
}

export type { CouponRule }