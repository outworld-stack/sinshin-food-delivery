// src/components/admin/CouponModal.tsx
import { useState, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createCoupon, updateCoupon, type CouponRule } from '#/server/coupons'
import { adminCategoriesOptions, adminProductsOptions } from '#/utils/queryOptions'
import { qk } from '#/utils/queryKeys'
import { useToastStore } from '#/stores/toastStore'
import { PersianDatePicker } from '#/components/shared/PersianDatePicker'
import { gregorianToJalali, jalaliFromISO, jalaliToGregorian, jalaliToISO } from '#/utils/persianDate'
import { X } from 'reicon-react'
import type { AdminCoupon } from '#/types/admin/coupons'

// تنظیمات قوانین برای نمایش در UI
const ruleConfig: Record<string, { label: string, placeholder?: string, inputType: 'text' | 'number' | 'select_products' | 'select_categories', needsQuantity?: boolean }> = {
    min_orders: { label: 'حداقل تعداد سفارش کل', placeholder: 'مثلا: 5', inputType: 'number' },
    min_spent: { label: 'حداقل مبلغ پرداختی کل (تومان)', placeholder: 'مثلا: 500000', inputType: 'number' },
    purchased_product: { label: 'خرید یک محصول خاص', inputType: 'select_products', needsQuantity: true },
    purchased_category: { label: 'خرید از دسته‌بندی خاص', inputType: 'select_categories', needsQuantity: true },
    registered_days_ago: { label: 'ثبت‌نام در X روز گذشته', placeholder: 'مثلا: 30', inputType: 'number' },
    min_referrals: { label: 'حداقل افراد زیرمجموعه', placeholder: 'مثلا: 5', inputType: 'number' },
    min_referral_orders: { label: 'حداقل مجموع سفارشات زیرمجموعه‌ها', placeholder: 'مثلا: 10', inputType: 'number' },
    min_referral_spent: { label: 'حداقل مجموع پرداختی زیرمجموعه‌ها', placeholder: 'مثلا: 1000000', inputType: 'number' },
}

// پیام‌های پویا برای منطق «تقریباً رسیدن»
const ruleHints: Record<string, string> = {
    min_orders: 'با ثبت ۱ سفارش دیگر، این تخفیف برای شما فعال می‌شود.',
    min_spent: 'با X تومان خرید دیگر، این تخفیف برای شما فعال می‌شود.',
    purchased_product: 'با خرید ۱ عدد دیگر از این محصول، این تخفیف برای شما فعال می‌شود.',
    purchased_category: 'با خرید ۱ مورد دیگر از این دسته، این تخفیف برای شما فعال می‌شود.',
    registered_days_ago: 'با گذشت زمان لازم، این تخفیف برای شما فعال می‌شود.',
    min_referrals: 'با اضافه کردن ۱ زیرمجموعه دیگر، این تخفیف برای شما فعال می‌شود.',
    min_referral_orders: 'با افزایش سفارشات زیرمجموعه‌هایتان به حد نصاب، این تخفیف برای شما فعال می‌شود.',
    min_referral_spent: 'با افزایش پرداختی زیرمجموعه‌هایتان به حد نصاب، این تخفیف برای شما فعال می‌شود.'
}

// فرم واحد به‌جای ۷ استیت پراکنده
interface CouponForm {
    code: string
    discount: number
    expiryJalali: string | null     // «1404-06-13»
    expiryTime: string              // «23:59»
    maxUses: number
    isPublic: boolean
    rules: CouponRule[]
}

const EMPTY_FORM: CouponForm = {
    code: '',
    discount: 10,
    expiryJalali: null,
    expiryTime: '23:59',
    maxUses: 1,
    isPublic: false,
    rules: [],
}

interface CouponModalProps {
    onClose: () => void
    editingCoupon: AdminCoupon | null
}

