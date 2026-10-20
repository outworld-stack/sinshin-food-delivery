// ═══════════════════════════════════════════════════════════════
// round-48 — sinshin-food-delivery — فایل 84 از 97
// مسیر مقصد: apps/web/src/server/admin.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage forty-three
// ═══════════════════════════════════════════════════════════════

// src/server/admin.ts — داشبورد + کاربران + سفارشات + پیک‌ها + ادمین۲ + پنل زنده + تنظیمات — تماماً API
// تمام تایپ‌ها از @sinshin/shared — بدون تعریف local

import type {
	Admin2SessionDto,
	Admin2StatsDto,
	AdminOrdersData,
	AdminStatsDto,
	AdminUserDetailsDto,
	AdminUsersData,
	CourierDetailDto,
	CourierListRowDto,
	CourierOptionDto,
	GeoStatusDto,
	InvoicePrinterAssignmentDto,
	LiveOrderDetailDto,
	LiveOrdersDataDto,
	OutsideScope,
	PrinterDiscoveryDto,
	PrinterDto,
	PrinterNetworkReportDto,
	RegistrationPermitDto,
	RestaurantStatusDto,
	StaffInvoice,
	StaffInvoiceItem,
	SubAdminPermissionsPatch,
	SubAdminRecordDto,
} from '@sinshin/shared'
import { authJson } from '#/lib/api-fetch'
import { jalaliFromISO, jalaliToGregorian } from '#/utils/persianDate'

// رارد ۴۷ — نام‌های مستعارِ قدیمی فرانت حذف شدند (تکمیل خوشه‌ی رارد ۴۶): هر
// مصرف‌کننده حالا مستقیم از @sinshin/shared می‌خواند؛ CourierRecord که
// createdAt را جا انداخته بود هم با قرارداد CourierListRowDto جایگزین شد.

// round-12 — دیتای فاکتور چاپی (اشپزخانه + فروش) — قرارداد GET /live/orders/:id/invoice
// رارد ۴۶ — StaffInvoice( Item)? به قرارداد مشترک منتقل شد و خروجی
// invoiceForStaff بک‌اند هم با همان تایپ annotate شد؛ re-export برای
// پایداری مسیر درون‌ریزیِ invoicePrint است (شکل بدون تغییر).
export type { StaffInvoice, StaffInvoiceItem }

// ═════════════ داشبورد ═════════════

export async function getAdminStats(): Promise<AdminStatsDto> {
	return authJson<AdminStatsDto>('/admin/stats', 'GET')
}

// ═════════════ کاربران ═════════════

export async function getAdminUsers(filters: {
	page: number
	limit: number
	search?: string
	/** stage-70 — فیلتر واقعی نوع دستگاه: mobile | tablet | desktop */
	deviceType?: string
	/** stage-70 — برند قاعده‌مند: apple | samsung | xiaomi | huawei | google | other */
	deviceBrand?: string
	status?: string
	sorts?: Array<{ field: string; dir: 'asc' | 'desc' }>
}): Promise<AdminUsersData> {
	const params = new URLSearchParams()
	params.set('page', String(filters.page))
	params.set('limit', String(filters.limit))
	if (filters.search) params.set('search', filters.search)
	if (filters.deviceType && filters.deviceType !== 'all')
		params.set('deviceType', filters.deviceType)
	if (filters.deviceBrand && filters.deviceBrand !== 'all')
		params.set('deviceBrand', filters.deviceBrand)
	if (filters.status && filters.status !== 'all')
		params.set('status', filters.status)
	if (filters.sorts && filters.sorts.length > 0) {
		params.set('sorts', JSON.stringify(filters.sorts))
	}
	return authJson<AdminUsersData>(`/admin/users?${params}`, 'GET')
}

export async function getAdminUserDetails(input: {
	data: { id: string }
}): Promise<AdminUserDetailsDto> {
	return authJson<AdminUserDetailsDto>(`/admin/users/${input.data.id}`, 'GET')
}

export async function toggleUserStatus(input: {
	data: { userId: string }
}): Promise<void> {
	await authJson<unknown>(`/admin/users/${input.data.userId}/toggle`, 'POST')
}

