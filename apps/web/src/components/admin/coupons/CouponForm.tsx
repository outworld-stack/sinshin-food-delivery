// src/components/admin/coupons/CouponForm.tsx
// phase-9: فرم واحد ساخت/ویرایش کوپن — جایگزین CouponModal (حذف‌شده).
// صفحات new.tsx و $couponId.tsx هر دو از همین استفاده می‌کنند.
//
// سه اصلاح ریشه‌ای نسبت به مودال قدیمی:
//  ۱) کلیدهای شرط = همان enum سرور (MIN_ORDERS_COUNT و…) — قبلاً کلیدهای
//     lowercase بودند => انتخاب هر شرطی جز پیش‌فرض، 422 می‌شد.
//  ۲) پیش‌فرض «کوپن عمومی» روشن — قبلاً خاموش بود و بدون شرط، کوپنِ
//     مرده می‌ساخت (نه عمومی، نه گرنت‌شده به کسی).
//  ۳) هیدراته‌شدن از conditions واقعی سرور (type/params) با mapping معکوس —
//     قبلاً rules تخت می‌خواند که هرگز وجود نداشت.
import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { CouponConditionType, CouponRule, CouponWithConditionsDto } from '@sinshin/shared'
import { adminCategoriesOptions, adminProductsOptions } from '#/utils/queryOptions'
import { useToastStore } from '#/stores/toastStore'
import { PersianDatePicker } from '#/components/shared/PersianDatePicker'
import { Toggle } from '#/components/shared/Toggle'
import { gregorianToJalali, jalaliFromISO, jalaliToGregorian, jalaliToISO } from '#/utils/persianDate'
import { X } from 'reicon-react'

/** چیزی که صفحه به سرور می‌فرستد (server/coupons.ts قرارداد را کامل می‌کند) */
export interface CouponFormPayload {
  code: string
  discountPercentage: number
  maxUses: number
  isPublic: boolean
  expiryDate: string | null
  rules: CouponRule[]
}

// ─── تنظیمات قوانین — کلیدها = enum سرور (couponConditionTypeEnum) ───
const ruleConfig: Record<
  CouponConditionType,
  { label: string; placeholder?: string; inputType: 'number' | 'select_products' | 'select_categories'; needsQuantity?: boolean; quantityLabel?: string }
> = {
  MIN_ORDERS_COUNT: { label: 'حداقل تعداد سفارش کل', placeholder: 'مثلا: 5', inputType: 'number' },
  MIN_TOTAL_SPEND: { label: 'حداقل مبلغ پرداختی کل (تومان)', placeholder: 'مثلا: 500000', inputType: 'number' },
  MIN_PRODUCT_ORDERS: { label: 'خرید یک محصول خاص', inputType: 'select_products', needsQuantity: true },
  MIN_CATEGORY_ORDERS: { label: 'خرید از دسته‌بندی خاص', inputType: 'select_categories', needsQuantity: true },
  REGISTERED_DAYS_AGO: { label: 'ثبت‌نام در X روز گذشته', placeholder: 'مثلا: 30', inputType: 'number' },
  MIN_REFERRALS: { label: 'حداقل افراد زیرمجموعه', placeholder: 'مثلا: 5', inputType: 'number' },
  MIN_REFERRAL_ORDERS: { label: 'حداقل مجموع سفارشات زیرمجموعه‌ها', placeholder: 'مثلا: 10', inputType: 'number' },
  MIN_REFERRAL_SPEND: { label: 'حداقل مجموع پرداختی زیرمجموعه‌ها', placeholder: 'مثلا: 1000000', inputType: 'number' },
  ORDERS_IN_LAST_DAYS: { label: 'حداقل تعداد سفارش در روزهای اخیر', placeholder: 'بازه روزها، مثلا: 30', inputType: 'number', needsQuantity: true, quantityLabel: 'تعداد سفارش لازم' },
}