export function CouponModal({ onClose, editingCoupon }: CouponModalProps) {
    const queryClient = useQueryClient()
    const showToast = useToastStore((state) => state.showToast)

    // ⬅ NEW: فکتوری‌های مرکزی — قبلاً کلید خام ['categories'] بود؛
    // حالا با بقیه مصرف‌کننده‌ها (فرم محصول، فیلتر لیست‌ها) یک کش مشترک
    const { data: categories } = useQuery(adminCategoriesOptions)
    // ⬅ NEW: قبلاً کلید خام ['admin-products', 1, 100] بود — hash متفاوت با
    // کلید فکتوری => فچ تکراری همان دیتا؛ حالا کش مشترک با لیست محصولات
    const { data: productsData } = useQuery(adminProductsOptions({ page: 1, limit: 100, search: '', status: '', categoryId: '' }))

    const [form, setForm] = useState<CouponForm>(EMPTY_FORM)
    const set = useCallback((partial: Partial<CouponForm>) => {
        setForm(f => ({ ...f, ...partial }))
    }, [])

    // هیدراته‌کردن برای ویرایش — میلادی سرور → شمسی + ساعت محلی (بدون جابجایی زمانی)
    useEffect(() => {
        if (editingCoupon) {
            const d = new Date(editingCoupon.expiryDate)
            const p = (n: number) => String(n).padStart(2, '0')
            setForm({
                code: editingCoupon.code,
                discount: editingCoupon.discountPercentage,
                expiryJalali: jalaliToISO(gregorianToJalali(d)),
                expiryTime: `${p(d.getHours())}:${p(d.getMinutes())}`,
                maxUses: editingCoupon.maxUses,
                isPublic: editingCoupon.isPublic,
                rules: editingCoupon.rules || [],
            })
        } else {
            setForm(EMPTY_FORM)
        }
    }, [editingCoupon])

    const saveMut = useMutation({
        mutationFn: (data: any) => editingCoupon ? updateCoupon({ id: editingCoupon.id, ...data }) : createCoupon(data),
        onSuccess: () => {
            // ⬅ NEW: کلید از فکتوری مرکزی — هم‌hash با کوئری صفحه‌ی کوپن‌ها
            queryClient.invalidateQueries({ queryKey: qk.adminCoupons })
            showToast(editingCoupon ? 'کوپن ویرایش شد' : 'کوپن ایجاد شد')
            onClose()
        }
    })

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
        set({ rules: [...form.rules, { type: 'MIN_ORDERS_COUNT', value: '' }] })
    }, [form.rules, set])

    const updateRule = useCallback((index: number, field: keyof CouponRule, value: string | number) => {
        const newRules = [...form.rules]
        newRules[index] = { ...newRules[index], [field]: value }
        set({ rules: newRules })
    }, [form.rules, set])

    const removeRule = useCallback((index: number) => {
        set({ rules: form.rules.filter((_, i) => i !== index) })
    }, [form.rules, set])

    const handleSubmit = useCallback(() => {
        const expiryISO = buildExpiryISO()
        if (!form.code || !expiryISO) { showToast('کد و تاریخ انقضا الزامی است', 'error'); return }
        saveMut.mutate({ code: form.code, discountPercentage: form.discount, expiryDate: expiryISO, maxUses: form.maxUses, isPublic: form.isPublic, rules: form.rules })
    }, [form, buildExpiryISO, saveMut, showToast])

    return (
        <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose}></div>
            <div className="relative bg-white dark:bg-[#2a1015] p-6 rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                <h3 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white mb-6">{editingCoupon ? 'ویرایش کوپن' : 'ایجاد کوپن هدفمند'}</h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                        <label className="block text-xs text-gray-400 mb-1">کد تخفیف</label>
                        <input value={form.code} onChange={e => set({ code: e.target.value.toUpperCase() })} placeholder="SUMMER20" className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm outline-none" />
                    </div>
                    <div>
                        <label className="block text-xs text-gray-400 mb-1">درصد تخفیف</label>
                        <input type="number" value={form.discount} onChange={e => set({ discount: Number(e.target.value) })} className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm outline-none" />
                    </div>
                    <div>
                        <label className="block text-xs text-gray-400 mb-1">تاریخ انقضا (شمسی)</label>
                        <div className="flex gap-2">
                            <div className="flex-1">
                                <PersianDatePicker
                                    value={form.expiryJalali}
                                    onChange={(iso) => set({ expiryJalali: iso })}
                                    placeholder="انتخاب تاریخ..."
                                />
                            </div>
                            <input
                                type="time"
                                dir="ltr"
                                value={form.expiryTime}
                                onChange={e => set({ expiryTime: e.target.value })}
                                className="w-28 px-2 py-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm outline-none cursor-pointer"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs text-gray-400 mb-1">حداکثر استفاده (۰ = نامحدود)</label>
                        <input type="number" value={form.maxUses} onChange={e => set({ maxUses: Number(e.target.value) })} className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] text-sm outline-none" />
                    </div>
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-[#1a0a0e] mb-6">
                    <div>
                        <span className="text-sm text-gray-700 dark:text-gray-300">کوپن عمومی (برای همه)</span>
                        <p className="text-xs text-gray-400 mt-1">اگر خاموش باشد، فقط کاربرانی که شرایط زیر را دارند پیامک دریافت می‌کنند</p>
                    </div>
                    <button type="button" onClick={() => set({ isPublic: !form.isPublic })} className={`relative w-12 h-6 rounded-full transition ${form.isPublic ? 'bg-primary dark:bg-dark-primary' : 'bg-gray-300 dark:bg-gray-600'} cursor-pointer shrink-0`}>
                        <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-all ${form.isPublic ? 'left-0.5' : 'right-0.5'}`}></span>
                    </button>
                </div>

                {!form.isPublic && (
                    <div className="border-t border-gray-100 dark:border-white/5 pt-4">
                        <div className="flex items-center justify-between mb-4">
                            <h4 className="font-DanaDemiBold text-gray-800 dark:text-white">قوانین هدف‌یابی کاربران</h4>
                            <button onClick={addRule} className="text-xs text-primary dark:text-dark-primary hover:underline cursor-pointer">+ افزودن شرط</button>
                        </div>

                        <div className="space-y-3">
                            {form.rules.map((rule, index) => {
                                const config = ruleConfig[rule.type]
                                return (
                                    <div key={index} className="flex flex-col gap-2 bg-gray-50 dark:bg-[#1a0a0e] p-3 rounded-lg">
                                        <div className="flex items-center gap-2">
                                            <select
                                                value={rule.type}
                                                onChange={(e) => updateRule(index, 'type', e.target.value)}
                                                className="flex-1 px-2 py-2 rounded-md bg-white dark:bg-[#2a1015] border border-gray-200 dark:border-[#3a151c] text-xs outline-none cursor-pointer"
                                            >
                                                {Object.entries(ruleConfig).map(([key, val]) => <option key={key} value={key}>{val.label}</option>)}
                                            </select>
                                            <button onClick={() => removeRule(index)} className="p-2 text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-md cursor-pointer shrink-0">
                                                <X size={16} />
                                            </button>
                                        </div>

                                        <div className="grid grid-cols-2 gap-2">
                                            {config?.inputType === 'select_products' && (
                                                <select
                                                    value={rule.value}
                                                    onChange={(e) => updateRule(index, 'value', e.target.value)}
                                                    className="col-span-2 px-2 py-2 rounded-md bg-white dark:bg-[#2a1015] border border-gray-200 dark:border-[#3a151c] text-xs outline-none cursor-pointer"
                                                >
                                                    <option value="">انتخاب محصول...</option>
                                                    {productsData?.products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                                </select>
                                            )}
                                            {config?.inputType === 'select_categories' && (
                                                <select
                                                    value={rule.value}
                                                    onChange={(e) => updateRule(index, 'value', e.target.value)}
                                                    className="col-span-2 px-2 py-2 rounded-md bg-white dark:bg-[#2a1015] border border-gray-200 dark:border-[#3a151c] text-xs outline-none cursor-pointer"
                                                >
                                                    <option value="">انتخاب دسته...</option>
                                                    {categories?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                                </select>
                                            )}
                                            {(config?.inputType === 'number' || config?.inputType === 'text') && (
                                                <input
                                                    type={config.inputType}
                                                    placeholder={config.placeholder}
                                                    value={rule.value}
                                                    onChange={(e) => updateRule(index, 'value', e.target.value)}
                                                    className="col-span-2 px-2 py-2 rounded-md bg-white dark:bg-[#2a1015] border border-gray-200 dark:border-[#3a151c] text-xs outline-none"
                                                />
                                            )}
                                            {config?.needsQuantity && (
                                                <input
                                                    type="number"
                                                    placeholder="تعداد خرید لازم"
                                                    value={rule.quantity || ''}
                                                    onChange={(e) => updateRule(index, 'quantity', Number(e.target.value))}
                                                    className="col-span-2 px-2 py-2 rounded-md bg-white dark:bg-[#2a1015] border border-gray-200 dark:border-[#3a151c] text-xs outline-none"
                                                />
                                            )}
                                        </div>
                                    </div>
                                )
                            })}
                            {form.rules.length === 0 && <p className="text-xs text-gray-400 text-center py-4">هیچ شرطی تعریف نشده است.</p>}
                        </div>

                        <div className="mt-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20">
                            <p className="text-xs text-blue-600 dark:text-blue-400 font-DanaMedium mb-2">💡 سیستم هوشمند بازاریابی رفتاری:</p>
                            <ul className="list-disc pr-4 space-y-1 text-[11px] text-blue-500 dark:text-blue-300/80">
                                {form.rules.map((rule, i) => ruleHints[rule.type] && <li key={i}>{ruleHints[rule.type]}</li>)}
                            </ul>
                        </div>
                    </div>
                )}

                <div className="flex gap-3 pt-6 mt-4 border-t border-gray-100 dark:border-white/5">
                    <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-gray-100 dark:bg-[#1a0a0e] text-gray-600 dark:text-gray-300 text-sm cursor-pointer">انصراف</button>
                    <button onClick={handleSubmit} disabled={saveMut.isPending} className="flex-1 py-2.5 rounded-xl bg-primary dark:bg-dark-primary text-white text-sm cursor-pointer disabled:opacity-50">
                        {saveMut.isPending ? 'در حال ذخیره...' : 'ذخیره کوپن'}
                    </button>
                </div>
            </div>
        </div>
    )
}