export async function updateAdminUser(input: {
	id: string
	firstName?: string
	lastName?: string
	email?: string
	phone?: string
	referralCode?: string
}): Promise<void> {
	await authJson<unknown>(`/admin/users/${input.id}`, 'PATCH', input)
}

export async function terminateDevice(input: {
	data: { userId: string; deviceId: string }
}): Promise<{ ok: boolean }> {
	await authJson<unknown>(
		`/admin/users/${input.data.userId}/devices/${input.data.deviceId}`,
		'DELETE',
	)
	return { ok: true }
}

export async function deleteUserAddress(input: {
	data: { userId: string; addressId: string }
}): Promise<{ ok: boolean }> {
	await authJson<unknown>(
		`/admin/users/${input.data.userId}/addresses/${input.data.addressId}`,
		'DELETE',
	)
	return { ok: true }
}

// ═════════════ سفارشات ادمین ═════════════

export async function getAdminOrders(filters: {
	page: number
	limit: number
	search?: string
	status?: string
	sortDate?: string
	sortAmount?: string
	confirmedBy?: string
	courierId?: string
	/** stage-84 — بازه‌ی تاریخ (امروز): ISO شروع/پایانِ روزِ تهران از کلاینت */
	dateFrom?: string
	dateTo?: string
}): Promise<AdminOrdersData> {
	const params = new URLSearchParams()
	params.set('page', String(filters.page))
	params.set('limit', String(filters.limit))
	if (filters.search) params.set('search', filters.search)
	if (filters.status && filters.status !== 'all')
		params.set('status', filters.status)
	if (filters.sortDate && filters.sortDate !== 'none')
		params.set('sortDate', filters.sortDate)
	if (filters.sortAmount && filters.sortAmount !== 'none')
		params.set('sortAmount', filters.sortAmount)
	if (filters.confirmedBy && filters.confirmedBy !== 'all')
		params.set('confirmedBy', filters.confirmedBy)
	if (filters.courierId && filters.courierId !== 'all')
		params.set('courierId', filters.courierId)
	// stage-84 — بازه‌ی تاریخ (امروز)
	if (filters.dateFrom) params.set('dateFrom', filters.dateFrom)
	if (filters.dateTo) params.set('dateTo', filters.dateTo)
	return authJson<AdminOrdersData>(`/admin/orders?${params}`, 'GET')
}

// رارد ۴۷ — پارامتر adminId حذف شد: هرگز به کوئری اضافه نمی‌شد (امضای
// دروغین) — محدودسازی به سفارشات خودِ ادمین۲ سمت سرور با توکن انجام می‌شود.
export async function getSubAdminOrders(filters: {
	page: number
	limit: number
	search?: string
	status?: string
	sortDate?: string
	sortAmount?: string
	/** stage-84 — بازه‌ی تاریخ (امروز): ISO شروع/پایانِ روزِ تهران از کلاینت */
	dateFrom?: string
	dateTo?: string
}): Promise<AdminOrdersData> {
	const params = new URLSearchParams()
	params.set('page', String(filters.page))
	params.set('limit', String(filters.limit))
	if (filters.search) params.set('search', filters.search)
	if (filters.status && filters.status !== 'all')
		params.set('status', filters.status)
	if (filters.sortDate && filters.sortDate !== 'none')
		params.set('sortDate', filters.sortDate)
	if (filters.sortAmount && filters.sortAmount !== 'none')
		params.set('sortAmount', filters.sortAmount)
	// stage-84 — بازه‌ی تاریخ (امروز)
	if (filters.dateFrom) params.set('dateFrom', filters.dateFrom)
	if (filters.dateTo) params.set('dateTo', filters.dateTo)
	return authJson<AdminOrdersData>(`/admin/orders?${params}`, 'GET')
}

export async function getAdmin2Options(): Promise<
	Array<{ id: string; name: string }>
> {
	// phase-3: قبلاً به /live/couriers می‌زد — فیلتر «ادمین۲» پیک‌ها را نشان می‌داد!
	const admins = await authJson<SubAdminRecordDto[]>('/admin/admins', 'GET')
	return admins.map((a) => ({
		id: a.userId,
		name: `${a.firstName ?? ''} ${a.lastName ?? ''}`.trim() || a.phone,
	}))
}

