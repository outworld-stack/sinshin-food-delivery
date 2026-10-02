// ═══════════════════════════════════════════════════════════════
// round-35 — sinshin-food-delivery — فایل 26 از 31
// مسیر مقصد: apps/web/src/hooks/admin/useTranslationQueue.ts
// وضعیت: فایل جدید (قبلاً وجود نداشت)
// کامیت پیشنهادی: stage thirty one
// ═══════════════════════════════════════════════════════════════

// src/hooks/admin/useTranslationQueue.ts
// round-35 — داده‌ی کارت «ترجمه‌ی خودکار محتوا» روی داشبورد ادمین:
// وضعیت صف + شمار نقص‌ها + کارهای اخیر + اکشن دسته‌ای.
// پول تطبیقی: صف فعال (pending/running > 0) → ۵ ثانیه؛ خالی → ۳۰ ثانیه.

import type { TranslationEntityType } from '@sinshin/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import {
	enqueueBulkTranslation,
	getTranslationJobs,
	getTranslationStatus,
	translatePreview,
} from '#/server/translation'
import { useToastStore } from '#/stores/toastStore'
import { faNum } from '#/utils/format'
import { qk } from '#/utils/queryKeys'

const POLL_ACTIVE_MS = 5_000 // صف در حال کار → پول تند
const POLL_IDLE_MS = 30_000 // صف ساکن → پول آرام

interface Options {
	/** برای ادمین غیراصلی کوئری‌ها اجرا نمی‌شوند (هوک همیشه صدا زده می‌شود) */
	enabled?: boolean
}

export function useTranslationQueue({ enabled = true }: Options = {}) {
	const queryClient = useQueryClient()
	const showToast = useToastStore((s) => s.showToast)

	// وضعیت صف + نقص‌ها + سلامت مترجم — پول تطبیقی از خودِ دیتا
	const statusQuery = useQuery({
		queryKey: qk.translationStatus,
		queryFn: getTranslationStatus,
		enabled,
		refetchInterval: (query) => {
			const q = query.state.data?.queue
			return q && (q.pending > 0 || q.running > 0)
				? POLL_ACTIVE_MS
				: POLL_IDLE_MS
		},
	})

	// آخرین کارهای صف — همان ریتم تطبیقی از وضعیت کارهای خودش
	const jobsQuery = useQuery({
		queryKey: qk.translationJobs,
		queryFn: () => getTranslationJobs(15),
		enabled,
		refetchInterval: (query) => {
			const jobs = query.state.data?.jobs ?? []
			return jobs.some((j) => j.status === 'pending' || j.status === 'running')
				? POLL_ACTIVE_MS
				: POLL_IDLE_MS
		},
	})

	const invalidateTranslation = useCallback(() => {
		void queryClient.invalidateQueries({ queryKey: qk.translationStatus })
		void queryClient.invalidateQueries({ queryKey: qk.translationJobs })
	}, [queryClient])

	// صف‌کردن ناقص‌ها — با entityType فقط همان نوع؛ بدون آن همه‌ی انواع
	const bulkMutation = useMutation({
		mutationFn: (entityType?: TranslationEntityType) =>
			enqueueBulkTranslation(entityType),
		onSuccess: (data) => {
			invalidateTranslation()
			showToast(
				data.queued > 0
					? `${faNum(data.queued)} مورد در صف ترجمه قرار گرفت`
					: 'مورد ناقص جدیدی پیدا نشد',
			)
		},
		onError: (err) => showToast(err.message, 'error'),
	})

	// ArField خودش لودینگ/توست را مدیریت می‌کند — پوشش نازک روی سرور
	const preview = useCallback((texts: string[]) => translatePreview(texts), [])

	const enqueueAll = useCallback(
		() => bulkMutation.mutate(undefined),
		[bulkMutation.mutate],
	)
	const enqueueType = useCallback(
		(entityType: TranslationEntityType) => bulkMutation.mutate(entityType),
		[bulkMutation.mutate],
	)

	return {
		status: statusQuery.data,
		isStatusLoading: enabled && statusQuery.isLoading,
		isStatusError: statusQuery.isError,
		refetchStatus: statusQuery.refetch,
		isStatusFetching: statusQuery.isFetching,
		jobs: jobsQuery.data?.jobs ?? [],
		isJobsLoading: enabled && jobsQuery.isLoading,
		isBulkPending: bulkMutation.isPending,
		enqueueAll,
		enqueueType,
		preview,
	}
}