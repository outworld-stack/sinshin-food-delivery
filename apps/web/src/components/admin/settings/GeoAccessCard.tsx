// ═══════════════════════════════════════════════════════════════
// round-37 — sinshin-food-delivery — فایل 15 از 17
// مسیر مقصد: apps/web/src/components/admin/settings/GeoAccessCard.tsx
// وضعیت: فایل جدید
// کامیت پیشنهادی: stage thirty-three
// ═══════════════════════════════════════════════════════════════

// src/components/admin/settings/GeoAccessCard.tsx
// رارد ۳۷ — کارت «دسترسی جغرافیایی» — جانشین کارت ساده‌ی «فقط ایران».
//
// ساختار دقیقاً بر اساس خواسته‌ی صاحب محصول:
//   ① سوییچ اصلی «دسترسی فقط از ایران» (قفل خارج) — رفتار round-26 دست‌نخورده
//   ② زیرِ همین سوییچ: باکس «مجوز ورود از کشور عراق»
//   ③ وقتی قفلِ ایران «روشن» است → کل بخش عراق + انتخاب دامنه قفل و
//      غیرقابل تغییر است (opacity + pointer-events + یادداشت دلیل)
//   ④ بعد از خاموش‌کردن قفل (فعال‌سازی ورود برای همه) → دو گزینه ظاهر
//      می‌شود: «۱- فقط عراق» (ایران + عراق) و «۲- همه کشورها»
//
// همه‌چیزِ ساخته‌شده برای قفل ایران، اینجا برای عراق هم دیده می‌شود:
// رنج‌های زنده، منبع داده، زمان آخرین به‌روزرسانی، تعداد IP های عبور،
// هشدار GEO_BYPASS_IPS و نکته‌ی «حداکثر ۱۵ ثانیه تا اعمال».
import { memo, useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { setIranOnlyAccess, setOutsideScope } from '#/server/admin'
import type { OutsideScope } from '#/server/admin'
import {
  geoStatusOptions,
  settingsIranOnlyOptions,
  settingsOutsideScopeOptions,
} from '#/utils/queryOptions'
import { qk } from '#/utils/queryKeys'
import { Toggle } from '#/components/shared/Toggle'
import { useToastStore } from '#/stores/toastStore'
import { Shield, ShieldCheck, Discover2, Refresh, Clock, Radio, AlertTriangle, Check } from 'reicon-react'

/** فقط زمان نسخه‌ی خوانا برای پنل (ادمین، سمت کلاینت) */
function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(d)
}

const SCOPE_OPTIONS: Array<{
  value: OutsideScope
  title: string
  desc: string
}> = [
  {
    value: 'iraq',
    title: '۱ — فقط کشور عراق',
    desc: 'ایران + عراق؛ کاربران سایر کشورها مسدود می‌شوند. مناسب نسخه‌ی عربی سایت که برای عراق است.',
  },
  {
    value: 'world',
    title: '۲ — همه کشورها',
    desc: 'بدون هیچ محدودیت جغرافیایی؛ ورود از هر نقطه‌ی دنیا باز است.',
  },
]