export async function getCourierOptions(): Promise<
	Array<{ id: string; name: string }>
> {
	const r = await authJson<CourierOptionDto[]>('/live/couriers', 'GET')
	return r.map((c) => ({ id: c.id, name: c.name }))
}

export async function getOrderDetailsByRole(input: {
	data: { orderId: string }
}): Promise<LiveOrderDetailDto | null> {
	return authJson<LiveOrderDetailDto | null>(
		`/live/orders/${input.data.orderId}`,
		'GET',
	)
}

/** round-12 — دیتای فاکتور چاپی برای پنل (ادمین اصلی + سطح ۲) */
export async function getStaffOrderInvoice(
	orderId: string,
): Promise<StaffInvoice> {
	return authJson<StaffInvoice>(`/live/orders/${orderId}/invoice`, 'GET')
}

// ═════════════ پیک‌ها ═════════════

/** شمسی ISO (۱۴۰۳-۰۵-۱۲) → میلادی ISO — از/تا روز (هم‌الگوی مرکز گزارشات) */
function jalaliBoundary(
	iso: string | undefined,
	endOfDay: boolean,
): string | undefined {
	if (!iso) return undefined
	const j = jalaliFromISO(iso)
	if (!j) return undefined
	const d = jalaliToGregorian(j)
	if (endOfDay) d.setHours(23, 59, 59, 999)
	else d.setHours(0, 0, 0, 0) // round-11 (H-2): شروع روز — نیمهٔ اول روز اول حذف نشود
	return d.toISOString()
}

export async function getAdminCouriers(filters: {
	page: number
	limit: number
	search?: string
	dateFrom?: string
	dateTo?: string
}): Promise<{ couriers: CourierListRowDto[]; total: number }> {
	const params = new URLSearchParams()
	params.set('page', String(filters.page))
	params.set('limit', String(filters.limit))
	if (filters.search) params.set('search', filters.search)
	// round-11 (H-3): تاریخ‌ها از URL شمسی می‌آیند — تبدیل به مرز میلادی
	const from = jalaliBoundary(filters.dateFrom, false)
	const to = jalaliBoundary(filters.dateTo, true)
	if (from) params.set('dateFrom', from)
	if (to) params.set('dateTo', to)
	return authJson<{ couriers: CourierListRowDto[]; total: number }>(
		`/admin/couriers?${params}`,
		'GET',
	)
}

export async function addCourier(input: {
	name: string
	phone: string
}): Promise<{ success: boolean; message?: string }> {
	return authJson<{ success: boolean; message?: string }>(
		'/admin/couriers',
		'POST',
		input,
	)
}

export async function getAdminCourierDetailsForRole(input: {
	data: { id: string; adminId?: string }
}): Promise<CourierDetailDto> {
	return authJson<CourierDetailDto>(`/admin/couriers/${input.data.id}`, 'GET')
}

export async function getCouriersForAssignment(): Promise<CourierOptionDto[]> {
	return authJson<CourierOptionDto[]>('/live/couriers', 'GET')
}

// ═════════════ ادمین۲ ═════════════

export async function getSubAdminSession(): Promise<Admin2SessionDto> {
	return authJson<Admin2SessionDto>('/live/session', 'GET')
}

export async function getSubAdmins(): Promise<SubAdminRecordDto[]> {
	return authJson<SubAdminRecordDto[]>('/admin/admins', 'GET')
}

export async function getSubAdminDetails(input: {
	data: { id: string }
}): Promise<SubAdminRecordDto> {
	return authJson<SubAdminRecordDto>(`/admin/admins/${input.data.id}`, 'GET')
}

export async function addSubAdmin(input: {
	phone: string
	firstName: string
	lastName: string
	/** round-29 — حوزه‌ی انتخابی در فرم؛ قبلاً همیشه 'takeaway' هاردکد بود و ادمین۲ جدید
	 * هرگز سفارشات سالن (DINE_IN) را نمی‌دید */
	scope: 'hall' | 'takeaway' | 'both'
}): Promise<{ success: boolean; message?: string }> {
	return authJson<{ success: boolean; message?: string }>(
		'/admin/admins',
		'POST',
		{
			phone: input.phone,
			firstName: input.firstName,
			lastName: input.lastName,
			scope: input.scope,
		},
	)
}