// پیام‌های پویا برای منطق «تقریباً رسیدن»
const ruleHints: Record<CouponConditionType, string> = {
  MIN_ORDERS_COUNT: 'با ثبت ۱ سفارش دیگر، این تخفیف برای شما فعال می‌شود.',
  MIN_TOTAL_SPEND: 'با X تومان خرید دیگر، این تخفیف برای شما فعال می‌شود.',
  MIN_PRODUCT_ORDERS: 'با خرید ۱ عدد دیگر از این محصول، این تخفیف برای شما فعال می‌شود.',
  MIN_CATEGORY_ORDERS: 'با خرید ۱ مورد دیگر از این دسته، این تخفیف برای شما فعال می‌شود.',
  REGISTERED_DAYS_AGO: 'با گذشت زمان لازم، این تخفیف برای شما فعال می‌شود.',
  MIN_REFERRALS: 'با اضافه کردن ۱ زیرمجموعه دیگر، این تخفیف برای شما فعال می‌شود.',
  MIN_REFERRAL_ORDERS: 'با افزایش سفارشات زیرمجموعه‌هایتان به حد نصاب، این تخفیف برای شما فعال می‌شود.',
  MIN_REFERRAL_SPEND: 'با افزایش پرداختی زیرمجموعه‌هایتان به حد نصاب، این تخفیف برای شما فعال می‌شود.',
  ORDERS_IN_LAST_DAYS: 'با ثبت سفارش کافی در روزهای اخیر، این تخفیف برای شما فعال می‌شود.',
}

/** params ارزیاب → قرارداد فرم (value/quantity) — معکوسِ ruleToParams روت */
function paramsToRule(
  type: CouponConditionType,
  params: Record<string, unknown>,
): { value: string | number; quantity?: number } {
  switch (type) {
    case 'MIN_TOTAL_SPEND':
    case 'MIN_REFERRAL_SPEND':
      return { value: Number(params.amount ?? 0) }
    case 'REGISTERED_DAYS_AGO':
      return { value: Number(params.days ?? 0) }
    case 'ORDERS_IN_LAST_DAYS':
      return { value: Number(params.days ?? 0), quantity: Number(params.count ?? 1) }
    case 'MIN_PRODUCT_ORDERS':
      return { value: String(params.productId ?? ''), quantity: Number(params.count ?? 1) }
    case 'MIN_CATEGORY_ORDERS':
      return { value: String(params.categoryId ?? ''), quantity: Number(params.count ?? 1) }
    default:
      return { value: Number(params.count ?? 0) }
  }
}

// ─── state فرم ───
/** rule فرم با کلید پایدار برای رندر لیست (id شرط سرور یا uuid محلی) */
type FormRule = CouponRule & { key: string }

interface CouponFormState {
  code: string
  discount: number
  expiryJalali: string | null // «1404-06-13»
  expiryTime: string // «23:59»
  maxUses: number
  isPublic: boolean
  rules: FormRule[]
}

/** پیش‌فرض — عمومی روشن: کوپن بدون شرطِ خصوصی = کوپن مرده */
const EMPTY_FORM: CouponFormState = {
  code: '',
  discount: 10,
  expiryJalali: null,
  expiryTime: '23:59',
  maxUses: 0,
  isPublic: true,
  rules: [],
}

function hydrate(data: CouponWithConditionsDto | undefined): CouponFormState {
  if (!data) return EMPTY_FORM
  const c = data.coupon
  // endsAt ممکن است null باشد (بدون انقضا) — هیچ‌وقت Date ساخته‌نشده ندهیم
  const t = c.endsAt !== null ? new Date(c.endsAt).getTime() : Number.NaN
  const valid = Number.isFinite(t)
  const d = valid ? new Date(c.endsAt as string) : null
  const p = (n: number) => String(n).padStart(2, '0')
  return {
    code: c.code,
    discount: c.discountPercentage,
    expiryJalali: d ? jalaliToISO(gregorianToJalali(d)) : null,
    expiryTime: d ? `${p(d.getHours())}:${p(d.getMinutes())}` : '23:59',
    maxUses: c.maxUses,
    isPublic: c.isPublic,
    rules: data.conditions.map((cond) => ({
      key: cond.id as string,
      type: cond.type,
      ...paramsToRule(cond.type, cond.params),
    })),
  }
}

