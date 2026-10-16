// src/hooks/admin/useCouponMutations.ts
// جهش‌های کوپن — منبع واحد رارد ۴۸ (اسکن B13).
// حذف/فعال‌سازی قبلاً در صفحه‌ی لیست و صفحه‌ی جزئیات جدا نوشته می‌شدند؛
// تفاوت‌های واقعی (حذف اپتیمیستیک در لیست، ناوبری/ماندن) به‌صورت گزینه می‌مانند.
//
// stage-65 — دو مسیر جدا:
//   • DELETE = حذف واقعی (غیرقابل‌برگشت) + پاکشدن تاریخچهی مصرف با cascade
//   • PATCH /status {active:false} = غیرفعال‌سازی نمم (برگشت‌پذیر)

import type { CouponWithConditionsDto } from '@sinshin/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { deleteCoupon, setCouponActive } from '#/server/coupons'
import { useToastStore } from '#/stores/toastStore'
import { qk } from '#/utils/queryKeys'

export interface CouponMutationOptions {
        /** در صفحه‌ی جزئیات: کلید کش همان کوپن هم نامعتبر شود */
        couponId?: string
        /** حذف اپتیمیستیک با rollback — رفتار صفحه‌ی لیست */
        optimisticDelete?: boolean
        /** بعد از حذف موفق — بستن مودال (لیست) یا ناوبری (جزئیات) */
        onDeleted?: () => void
}

/** فعال‌سازی مجدد — مستقیم؛ خطا (مثل انقضای گذشته) پیام شناور می‌شود */
export function useCouponActivate(opts: CouponMutationOptions = {}) {
        const queryClient = useQueryClient()
        const showToast = useToastStore((s) => s.showToast)
        return useMutation({
                mutationFn: (id?: string) =>
                        setCouponActive(id ?? opts.couponId ?? '', true),
                onSuccess: (res) => {
                        if (opts.couponId) {
                                queryClient.invalidateQueries({
                                        queryKey: qk.adminCouponDetails(opts.couponId),
                                })
                        }
                        showToast(res.message || 'کوپن فعال شد')
                },
                onError: (err) => showToast(err.message || 'فعال‌سازی ناموفق بود', 'error'),
                onSettled: () => {
                        queryClient.invalidateQueries({ queryKey: qk.adminCoupons })
                },
        })
}

/** stage-65 — غیرفعال‌سازی نم (برگشت‌پذیر) — مسیر /status */
export function useCouponDeactivate(opts: CouponMutationOptions = {}) {
        const queryClient = useQueryClient()
        const showToast = useToastStore((s) => s.showToast)
        return useMutation({
                mutationFn: (id?: string) =>
                        setCouponActive(id ?? opts.couponId ?? '', false),
                onSuccess: (res) => {
                        if (opts.couponId) {
                                queryClient.invalidateQueries({
                                        queryKey: qk.adminCouponDetails(opts.couponId),
                                })
                        }
                        showToast(res.message || 'کوپن غیرفعال شد')
                },
                onError: (err) => showToast(err.message || 'غیرفعال‌سازی ناموفق بود', 'error'),
                onSettled: () => {
                        queryClient.invalidateQueries({ queryKey: qk.adminCoupons })
                },
        })
}

/** stage-65 — حذف واقعی (غیرقابل‌برگشت): ردیف + تاریخچهی مصرف با cascade پاک می‌شوند */
export function useCouponDelete(opts: CouponMutationOptions = {}) {
        const queryClient = useQueryClient()
        const showToast = useToastStore((s) => s.showToast)
        return useMutation({
                mutationFn: (id?: string) => deleteCoupon(id ?? opts.couponId ?? ''),
                ...(opts.optimisticDelete
                        ? {
                                        // حذف اپتیمیستیک با rollback — همان الگوی قبل از phase-9
                                        onMutate: async (id?: string) => {
                                                await queryClient.cancelQueries({ queryKey: qk.adminCoupons })
                                                const previous = queryClient.getQueryData<
                                                        CouponWithConditionsDto[]
                                                >(qk.adminCoupons)
                                                queryClient.setQueryData<CouponWithConditionsDto[]>(
                                                        qk.adminCoupons,
                                                        (old) =>
                                                                old && id ? old.filter((c) => c.coupon.id !== id) : old,
                                                )
                                                return { previous }
                                        },
                                        onError: (
                                                _err: unknown,
                                                _id: string | undefined,
                                                ctx: { previous?: CouponWithConditionsDto[] } | undefined,
                                        ) => {
                                                if (ctx?.previous)
                                                        queryClient.setQueryData(qk.adminCoupons, ctx.previous)
                                        },
                                }
                        : {}),
                onSuccess: (res, id) => {
                        // stage-72 (P2-۲۲) — حذف از «صفحه‌ی لیست» قبلاً couponId را پاس
                        // نمی‌داد → کشِ details/consumers همان کوپن می‌ماند و بازکردنِ
                        // URL جزئیات، کوپنِ حذف‌شده را نشان می‌داد. حالا با «همان idِ
                        // واقعیِ حذف‌شده» (پارامتر mutate یا opts) هر دو کش را می‌گیریم.
                        const deletedId = id ?? opts.couponId
                        if (deletedId) {
                                queryClient.removeQueries({
                                        queryKey: qk.adminCouponDetails(deletedId),
                                })
                                queryClient.removeQueries({
                                        queryKey: qk.adminCouponConsumersBase(deletedId),
                                })
                        }
                        // stage-65 — پیام واقعی سرور: «کوپن و تاریخچهی مصرف آن حذف شد»
                        showToast(res.message || 'کوپن و تاریخچهی مصرف آن حذف شد')
                        opts.onDeleted?.()
                },
                onSettled: () => {
                        queryClient.invalidateQueries({ queryKey: qk.adminCoupons })
                },
        })
}