// src/server/reports.ts — stage-10: باکس گزارشات داشبورد ادمین اصلی
import type { AdminReportQuery, AdminReportResult, AdminReportType } from '@sinshin/shared'
import { authJson } from '#/lib/api-fetch'

// رارد ۴۶ — سه تایپ AdminReportType/AdminReportQuery/AdminReportResult به
// قرارداد مشترک (@sinshin/shared) منتقل شدند؛ report-query.service بک‌اند
// هم با همان منبع بسته شد (شکل‌ها بدون تغییر). re-export برای ReportsBox.
export type { AdminReportType }

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