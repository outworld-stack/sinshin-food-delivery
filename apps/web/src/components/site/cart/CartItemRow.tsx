// ═══════════════════════════════════════════════════════════════
// stage-55 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/components/site/cart/CartItemRow.tsx
// وضعیت: ویرایش فایل موجود (یک تغییر نقطه‌ای)
// تغییر: فونت‌های خراب font-DanaBold → font-DanaDemiBold (دو دکمه)
// ═══════════════════════════════════════════════════════════════

// src/components/site/cart/CartItemRow.tsx
// stage-48 — هشدار نارنجی در باکس هر محصول: ناموجودی + محدودیت حالت سفارش
// (مؤثر = دسته AND محصول؛ از سرور با جزئیات سبد می‌آید).

import { Link } from '@tanstack/react-router'
import { memo, useCallback } from 'react'
import { Trash2, BoxRemove, Bicycle, Bag, Chair, Plus, Minus } from 'reicon-react'
import { CART_MAX_QTY, cartItemKey } from '#/stores/cartStore'
import { useI18n } from '#/i18n'

interface CartItem {
        id: string
        sizeId: string | null
        sizeName: string | null
        name: string
        // ⬅ عوض شد: imageGradient → profileImage
        profileImage: string | null
        originalPrice: number
        finalPrice: number
        quantity: number
        lineTotal: number
        /** stage-48 — ناموجود (هشدار نارنجی + خارج از جمع) */
        available?: boolean
        /** stage-48 — حالت‌های مؤثر سفارش */
        courierAllowed?: boolean
        takeawayAllowed?: boolean
        dineInAllowed?: boolean
}

interface CartItemRowProps {
        item: CartItem
        onIncrement: (key: string, quantity: number) => void
        onDecrement: (key: string, quantity: number) => void
        onRemove: (key: string) => void
}