export const GeoAccessCard = memo(function GeoAccessCard() {
  const queryClient = useQueryClient()
  const showToast = useToastStore((s) => s.showToast)

  const { data: iranOnly, isLoading: lockLoading } = useQuery({ ...settingsIranOnlyOptions })
  const { data: scope } = useQuery({ ...settingsOutsideScopeOptions })
  const { data: geo, isLoading: statusLoading } = useQuery({ ...geoStatusOptions })

  // سوییچ اصلی — همان phase-fix قبلی
  const iranOnlyMutation = useMutation({
    mutationFn: (enabled: boolean) => setIranOnlyAccess({ data: { enabled } }),
    onSuccess: (_d, enabled) => {
      queryClient.invalidateQueries({ queryKey: qk.settingsIranOnly })
      queryClient.invalidateQueries({ queryKey: qk.geoStatus })
      showToast(
        enabled
          ? 'قفل «فقط ایران» روشن شد — حداکثر تا ۱۵ ثانیه دیگر اعمال می‌شود'
          : 'قفل «فقط ایران» خاموش شد — دامنه‌ی ورود را انتخاب کنید',
      )
    },
  })

  // رارد ۳۷ — انتخاب دامنه (فقط عراق / همه)
  const scopeMutation = useMutation({
    mutationFn: (next: OutsideScope) => setOutsideScope({ data: { scope: next } }),
    onSuccess: (_d, next) => {
      queryClient.invalidateQueries({ queryKey: qk.settingsOutsideScope })
      queryClient.invalidateQueries({ queryKey: qk.geoStatus })
      showToast(
        next === 'iraq'
          ? 'مجوز عراق ذخیره شد — ورود فقط از ایران و عراق (حداکثر ۱۵ ثانیه تا اعمال)'
          : 'ورود برای همه کشورها فعال شد (حداکثر ۱۵ ثانیه تا اعمال)',
      )
    },
  })

  /** قفلِ ایران فعاله؟ (لود نشده = پیش‌فرض روشن) → بخش عراق قفل می‌ماند */
  const locked = iranOnly !== false
  const scopeValue: OutsideScope = scope === 'world' ? 'world' : 'iraq'

  const handleLockToggle = useCallback(() => {
    if (iranOnly !== undefined) iranOnlyMutation.mutate(!iranOnly)
  }, [iranOnly, iranOnlyMutation])

  const handleScopeSelect = useCallback(
    (next: OutsideScope) => {
      if (locked || scopeMutation.isPending) return
      if (next === scopeValue) return
      scopeMutation.mutate(next)
    },
    [locked, scopeMutation, scopeValue],
  )

  // وضعیت باکس عراق — سه حالت
  const iraqActive = !locked && scopeValue === 'iraq'

  return (
    <div className="bg-white dark:bg-[#2a1015] p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
      {/* ① هدر + سوییچ اصلی «فقط ایران» */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors ${
              locked
                ? 'bg-green-100 dark:bg-green-500/10 text-green-500'
                : 'bg-amber-100 dark:bg-amber-500/10 text-amber-500'
            }`}
          >
            <Shield size={22} />
          </span>
          <div>
            <p className="font-DanaDemiBold text-gray-800 dark:text-white">دسترسی جغرافیایی ورود به سایت</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed max-w-xs">
              {lockLoading
                ? 'در حال دریافت وضعیت…'
                : locked
                  ? 'قفل «فقط ایران» روشن است — بازدید از IP های خارج از ایران (شامل عراق) مسدود می‌شود.'
                  : 'قفل «فقط ایران» خاموش است — دامنه‌ی ورود کاربران خارج از ایران را زیرِ همین کارت انتخاب کنید.'}
            </p>
          </div>
        </div>
        <Toggle isOn={iranOnly ?? true} onToggle={handleLockToggle} />
      </div>

      {/* ②③ انتخاب دامنه — وقتی قفل روشن است، قفل و غیرقابل تغییر */}
      <div
        className={`mt-5 rounded-xl border border-gray-200 dark:border-[#3a151c] p-4 transition-opacity ${
          locked ? 'opacity-50 pointer-events-none select-none' : ''
        }`}
      >
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck size={16} className={locked ? 'text-gray-400' : 'text-green-500'} />
          <p className="text-sm font-DanaDemiBold text-gray-800 dark:text-white">
            کاربران خارج از ایران چه کسانی بتوانند وارد شوند؟
          </p>
          {locked && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400 font-DanaMedium">
              قفل است
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {SCOPE_OPTIONS.map((opt) => {
            const selected = scopeValue === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => handleScopeSelect(opt.value)}
                className={`text-right p-4 rounded-xl border-2 transition-all cursor-pointer ${
                  selected
                    ? 'border-primary bg-primary/5 dark:bg-dark-primary/10'
                    : 'border-gray-200 dark:border-[#3a151c] hover:border-gray-300 dark:hover:border-[#4a1a23] bg-gray-50/50 dark:bg-black/10'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                        opt.value === 'iraq'
                          ? 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400'
                          : 'bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300'
                      }`}
                    >
                      {opt.value === 'iraq' ? 'IQ' : 'WW'}
                    </span>
                    <span className="text-sm font-DanaDemiBold text-gray-800 dark:text-white truncate">
                      {opt.title}
                    </span>
                  </div>
                  <span
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      selected ? 'border-primary bg-primary' : 'border-gray-300 dark:border-gray-600'
                    }`}
                  >
                    {selected && <Check size={12} className="text-white" />}
                  </span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 leading-relaxed">{opt.desc}</p>
              </button>
            )
          })}
        </div>

        {locked && (
          <p className="mt-3 text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed">
            برای تنظیم مجوز عراق، ابتدا سوئیچ «دسترسی جغرافیایی» بالای همین کارت (قفل فقط ایران) را خاموش کنید.
          </p>
        )}
      </div>

      {/* ④ باکس مجوز ورود از کشور عراق */}
      <div
        className={`mt-4 rounded-xl border p-4 transition-colors ${
          iraqActive
            ? 'border-amber-300 dark:border-amber-500/40 bg-amber-50/70 dark:bg-amber-500/5'
            : 'border-gray-200 dark:border-[#3a151c] bg-gray-50/50 dark:bg-black/10'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400">
              IQ
            </span>
            <p className="text-sm font-DanaDemiBold text-gray-800 dark:text-white">
              باکس مجوز ورود از کشور عراق
            </p>
          </div>
          <span
            className={`text-[11px] px-2.5 py-1 rounded-full font-DanaMedium ${
              iraqActive
                ? 'bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-400'
                : 'bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400'
            }`}
          >
            {locked ? 'غیرفعال — قفل فقط ایران روشن است' : iraqActive ? 'فعال — ایران + عراق' : 'غیرفعال — ورود برای همه کشورها باز است'}
          </span>
        </div>

        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 leading-relaxed">
          وقتی «فقط عراق» انتخاب باشد، IP های ایران و عراق آزادند و سایر کشورها صفحه‌ی «دسترسی محدود»
          می‌بینند. بازه‌های IP عراق مثل ایران از سه منبع رسمی (RIPE / RIPEstat / ipdeny) روزانه
          تازه می‌شوند.
        </p>

        {/* وضعیت زنده‌ی دروازه — ایران و عراق کنار هم */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-white dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] p-3">
            <div className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
              <Radio size={13} />
              <span className="text-[11px] font-DanaMedium">ایران (IR)</span>
            </div>
            {statusLoading ? (
              <div className="h-4 mt-2 rounded bg-gray-100 dark:bg-white/5 animate-pulse" />
            ) : (
              <p className="text-xs text-gray-700 dark:text-gray-200 mt-1.5 font-DanaMedium" dir="rtl">
                {(geo?.iran.ipv4Prefixes ?? 0).toLocaleString('fa-IR')} رنج IPv4 ·{' '}
                {(geo?.iran.ipv6Prefixes ?? 0).toLocaleString('fa-IR')} رنج IPv6
              </p>
            )}
          </div>
          <div className="rounded-lg bg-white dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] p-3">
            <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
              <Radio size={13} />
              <span className="text-[11px] font-DanaMedium">عراق (IQ)</span>
            </div>
            {statusLoading ? (
              <div className="h-4 mt-2 rounded bg-gray-100 dark:bg-white/5 animate-pulse" />
            ) : (
              <p className="text-xs text-gray-700 dark:text-gray-200 mt-1.5 font-DanaMedium" dir="rtl">
                {(geo?.iraq.ipv4Prefixes ?? 0).toLocaleString('fa-IR')} رنج IPv4 ·{' '}
                {(geo?.iraq.ipv6Prefixes ?? 0).toLocaleString('fa-IR')} رنج IPv6
              </p>
            )}
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-400 dark:text-gray-500">
          <span className="inline-flex items-center gap-1">
            <Discover2 size={12} />
            منبع: {geo?.source ?? '—'}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock size={12} />
            آخرین به‌روزرسانی: {fmtTime(geo?.rangesLoadedAt ?? null)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Refresh size={12} />
            IP های عبور (bypass): {(geo?.bypassIps ?? 0).toLocaleString('fa-IR')}
          </span>
        </div>
      </div>

      {/* هشدار bypass — مثل کارت قبل، ولی برای هر دو کشور */}
      <div className="mt-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 flex items-start gap-2">
        <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-600 dark:text-amber-400 font-DanaMedium leading-relaxed">
          {locked
            ? 'اگر خودتان از خارج از ایران (یا با VPN) وارد می‌شوید، قبل از روشن‌کردن قفل، IP خود را در متغیر محیطی GEO_BYPASS_IPS بگذارید وگرنه از پنل خارج می‌شوید. پیش‌فرض این گزینه روشن است.'
            : 'در حالت «فقط عراق»، اگر از کشوری غیر از ایران و عراق (حتی با VPN روی IP خارجی) وارد می‌شوید، IP خود را در GEO_BYPASS_IPS قرار دهید وگرنه از پنل خارج می‌شوید. تغییرات حداکثر تا ۱۵ ثانیه دیگر اعمال می‌شود.'}
        </p>
      </div>

      {/* راهنمای حالت فعلی */}
      <div className="mt-3 flex items-start gap-2">
        <Discover2 size={14} className="text-gray-400 shrink-0 mt-0.5" />
        <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed">
          حالت فعلی دروازه:{' '}
          <span className="font-DanaMedium text-gray-600 dark:text-gray-300">
            {geo?.mode === 'iran-iraq'
              ? 'ایران + عراق'
              : geo?.mode === 'world'
                ? 'همه کشورها'
                : geo?.mode === 'iran-only'
                  ? 'فقط ایران'
                  : '—'}
          </span>
          {' · '}کاربران مسدود صفحه‌ی «دسترسی محدود» را می‌بینند (۴۰۳ با پیام متناسب با همین حالت).
        </p>
      </div>
    </div>
  )
})