export async function toggleSubAdmin(id: string): Promise<void> {
	await authJson<unknown>(`/admin/admins/${id}/toggle`, 'POST')
}

export async function updateSubAdminPermissions(input: {
	id: string
	permissions: SubAdminPermissionsPatch
}): Promise<void> {
	await authJson<unknown>(
		`/admin/admins/${input.id}/permissions`,
		'PATCH',
		input.permissions,
	)
}

export async function subAdminLogout(input: {
	data: { adminId: string }
}): Promise<void> {
	void input
	await authJson<unknown>('/auth/logout', 'POST')
}

// ═════════════ پنل زنده ═════════════

export async function getLiveOrders(input: {
	data: { adminId: string }
}): Promise<LiveOrdersDataDto> {
	void input
	return authJson<LiveOrdersDataDto>('/live/orders', 'GET')
}

export async function getAdmin2Stats(input: {
	data: { adminId: string }
}): Promise<Admin2StatsDto> {
	void input
	return authJson<Admin2StatsDto>('/live/stats', 'GET')
}

export async function viewOrderNote(input: {
	data: { orderId: string }
}): Promise<{ note: string | null }> {
	return authJson<{ note: string | null }>(
		`/live/orders/${input.data.orderId}/note`,
		'POST',
	)
}

export async function confirmLiveOrder(input: {
	orderId: string
	courierId?: string | null
	courierNote?: string | null
	/** round-14 — یادداشت روی فاکتور بیرون‌بر چاپ شود؟ */
	notePrintOnInvoice?: boolean
	securityEnabled?: boolean
}): Promise<{ success: boolean; message?: string }> {
	return authJson<{ success: boolean; message?: string }>(
		`/live/orders/${input.orderId}/confirm`,
		'POST',
		{
			courierId: input.courierId ?? null,
			courierNote: input.courierNote ?? null,
			notePrintOnInvoice: input.notePrintOnInvoice ?? false,
			securityEnabled: input.securityEnabled ?? false,
		},
	)
}

export async function reassignCourier(input: {
	orderId: string
	newCourierId: string | null
}): Promise<{ success: boolean; message?: string }> {
	return authJson<{ success: boolean; message?: string }>(
		`/live/orders/${input.orderId}/reassign`,
		'POST',
		{ courierId: input.newCourierId },
	)
}

// ═════════════ تنظیمات ═════════════

export async function getLiveTrackingEnabled(): Promise<boolean> {
	// پاسخ API شیء { enabled } است؛ مرز serde همین‌جاست — بقیه‌ی اپ boolean می‌بیند
	const d = await authJson<{ enabled: boolean }>(
		'/admin/settings/live-tracking',
		'GET',
	)
	return d.enabled
}

export async function setLiveTrackingEnabled(input: {
	data: { enabled: boolean }
}): Promise<void> {
	await authJson<unknown>('/admin/settings/live-tracking', 'POST', input.data)
}

// ═══ stage-84 — درگاه‌های پرداخت (سوئیچ ادمین اصلی) ═══

export type PaymentGateways = {
	mellat: boolean
	zarinpal: boolean
	sep: boolean
}

export async function getPaymentGateways(): Promise<PaymentGateways> {
	// مرز serde: API { gateways: {...} } می‌فرستد — کلیدهای غایب = فعال
	const d = await authJson<{ gateways?: Partial<PaymentGateways> }>(
		'/admin/settings/gateways',
		'GET',
	)
	const g = d.gateways ?? {}
	return {
		mellat: g.mellat !== false,
		zarinpal: g.zarinpal !== false,
		sep: g.sep !== false,
	}
}

export async function setPaymentGateways(input: {
	data: PaymentGateways
}): Promise<void> {
	await authJson<unknown>('/admin/settings/gateways', 'POST', input.data)
}

// ═══ stage-84 — وضعیت «شلوغی» رستوران ═══