// رارد ۳۲ — قیمت/تعداد/aria دوزبانه (fmt.price با ارقام زبان فعال)
// stage-48 — ردیف ناموجود: ظاهر کم‌رنگ + هشدار نارنجی داخل باکس
export const CartItemRow = memo(function CartItemRow({
        item,
        onIncrement,
        onDecrement,
        onRemove,
}: CartItemRowProps) {
        const { t, fmt } = useI18n()
        const key = cartItemKey(item.id, item.sizeId)

        const unavailable = item.available === false
        const courierOk = item.courierAllowed !== false
        const takeawayOk = item.takeawayAllowed !== false
        const dineInOk = item.dineInAllowed !== false
        const restrictions: string[] = []
        if (!courierOk) restrictions.push(t['cart.noCourier'])
        if (!takeawayOk) restrictions.push(t['cart.noTakeaway'])
        if (!dineInOk) restrictions.push(t['cart.noDineIn'])

        const handleInc = useCallback(
                () => onIncrement(key, item.quantity),
                [onIncrement, key, item.quantity],
        )
        const handleDec = useCallback(
                () => onDecrement(key, item.quantity),
                [onDecrement, key, item.quantity],
        )
        const handleRem = useCallback(() => onRemove(key), [onRemove, key])

        return (
                <div
                        className={`flex flex-col gap-3 bg-white dark:bg-[#2a1015] p-3.5 sm:p-4 rounded-2xl border shadow-sm transition ${
                                unavailable
                                        ? 'border-orange-200 dark:border-orange-500/30 opacity-80'
                                        : 'border-gray-200 dark:border-[#3a151c]'
                        }`}
                >
                        {/* ── stage-59 — ردیف ۱: عکس (سرِ جای خود) + عنوانِ کامل/قیمت + حذف ── */}
                        <div className="flex items-start gap-3">
                                {/* عکس — profileImage یا پشتیبان گرادیانت */}
                                <div
                                        className={`w-16 h-16 sm:w-20 sm:h-20 rounded-xl shrink-0 bg-cover bg-center bg-linear-to-br from-primary/20 to-dark-primary/20 ${unavailable ? 'blur-[2px] saturate-75' : ''}`}
                                        style={
                                                item.profileImage
                                                        ? { backgroundImage: `url(${item.profileImage})` }
                                                        : undefined
                                        }
                                />

                                <div className="flex-1 min-w-0">
                                        {/* عنوان کامل — بدون truncate؛ چند خطی مجاز (stage-59) */}
                                        <Link
                                                to="/products/$productId"
                                                params={{ productId: item.id }}
                                                className="font-DanaDemiBold text-sm sm:text-base text-gray-800 dark:text-white leading-relaxed wrap-break-word hover:text-primary dark:hover:text-dark-primary transition cursor-pointer"
                                        >
                                                {item.name}
                                        </Link>

                                        {item.sizeName && (
                                                <span className="inline-flex items-center mt-1 px-2 py-0.5 rounded-md bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary text-[10px] font-DanaDemiBold">
                                                        {item.sizeName}
                                                </span>
                                        )}

                                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                                {item.originalPrice > item.finalPrice && (
                                                        <span className="text-[11px] text-gray-400 line-through font-DanaRegular">
                                                                {fmt.price(item.originalPrice)}
                                                        </span>
                                                )}
                                                <span
                                                        className={`text-sm font-DanaDemiBold ${unavailable ? 'text-gray-400 dark:text-gray-500' : 'text-primary dark:text-dark-primary'}`}
                                                >
                                                        {fmt.price(item.finalPrice)}
                                                </span>
                                                <span className="text-[10px] text-gray-500 dark:text-gray-400 font-DanaRegular">
                                                        {t['common.toman']}
                                                </span>
                                        </div>
                                </div>

                                {/* حذف — گوشه‌ی چپ بالا (RTL) */}
                                <button
                                        type="button"
                                        onClick={handleRem}
                                        className="text-red-400 hover:text-red-500 transition cursor-pointer p-1 shrink-0 self-start"
                                        aria-label={t['cart.removeItem']}
                                >
                                        <Trash2 size={18} />
                                </button>
                        </div>

                        {/* ── stage-59 — ردیف ۲: استپر تعداد + جمع ردیف (عدد‌ها جمع‌وجورتر) ── */}
                        <div className="flex items-center justify-between gap-3 pt-3 border-t border-gray-100 dark:border-white/5">
                                {/* استپر — آیکن‌های SVG واقعی به‌جای +/− متنی فونت‌دار */}
                                <div className="flex items-center gap-0.5 bg-gray-100 dark:bg-[#1a0a0e] rounded-full p-1">
                                        <button
                                                type="button"
                                                onClick={handleInc}
                                                disabled={unavailable || item.quantity >= CART_MAX_QTY}
                                                className="w-9 h-9 flex items-center justify-center rounded-full text-primary dark:text-dark-primary hover:bg-white dark:hover:bg-[#2a1015] active:scale-90 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                                aria-label={t['cart.incQty']}
                                        >
                                                <Plus size={16} />
                                        </button>
                                        <span className="font-DanaDemiBold text-sm text-gray-800 dark:text-white w-7 text-center">
                                                {fmt.num(item.quantity)}
                                        </span>
                                        <button
                                                type="button"
                                                onClick={handleDec}
                                                disabled={unavailable}
                                                className="w-9 h-9 flex items-center justify-center rounded-full text-gray-500 dark:text-gray-400 hover:bg-white dark:hover:bg-[#2a1015] hover:text-red-400 active:scale-90 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                                aria-label={t['cart.decQty']}
                                        >
                                                <Minus size={16} />
                                        </button>
                                </div>

                                {/* جمع ردیف */}
                                <div className="text-left">
                                        <span className="text-[10px] text-gray-500 dark:text-gray-400 block font-DanaRegular">
                                                {t['cart.lineTotal']}
                                        </span>
                                        <span className="text-sm font-DanaDemiBold text-gray-900 dark:text-white">
                                                {fmt.price(item.lineTotal)}{' '}
                                                <span className="text-[10px] text-gray-500 dark:text-gray-400 font-DanaRegular">
                                                        {t['common.tomanShort']}
                                                </span>
                                        </span>
                                </div>
                        </div>

                        {/* ── stage-48 — هشدارهای نارنجی (ناموجودی / محدودیت ارسال) ── */}
                        {unavailable && (
                                <div className="flex items-center gap-2 p-2.5 rounded-xl bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20">
                                        <BoxRemove size={16} className="text-orange-500 shrink-0" />
                                        <p className="text-[11px] text-orange-600 dark:text-orange-400 font-DanaMedium leading-relaxed">
                                                {t['cart.unavailableItem']}
                                        </p>
                                </div>
                        )}
                        {restrictions.length > 0 && (
                                <div className="flex items-start gap-2 p-2.5 rounded-xl bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20">
                                        <span className="flex items-center gap-1 text-orange-500 shrink-0 mt-0.5">
                                                <Bicycle size={14} className={courierOk ? 'hidden' : ''} />
                                                <Bag size={14} className={takeawayOk ? 'hidden' : ''} />
                                                <Chair size={14} className={dineInOk ? 'hidden' : ''} />
                                        </span>
                                        <p className="text-[11px] text-orange-600 dark:text-orange-400 font-DanaMedium leading-relaxed">
                                                {t['cart.modeRestrictionPrefix']} {restrictions.join('، ')}
                                                {t['cart.modeRestrictionSuffix']}
                                        </p>
                                </div>
                        )}
                </div>
        )
})