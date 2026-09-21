// src/server/reports.ts — stage-10: باکس گزارشات داشبورد ادمین اصلی
import { authJson } from '#/lib/api-fetch'

export type AdminReportType =
	| 'orders'
	| 'admin2'
	| 'couriers'
	| 'coupons'
	| 'users'
	| 'user'
	| 'audit'

/** قرارداد مشترک همه‌ی گزارش‌ها — رشته‌ای و آماده‌ی رندر/چاپ */
export interface AdminReportResult {
	title: string
	subtitle: string
	generatedAt: string
	stats: { label: string; value: string }[]
	tables: { title: string; head: string[]; rows: string[][] }[]
}

export interface AdminReportQuery {
	type: AdminReportType
	/** ISO میلادی (فرانت شمسی را تبدیل می‌کند) */
	from?: string | null
	to?: string | null
	status?: string | null
	deliveryType?: string | null
	adminUserId?: string | null
	courierId?: string | null
	phone?: string | null
}

export async function queryAdminReport(
	q: AdminReportQuery,
): Promise<AdminReportResult> {
	return authJson<AdminReportResult>('/admin/reports/query', 'POST', {
		type: q.type,
		from: q.from ?? null,
		to: q.to ?? null,
		status: q.status ?? null,
		deliveryType: q.deliveryType ?? null,
		adminUserId: q.adminUserId ?? null,
		courierId: q.courierId ?? null,
		phone: q.phone ?? null,
	})
}