export async function getRestaurantBusy(): Promise<boolean> {
	// پاسخ کامل status — isBusy فیلد تازه است؛ کلاینت قدیمی false می‌بیند
	const d = await authJson<{ isBusy?: boolean }>(
		'/admin/settings/restaurant/status',
		'GET',
	)
	return d.isBusy === true
}

export async function setRestaurantBusy(input: {
	data: { busy: boolean }
}): Promise<void> {
	await authJson<unknown>('/admin/settings/busy', 'POST', input.data)
}

// phase-fix — محدودیت دسترسی «فقط ایران» (پیش‌فرض روشن)
export async function getIranOnlyAccess(): Promise<boolean> {
	// پاسخ API شیء { enabled } است؛ قبلاً مستقیم تبدیل نوع می‌شد → سوییچ همیشه روشن دیده می‌شد
	const d = await authJson<{ enabled: boolean }>(
		'/admin/settings/iran-only',
		'GET',
	)
	return d.enabled
}

export async function setIranOnlyAccess(input: {
	data: { enabled: boolean }
}): Promise<void> {
	await authJson<unknown>('/admin/settings/iran-only', 'POST', input.data)
}

// ═════════════ رارد ۳۷ — قفل جغرافیایی عراق ═════════════

/** رارد ۳۷ — دامنه‌ی ورود کاربران خارج از ایران — رارد ۴۶: از قرارداد
 *  مشترک می‌آید (کپی geo.service بک‌اند هم با همان منبع بسته شد) */
export type { OutsideScope }

export async function getOutsideScope(): Promise<OutsideScope> {
	// مثل getIranOnlyAccess — مرز serde همین‌جاست؛ هر چیز غیر از 'world' = 'iraq'
	const d = await authJson<{ scope: unknown }>(
		'/admin/settings/outside-scope',
		'GET',
	)
	return d.scope === 'world' ? 'world' : 'iraq'
}

export async function setOutsideScope(input: {
	data: { scope: OutsideScope }
}): Promise<void> {
	await authJson<unknown>('/admin/settings/outside-scope', 'POST', input.data)
}

/** رارد ۳۷ — وضعیت زنده‌ی دروازه برای کارت تنظیمات (رنج‌ها/منبع/به‌روزرسانی) —
 *  رارد ۴۷: نام مستعار قدیمی GeoStatusResponse حذف شد — صفر مصرف‌کننده داشت. */

export async function getGeoStatus(): Promise<GeoStatusDto> {
	return authJson<GeoStatusDto>('/geo/status', 'GET')
}

export async function getRestaurantOpen(): Promise<{
	isOpen: boolean
	nextOpenTime: string
}> {
	return authJson<{ isOpen: boolean; nextOpenTime: string }>(
		'/admin/settings/restaurant',
		'GET',
	)
}

export async function setRestaurantOpen(input: {
	data: { isOpen: boolean; nextOpenTime?: string }
}): Promise<{ success: boolean }> {
	await authJson<unknown>('/admin/settings/restaurant', 'POST', input.data)
	return { success: true }
}

// ============= round-13 — بسته/باز موقت با علت (هر دو نقش) =============

// رارد ۴۷ — نام مستعار قدیمی RestaurantFullStatus حذف شد — صفر مصرف‌کننده داشت.
// (تولیدکننده‌ی بک‌اند هم با همان تایپ annotate شد — شکل بدون تغییر)

export async function getRestaurantStatusFull(): Promise<RestaurantStatusDto> {
	return authJson<RestaurantStatusDto>(
		'/admin/settings/restaurant/status',
		'GET',
	)
}

export async function setTemporaryClose(input: {
	data: {
		closed: boolean
		reason: string
		reopenTime?: string
		reasonAr?: string | null
	}
}): Promise<{ success: boolean }> {
	await authJson<unknown>('/admin/settings/temporary-close', 'POST', {
		...input.data,
		// round-34 — علت عربی ('' → null = حذف ترجمه = بازگشت به فارسی)
		reasonAr: input.data.reasonAr?.trim() || null,
	})
	return { success: true }
}

// ═════════════ stage-79 — مجوز ثبت‌نام ویژه (فقط ادمین اصلی) ═════════════
// شماره‌ای که اینجا صادر شود می‌تواند یک‌بار (در پنجره‌ی اعتبار) ثبت‌نام کند —
// حتی از دستگاهِ سوخته/مسدود — و بعد از ثبت‌نامِ موفق همان دستگاه بلاک می‌شود.