const CODE_PATTERN = /^[A-Z0-9\u0600-\u06FF_-]{3,16}$/

interface CouponFormProps {
  /** برای ویرایش — خالی یعنی ساخت */
  initialData?: CouponWithConditionsDto
  onSubmit: (data: CouponFormPayload) => void
  onCancel: () => void
  isSubmitting: boolean
  submitLabel: string
}

export function CouponForm({ initialData, onSubmit, onCancel, isSubmitting, submitLabel }: CouponFormProps) {
  const showToast = useToastStore((state) => state.showToast)

  // کش مشترک با بقیه‌ی مصرف‌کننده‌ها (فرم محصول، فیلتر لیست‌ها)
  const { data: categories } = useQuery(adminCategoriesOptions)
  const { data: productsData } = useQuery(
    adminProductsOptions({ page: 1, limit: 100, search: '', status: '', categoryId: '' }),
  )

  // فرم یک‌بار از initialData پر می‌شود — صفحه فقط بعد از لود کامل رندرش می‌کند
  const [form, setForm] = useState<CouponFormState>(() => hydrate(initialData))
  const set = useCallback((partial: Partial<CouponFormState>) => {
    setForm((f) => ({ ...f, ...partial }))
  }, [])

  // شمسی + ساعت → میلادی کامل برای سرور
  const buildExpiryISO = useCallback((): string | null => {
    const j = form.expiryJalali ? jalaliFromISO(form.expiryJalali) : null
    if (!j) return null
    const d = jalaliToGregorian(j)
    const [h, m] = form.expiryTime.split(':').map(Number)
    d.setHours(Number.isFinite(h) ? h : 23, Number.isFinite(m) ? m : 59, 0, 0)
    return d.toISOString()
  }, [form.expiryJalali, form.expiryTime])

  const addRule = useCallback(() => {
    set({ rules: [...form.rules, { key: crypto.randomUUID(), type: 'MIN_ORDERS_COUNT', value: '' }] })
  }, [form.rules, set])

  const removeRule = useCallback((key: string) => {
    set({ rules: form.rules.filter((r) => r.key !== key) })
  }, [form.rules, set])

  /** به‌روزرسانی فیلد یک rule با کلید پایدار (نه ایندکس — ترتیب لیست قابل تغییر است) */
  const updateRuleByKey = useCallback((key: string, field: keyof CouponRule, value: string | number) => {
    set({
      rules: form.rules.map((r) => (r.key === key ? { ...r, [field]: value } : r)),
    })
  }, [form.rules, set])

  const handleSubmit = useCallback(() => {
    // ── اعتبارسنجی سمت کلاینت — پیام فارسی روشن، قبل از رفت‌وبرگشت سرور ──
    const code = form.code.trim()
    if (!CODE_PATTERN.test(code)) {
      showToast('کد تخفیف باید ۳ تا ۱۶ نویسه باشد: حروف لاتین یا فارسی، رقم و خط تیره', 'error')
      return
    }
    if (form.discount < 1 || form.discount > 99) {
      showToast('درصد تخفیف باید بین ۱ تا ۹۹ باشد', 'error')
      return
    }
    if (form.maxUses < 0) {
      showToast('حداکثر استفاده نمی‌تواند منفی باشد', 'error')
      return
    }
    if (!form.isPublic && form.rules.length === 0) {
      showToast('کوپن خصوصی بدون شرط به هیچ کاربری تعلق نمی‌گیرد — آن را عمومی کنید یا حداقل یک شرط اضافه کنید', 'error')
      return
    }
    const emptyRule = form.rules.some((r) => String(r.value).trim() === '')
    if (emptyRule) {
      showToast('مقدار همه‌ی شرط‌ها را کامل کنید', 'error')
      return
    }

    onSubmit({
      code,
      discountPercentage: form.discount,
      maxUses: form.maxUses,
      isPublic: form.isPublic,
      expiryDate: buildExpiryISO(),
      // key فقط برای رندر است — به سرور نمی‌رود
      rules: form.rules.map((r) => ({ type: r.type, value: r.value, quantity: r.quantity })),
    })
  }, [form, buildExpiryISO, onSubmit, showToast])

  const inputClass =
    'w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm outline-none focus:border-primary dark:focus:border-dark-primary transition-colors'

  return (
    <div className="space-y-6">
      {/* ── اطلاعات اصلی ── */}
      <section className="bg-white dark:bg-[#2a1015] p-4 sm:p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
        <h3 className="font-DanaDemiBold text-gray-800 dark:text-white mb-4">اطلاعات اصلی</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="coupon-code" className="block text-xs text-gray-400 mb-1">کد تخفیف</label>
            <input
              id="coupon-code"
              value={form.code}
              onChange={(e) => set({ code: e.target.value.toUpperCase() })}
              maxLength={16}
              dir="ltr"
              placeholder="SINSHIN20"
              className={`${inputClass} font-mono`}
            />
            <p className="text-[11px] text-gray-400 mt-1.5 leading-relaxed">
              ۳ تا ۱۶ نویسه — حروف لاتین یا فارسی، رقم و خط تیره. مشتری این کد را در چک‌اوت وارد می‌کند.
            </p>
          </div>
          <div>
            <label htmlFor="coupon-discount" className="block text-xs text-gray-400 mb-1">درصد تخفیف</label>
            <input
              id="coupon-discount"
              type="number"
              min={1}
              max={99}
              value={form.discount}
              onChange={(e) => set({ discount: Number(e.target.value) })}
              className={inputClass}
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="coupon-expiry-date" className="block text-xs text-gray-400 mb-1">تاریخ انقضا (شمسی) — خالی بماند یعنی بدون انقضا</label>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1">
                <PersianDatePicker
                  id="coupon-expiry-date"
                  value={form.expiryJalali}
                  onChange={(iso) => set({ expiryJalali: iso })}
                  placeholder="انتخاب تاریخ..."
                />
              </div>
              <input
                type="time"
                dir="ltr"
                value={form.expiryTime}
                onChange={(e) => set({ expiryTime: e.target.value })}
                className="sm:w-28 px-2 py-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm outline-none cursor-pointer"
              />
            </div>
          </div>
          <div>
            <label htmlFor="coupon-max-uses" className="block text-xs text-gray-400 mb-1">حداکثر استفاده (۰ = نامحدود)</label>
            <input
              id="coupon-max-uses"
              type="number"
              min={0}
              value={form.maxUses}
              onChange={(e) => set({ maxUses: Number(e.target.value) })}
              className={inputClass}
            />
          </div>
        </div>
      </section>

      {/* ── مخاطبان ── */}
      <section className="bg-white dark:bg-[#2a1015] p-4 sm:p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <span className="text-sm text-gray-700 dark:text-gray-300 font-DanaDemiBold">کوپن عمومی (برای همه)</span>
            <p className="text-xs text-gray-400 mt-1 leading-relaxed">
              اگر خاموش باشد، فقط کاربرانی که شرایط زیر را دارند و به آن‌ها «اعطا» شده، می‌توانند استفاده کنند.
            </p>
          </div>
          <Toggle isOn={form.isPublic} onToggle={() => set({ isPublic: !form.isPublic })} />
        </div>
      </section>

      {/* ── قوانین هدف‌یابی (فقط کوپن خصوصی) ── */}
      {!form.isPublic && (
        <section className="bg-white dark:bg-[#2a1015] p-4 sm:p-6 rounded-2xl border border-gray-200 dark:border-[#3a151c] shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
            <h3 className="font-DanaDemiBold text-gray-800 dark:text-white">قوانین هدف‌یابی کاربران</h3>
            <button
              type="button"
              onClick={addRule}
              className="text-xs text-primary dark:text-dark-primary hover:underline cursor-pointer shrink-0"
            >
              + افزودن شرط
            </button>
          </div>

          <div className="space-y-3">
            {form.rules.map((rule) => {
              const config = ruleConfig[rule.type]
              return (
                <div key={rule.key} className="flex flex-col gap-2 bg-gray-50 dark:bg-[#1a0a0e] p-3 rounded-lg">
                  <div className="flex items-center gap-2">
                    <select
                      value={rule.type}
                      onChange={(e) => {
                        // round-11 (اسکن M-4): تعویض نوع شرط مقدار قدیمی را نگه
                        // نمی‌دارد — قبلاً «۵» به‌عنوان productId شرط MIN_PRODUCT_ORDERS
                        // ذخیره می‌شد (شرط مرده) چون value خالی به‌نظر نمی‌رسید.
                        // یک set واحد (دو updateRuleByKey پشت‌سرهم closure کهنه می‌دید).
                        const newType = e.target.value as keyof typeof ruleConfig
                        set({
                          rules: form.rules.map((r) =>
                            r.key === rule.key && r.type !== newType
                              ? { ...r, type: newType, value: '' }
                              : r,
                          ),
                        })
                      }}
                      className="flex-1 px-2 py-2 rounded-md bg-white dark:bg-[#2a1015] border border-gray-200 dark:border-[#3a151c] text-xs outline-none cursor-pointer"
                    >
                      {Object.entries(ruleConfig).map(([key, val]) => (
                        <option key={key} value={key}>{val.label}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => removeRule(rule.key)}
                      aria-label="حذف شرط"
                      className="p-2 text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-md cursor-pointer shrink-0"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {config?.inputType === 'select_products' && (
                      <select
                        value={String(rule.value)}
                        onChange={(e) => updateRuleByKey(rule.key, 'value', e.target.value)}
                        className="sm:col-span-2 px-2 py-2 rounded-md bg-white dark:bg-[#2a1015] border border-gray-200 dark:border-[#3a151c] text-xs outline-none cursor-pointer"
                      >
                        <option value="">انتخاب محصول...</option>
                        {productsData?.products.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    )}
                    {config?.inputType === 'select_categories' && (
                      <select
                        value={String(rule.value)}
                        onChange={(e) => updateRuleByKey(rule.key, 'value', e.target.value)}
                        className="sm:col-span-2 px-2 py-2 rounded-md bg-white dark:bg-[#2a1015] border border-gray-200 dark:border-[#3a151c] text-xs outline-none cursor-pointer"
                      >
                        <option value="">انتخاب دسته...</option>
                        {categories?.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    )}
                    {config?.inputType === 'number' && (
                      <input
                        type="number"
                        placeholder={config.placeholder}
                        value={rule.value}
                        onChange={(e) => updateRuleByKey(rule.key, 'value', e.target.value)}
                        className="sm:col-span-2 px-2 py-2 rounded-md bg-white dark:bg-[#2a1015] border border-gray-200 dark:border-[#3a151c] text-xs outline-none"
                      />
                    )}
                    {config?.needsQuantity && (
                      <input
                        type="number"
                        placeholder={config.quantityLabel ?? 'تعداد خرید لازم'}
                        value={rule.quantity || ''}
                        onChange={(e) => updateRuleByKey(rule.key, 'quantity', Number(e.target.value))}
                        className="sm:col-span-2 px-2 py-2 rounded-md bg-white dark:bg-[#2a1015] border border-gray-200 dark:border-[#3a151c] text-xs outline-none"
                      />
                    )}
                  </div>
                </div>
              )
            })}
            {form.rules.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-4">هیچ شرطی تعریف نشده است.</p>
            )}
          </div>

          <div className="mt-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20">
            <p className="text-xs text-blue-600 dark:text-blue-400 font-DanaMedium mb-2">💡 سیستم هوشمند بازاریابی رفتاری:</p>
            <ul className="list-disc pr-4 space-y-1 text-[11px] text-blue-500 dark:text-blue-300/80">
              {form.rules.map((rule) => (
                <li key={rule.key}>{ruleHints[rule.type]}</li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* ── عملیات ── */}
      <div className="flex flex-col-reverse sm:flex-row gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-2.5 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 text-sm cursor-pointer hover:opacity-90 transition"
        >
          انصراف
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="flex-1 py-2.5 rounded-xl bg-primary dark:bg-dark-primary text-white text-sm cursor-pointer hover:opacity-90 transition disabled:opacity-50"
        >
          {isSubmitting ? 'در حال ذخیره...' : submitLabel}
        </button>
      </div>
    </div>
  )
}
