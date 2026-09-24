// src/components/admin/SystemStatusBox.tsx
// round-18 — باکس مانیتورینگ سیستم روی داشبورد ادمین اصلی.
//
// طراحی:
//  • یک useQuery با فکتوری مرکزی systemMetricsOptions + refetchInterval ۳۰s
//    (سنجه‌های پنجره‌ای ۱m/۵m فقط با رفرش دوره‌ای معنا دارند).
//  • همه‌ی اعداد از API می‌آیند (formatDuration/formatRelative/faNum) —
//    هیچ منطقی این‌جا محاسبه نمی‌شود جز انتخاب رنگ/برچسب.
//  • خرابی خودِ کوئری = حالت خطای باکس (نه کرش صفحه) — داشبورد بدون این
//    باکس هم کار می‌کند.
import type { JobRunDto } from '@sinshin/shared'
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Activity, AlertTriangle, CheckCircle, Clock, Cpu, Radio, Repeat, Server } from 'reicon-react'
import { Skeleton } from '#/components/LoadingSkeletons'
import { faNum, formatDuration, formatRelative } from '#/utils/format'
import { systemMetricsOptions } from '#/utils/queryOptions'

/** نشان کوچک وضعیت بولی — سبز/قرمز، با متن جایگزین برای اسکرین‌ریدر */
function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      className={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${
        ok ? 'bg-green-500' : 'bg-red-500'
      }`}
    />
  )
}

/** یک خانه‌ی آمار — آیکون + برچسب + مقدار (چیدمان یکسان برای همه) */
function Metric({
  icon,
  label,
  value,
  hint,
}: {
  icon: ReactNode
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <div className="w-9 h-9 rounded-lg bg-gray-100 dark:bg-[#1a0a0e] text-gray-500 dark:text-gray-400 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-400 truncate">{label}</p>
        <p className="font-DanaDemiBold text-gray-800 dark:text-white text-sm truncate">
          {value}
          {hint ? <span className="text-xs text-gray-400 font-DanaMedium"> ({hint})</span> : null}
        </p>
      </div>
    </div>
  )
}

/** ردیف job — وضعیت آخرین اجرا + خطای کوتاه */
function JobRow({ job }: { job: JobRunDto }) {
  const state = job.runningNow ? (
    <span className="text-amber-500 font-DanaDemiBold text-xs">در حال اجرا…</span>
  ) : job.lastOk === null ? (
    <span className="text-gray-400 text-xs">هنوز اجرا نشده</span>
  ) : job.lastOk ? (
    <span className="text-green-600 dark:text-green-400 font-DanaDemiBold text-xs">
      ✓ موفق {job.lastDurationMs !== null ? `· ${formatDuration(job.lastDurationMs)}` : ''}
    </span>
  ) : (
    <span className="text-red-500 font-DanaDemiBold text-xs" title={job.lastError ?? undefined}>
      ✗ ناموفق {job.lastDurationMs !== null ? `· ${formatDuration(job.lastDurationMs)}` : ''}
    </span>
  )
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-gray-100 dark:border-white/5 last:border-0">
      <div className="min-w-0">
        <p className="font-DanaMedium text-gray-800 dark:text-white text-sm truncate" dir="ltr">
          {job.name}
        </p>
        <p className="text-xs text-gray-400" dir="ltr">
          {job.schedule}
        </p>
      </div>
      <div className="text-left shrink-0">
        {state}
        <p className="text-xs text-gray-400 mt-0.5">
          {job.lastStartedAt ? formatRelative(job.lastStartedAt) : '—'}
          {job.runCount > 0 ? ` · ${faNum(job.runCount)} اجرا` : ''}
        </p>
      </div>
    </div>
  )
}

export function SystemStatusBox() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    ...systemMetricsOptions,
    refetchInterval: 30_000,
  })

  if (isLoading) {
    return (
      <section className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
        <Skeleton className="h-6 w-40 mb-4" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'].map((k) => (
            <Skeleton key={k} className="h-10" />
          ))}
        </div>
      </section>
    )
  }

  // خطای کوئری — باکس جمع می‌شود ولی داشبورد زنده می‌ماند
  if (isError || !data) {
    return (
      <section className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-red-500">
            <AlertTriangle size={20} />
            <h2 className="font-DanaDemiBold text-lg">وضعیت سیستم در دسترس نیست</h2>
          </div>
          <button
            type="button"
            onClick={() => void refetch()}
            className="text-sm text-primary dark:text-dark-primary font-DanaDemiBold hover:underline cursor-pointer"
          >
            تلاش دوباره
          </button>
        </div>
      </section>
    )
  }

  const ok = data.status === 'ok'
  const lat = data.http.latencyMs

  return (
    <section className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
      <div className="flex items-center justify-between gap-4 mb-6 pb-4 border-b border-gray-100 dark:border-white/5">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
              ok
                ? 'bg-green-100 dark:bg-green-500/10 text-green-600 dark:text-green-400'
                : 'bg-red-100 dark:bg-red-500/10 text-red-500'
            }`}
          >
            {ok ? <CheckCircle size={22} /> : <AlertTriangle size={22} />}
          </div>
          <div className="min-w-0">
            <h2 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white">
              وضعیت سیستم
            </h2>
            <p className="text-xs text-gray-400">
              {ok ? 'همه‌ی سرویس‌ها سالم' : 'یک یا چند سرویس دچار اختلال است'} ·{' '}
              {formatDuration(data.uptimeSeconds * 1000)} از آخرین ری‌استارت
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 font-DanaDemiBold hover:text-primary dark:hover:text-dark-primary transition disabled:opacity-50 cursor-pointer shrink-0"
        >
          <Repeat size={14} className={isFetching ? 'animate-spin' : ''} />
          بروزرسانی
        </button>
      </div>

      {/* وابستگی‌ها — همان سه چک /health با تاخیر */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-6 text-sm font-DanaMedium">
        <span className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
          <StatusDot ok={data.deps.database.ok} label="پایگاه داده" />
          پایگاه داده
          <span className="text-xs text-gray-400">{faNum(data.deps.database.latencyMs)} م‌ث</span>
        </span>
        <span className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
          <StatusDot ok={data.deps.redis.ok} label="Redis" />
          Redis
          <span className="text-xs text-gray-400">{faNum(data.deps.redis.latencyMs)} م‌ث</span>
        </span>
        <span className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
          <StatusDot ok={data.deps.uploads.ok} label="ذخیره‌سازی" />
          ذخیره‌سازی
          {data.deps.uploads.totalMB !== null && (
            <span className="text-xs text-gray-400">
              {faNum(data.deps.uploads.totalMB)} مگابایت
              {data.deps.uploads.files !== null ? ` · ${faNum(data.deps.uploads.files)} فایل` : ''}
              {data.deps.uploads.capped ? '+' : ''}
            </span>
          )}
        </span>
        <span className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
          <Radio size={15} className="text-gray-400" />
          اتصال زنده: {faNum(data.sse.subscribers)} مشترک / {faNum(data.sse.channels)} کانال
        </span>
      </div>

      {/* سنجه‌های فرآیند و HTTP */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        <Metric
          icon={<Server size={18} />}
          label="درخواست (۱ دقیقه)"
          value={faNum(data.http.requestsLast1m)}
          hint={`۵ دقیقه: ${faNum(data.http.requestsLast5m)}`}
        />
        <Metric
          icon={<AlertTriangle size={18} />}
          label="خطای 5xx (۱ دقیقه)"
          value={faNum(data.http.errorsLast1m)}
          hint={`۵ دقیقه: ${faNum(data.http.errorsLast5m)}`}
        />
        <Metric
          icon={<Activity size={18} />}
          label="تاخیر پاسخ (میانه / p95)"
          value={lat ? `${faNum(Math.round(lat.p50))} / ${faNum(Math.round(lat.p95))} م‌ث` : '—'}
        />
        <Metric
          icon={<Cpu size={18} />}
          label="حافظه (RSS / هیپ)"
          value={`${faNum(data.process.rssMB)} / ${faNum(data.process.heapUsedMB)} مگابایت`}
        />
        <Metric
          icon={<Clock size={18} />}
          label="تاخیر حلقهٔ رویداد"
          value={`${faNum(data.process.eventLoopLagMs)} م‌ث`}
        />
        <Metric
          icon={<CheckCircle size={18} />}
          label="کل درخواست‌ها از بوت"
          value={faNum(data.http.totalRequests)}
          hint={`${faNum(data.http.totalErrors)} خطا`}
        />
      </div>

      {/* jobهای زمان‌بندی‌شده */}
      {data.jobs.length > 0 && (
        <details className="group">
          <summary className="flex items-center justify-between cursor-pointer list-none text-sm font-DanaDemiBold text-gray-600 dark:text-gray-300 hover:text-primary dark:hover:text-dark-primary transition">
            <span>کارهای زمان‌بندی‌شده ({faNum(data.jobs.length)})</span>
            <span className="text-xs text-gray-400 group-open:hidden">نمایش</span>
            <span className="hidden text-xs text-gray-400 group-open:inline">بستن</span>
          </summary>
          <div className="mt-3 max-h-72 overflow-y-auto pl-1">
            {data.jobs.map((job) => (
              <JobRow key={job.name} job={job} />
            ))}
          </div>
        </details>
      )}
    </section>
  )
}