export async function getRegistrationPermits(): Promise<
	RegistrationPermitDto[]
> {
	return authJson<RegistrationPermitDto[]>(
		'/admin/settings/registration-permits',
		'GET',
	)
}

export async function issueRegistrationPermit(input: {
	data: { phone: string; note?: string | null; ttlHours?: number }
}): Promise<RegistrationPermitDto> {
	const d = await authJson<{ permit: RegistrationPermitDto }>(
		'/admin/settings/registration-permits',
		'POST',
		input.data,
	)
	return d.permit
}

export async function revokeRegistrationPermit(input: {
	data: { id: string }
}): Promise<{ success: boolean }> {
	await authJson<unknown>(
		'/admin/settings/registration-permits/revoke',
		'POST',
		input.data,
	)
	return { success: true }
}

// ═════════════ stage-88 — پل چاپِ سرور (چاپگرهای شبکه، بدون ابزار ثالث) ═════════════
// تشخیص/پیکربندی/انتخاب/چاپ — همه از API؛ مرورگر فقط canvas فارسی می‌سازد.

export async function getAdminPrinters(): Promise<PrinterDto[]> {
	const res = await authJson<{ printers: PrinterDto[] }>(
		'/admin/print/printers',
		'GET',
	)
	return res.printers
}

export async function addAdminPrinter(input: {
	name: string
	host: string
	port?: number
	widthDots?: number
	autoCut?: boolean
}): Promise<PrinterDto> {
	const res = await authJson<{ printer: PrinterDto }>(
		'/admin/print/printers',
		'POST',
		input,
	)
	return res.printer
}

export async function updateAdminPrinter(
	id: string,
	patch: {
		name?: string
		host?: string
		port?: number
		widthDots?: number
		autoCut?: boolean
	},
): Promise<PrinterDto> {
	const res = await authJson<{ printer: PrinterDto }>(
		`/admin/print/printers/${id}`,
		'PATCH',
		patch,
	)
	return res.printer
}

export async function removeAdminPrinter(id: string): Promise<void> {
	await authJson<unknown>(`/admin/print/printers/${id}`, 'DELETE')
}

export async function testAdminPrinter(id: string): Promise<{ bytes: number }> {
	return authJson<{ success: boolean; bytes: number }>(
		`/admin/print/printers/${id}/test`,
		'POST',
		{},
	)
}

export async function discoverAdminPrinters(cidr?: string): Promise<{
	scanned: string[]
	found: PrinterDiscoveryDto[]
}> {
	return authJson<{ scanned: string[]; found: PrinterDiscoveryDto[] }>(
		'/admin/print/discover',
		'POST',
		cidr ? { cidr } : {},
		{ timeoutMs: 90_000 },
	)
}

export async function getAdminPrintAssignment(): Promise<InvoicePrinterAssignmentDto> {
	return authJson<InvoicePrinterAssignmentDto>('/admin/print/assignment', 'GET')
}

export async function setAdminPrintAssignment(
	assignment: InvoicePrinterAssignmentDto,
): Promise<void> {
	await authJson<unknown>('/admin/print/assignment', 'POST', assignment)
}

/** ارسالِ بیت‌مپِ 1bpp (canvasِ مرورگر) → GS v 0 روی سوکتِ چاپگر */
export async function printReceiptBitmap(input: {
	printerId: string
	widthPx: number
	heightPx: number
	rows: string
}): Promise<{ bytes: number }> {
	return authJson<{ success: boolean; bytes: number }>(
		'/admin/print/receipt',
		'POST',
		input,
	)
}

/**
 * stage-89 (P1) — گزارشِ «مسیرِ واقعیِ شبکهٔ چاپگر» — کارت‌های واقعیِ سرور،
 * جایِ IP هر چاپگر، حالتِ استقرار و راهنمای فارسی — فقط ادمین اصلی.
 */
export async function getAdminPrinterNetworkReport(): Promise<PrinterNetworkReportDto> {
	return authJson<PrinterNetworkReportDto>('/admin/print/network', 'GET')
}
