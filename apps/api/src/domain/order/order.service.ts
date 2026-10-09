// ═══════════════════════════════════════════════════════════════
// round-48 — sinshin-food-delivery — فایل 21 از 97
// مسیر مقصد: apps/api/src/domain/order/order.service.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage forty-three
// ═════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// phase-2 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/domain/order/order.service.ts
// وضعیت: جایگزینی کامل فایل موجود (پایه: نسخه‌ی فاز-۱ با C1+M9+L3)
// تغییر فاز-۲: بعد از اعطای کوپن، پوش نوتیفیکیشن به کاربر می‌رود
// ═══════════════════════════════════════════════════════════════

//src/domain/order/order.service.ts
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import type { Db, DbOrTx } from "#/infra/db/client";
import {
        addresses,
        couponRedemptions,
        couponGrants,
        coupons,
        couriers,
        orderItems,
        orders,
        payments,
        referralProfits,
        users,
        walletTransactions,
        type OrderItemRow,
        type OrderRow,
} from "#/infra/db/schema";
import {
        asAddressId,
        asCampaignId,
        asProductId,
        asSizeId,
        type CampaignId,
        type CourierId,
        type OrderId,
        type PaymentId,
        type ProductId,
        type SizeId,
} from "#/domain/shared/brand";
import type { AppConfig } from "#/infra/config/env";
import { Err } from "#/domain/shared/errors";
import { signedWalletAmount } from "#/domain/shared/wallet-sql";
import { finalPriceOf, loadPricingBases, sizeFinalPriceOf } from "#/domain/menu/menu.service";
import type { DeliveryZoneService } from "#/domain/delivery/delivery-zone.service";
import type { SettingsService } from "#/domain/settings/settings.service";
import type { CouponService } from "../coupon/coupon.service";
import type { NotificationService } from "../notification/notification.service";
import type {
        CheckoutInput,
        CheckoutPreviewData,
        OrderBreakdown,
        StaffInvoice,
} from "@sinshin/shared";
import { requireOrder, requireOwnedOrder, findOrder } from './order-lookup'


function newDisplayId(): string {
        const bytes = crypto.getRandomValues(new Uint8Array(8));
        let s = "";
        for (const b of bytes) s += b.toString(36).padStart(2, "0");
        return `ord-${s.slice(0, 8)}`;
}

/** شرط رزرو کوپن: نامحدود (۰) یا زیر سقف */
function underMaxUses(maxUses: number) {
        return maxUses === 0 ? sql`true` : sql`${coupons.usedCount} < ${maxUses}`;
}

// رارد ۴۷ — ورودی چک‌اوت (DeliveryType و کل شکل) از قرارداد مشترک
// می‌آید — شکل خام سیم بدون برند؛ اسکیمای روت، سرویس و فرانت حالا
// یک تعریف واحد دارند (کپی محلی حذف شد).

/** نتیجه داخلی سرویس — قرارداد پاسخ HTTP در بسته‌ی مشترک تعریف شده است */
export interface CheckoutServiceResult {
        displayId: string;
        requiresPayment: boolean;
        paymentId?: PaymentId;
        amountPaidOnline: number;
        breakdown: OrderBreakdown;
}

export class OrderService {
        constructor(
                private readonly deps: {
                        db: Db;
                        config: AppConfig;
                        zones: DeliveryZoneService;
                        settings: SettingsService;
                        coupons: CouponService;
                        /** فاز-۲ — پوش نوتیفیکیشن اعطای کوپن */
                        notifications: NotificationService;
                },
        ) {}

        /** موجودی کیف پول — SUM تراکنش‌ها (منبع حقیقت؛ عدد ذخیره‌شده وجود ندارد) */
        async walletBalance(db: DbOrTx, userId: string): Promise<number> {
                const rows = await db
                        .select({
                                // رارد C1 — ::bigint (بدون سقف)؛ Number() چون Bun.sql مقدار bigint
                                // را string برمی‌گرداند.
                                balance: sql<number>`coalesce(sum(${signedWalletAmount}), 0)::bigint`,
                        })
                        .from(walletTransactions)
                        .where(eq(walletTransactions.userId, userId));
                return Number(rows[0]?.balance ?? 0);
        }

        /**
         * چک‌اوت — کل محاسبه و ثبت در یک تراکنش:
         *  قیمت‌ها سروری (سایز/تخفیف/کوپن/ناحیه/بسته‌بندی)، رزرو کوپن اتمیک زیر قفل،
         *  کیف پول با قفلِ کاربر سریالی می‌شود.
         *  amountPaidOnline === 0 → تسویه فوری (تمام-کیف‌پول).
         */
        async checkout(
                userId: string,
                input: CheckoutInput,
        ): Promise<CheckoutServiceResult> {
                const { db } = this.deps;
                if (input.items.length === 0) throw Err.validation("سبد خرید خالی است.");

                // رارد M9 — نتیجه‌ی tx گرفته می‌شود تا اعطای کوپن بعد از commit اجرا شود
                const result = await db.transaction(async (tx) => {
                        // ── قفل کاربر — سریالی‌کردنِ برداشت‌های کیف پول ──
                        const [user] = await tx
                                .select()
                                .from(users)
                                .where(eq(users.id, userId))
                                .for("update");
                        if (!user) throw Err.unauthorized();
                        if (user.bannedAt) throw Err.banned();

                        // ── آدرس (DELIVERY اجباری — قرارداد فرانت) ──
                        let addressRow: typeof addresses.$inferSelect | undefined;
                        if (input.deliveryType === "DELIVERY") {
                                if (!input.addressId)
                                        throw Err.validation("لطفاً آدرس تحویل را انتخاب کنید.");
                                addressRow = (
                                        await tx
                                                .select()
                                                .from(addresses)
                                                .where(eq(addresses.id, asAddressId(input.addressId)))
                                )[0];
                                if (!addressRow || addressRow.userId !== userId) {
                                        throw Err.notFound("آدرس تحویل پیدا نشد.");
                                }
                        }

                        // ── قیمت آیتم‌ها — سروری، تصویر لحظه‌ای ──
                        // perf-fix (کار-۲): قبلاً به‌ازای هر آیتم تا ۲ کوئری (محصول + سایزها)
                        // داخل tx → سبد ۵ آیتمه = تا ۱۰ کوئری. الان: حداکثر ۲ کوئریِ دسته‌ای.
                        const itemRows: {
                                productId: ProductId;
                                sizeId: SizeId | null;
                                sizeName: string | null;
                                name: string;
                                unitPrice: number;
                                quantity: number;
                                packagingCost: number;
                        }[] = [];
                        let foodTotal = 0;
                        // stage-10: بسته‌بندیِ هر محصول — جمع (هزینه بسته‌بندی محصول × تعداد)
                        // فقط برای DELIVERY و PICKUP؛ DINE_IN (سرو در محل) بسته‌بندی ندارد.
                        let packagingTotal = 0;
                        const { productMap, sizesByProduct } = await loadPricingBases(
                                tx,
                                input.items,
                        );
                        for (const item of input.items) {
                                const product = productMap.get(asProductId(item.productId));
                                if (!product || product.status !== "ACTIVE") continue; // skip نامعتبر — قرارداد فرانت

                                let unitPrice = finalPriceOf(product);
                                let sizeId: SizeId | null = null;
                                let sizeName: string | null = null;
                                if (product.sizesEnabled) {
                                        const sizes = sizesByProduct.get(product.id) ?? [];
                                        if (sizes.length > 0) {
                                                // phase-2: تعویض بی‌صدای سایز ممنوع — اگر سایزِ سبد حذف/تغییر کرده،
                                                // مشتری باید خطا ببیند، نه اینکه بی‌سروصدا اولین سایز قیمت شود
                                                if (item.sizeId) {
                                                        const wanted = asSizeId(item.sizeId);
                                                        const size = sizes.find((s) => s.id === wanted);
                                                        if (!size) {
                                                                throw Err.validation(
                                                                        `سایز انتخابی «${product.name}» دیگر موجود نیست — سبد خرید را به‌روز کنید.`,
                                                                );
                                                        }
                                                        // stage-47 — قیمت مؤثر سایز (تخفیف مستقل/زمان‌دار)
                                                        unitPrice = sizeFinalPriceOf(size);
                                                        sizeId = size.id;
                                                        sizeName = size.name;
                                                } else {
                                                        const size = sizes[0]!;
                                                        unitPrice = sizeFinalPriceOf(size);
                                                        sizeId = size.id;
                                                        sizeName = size.name;
                                                }
                                        }
                                }
                                foodTotal += unitPrice * item.quantity;
                                packagingTotal += product.packagingCost * item.quantity;
                                itemRows.push({
                                        productId: product.id,
                                        sizeId,
                                        sizeName,
                                        name: product.name,
                                        unitPrice,
                                        quantity: item.quantity,
                                        packagingCost: product.packagingCost,
                                });
                        }
                        if (itemRows.length === 0)
                                throw Err.validation("هیچ آیتم معتبری در سبد نیست.");

                        // ── کوپن — اعتبار سروری + رزرو اتمیک زیر قفل ──
                        // phase-fix: باخت رقابت (ظرفیت/گرنت) = خطای صریح، نه سقوط بی‌صدای تخفیف.
                        // فرانت فقط وقتی ثبتِ نهایی می‌کند که پیش‌نمایشِ کوپن را «معتبر» دیده است؛
                        // پس در چک‌اوت، null بودن کوپن یعنی رقابت/تغییر لحظه‌ای — نه غلط تایپی.
                        let discount = 0;
                        let couponId: CampaignId | null = null;
                        if (input.couponCode) {
                                const coupon = await this.deps.coupons.findUsableCoupon(
                                        tx,
                                        userId,
                                        input.couponCode,
                                );
                                if (!coupon) {
                                        throw Err.conflict(
                                                "این کد تخفیف دیگر قابل استفاده نیست — سبد خرید را به‌روز کنید.",
                                        );
                                }
                                const [reserved] = await tx
                                        .update(coupons)
                                        .set({ usedCount: sql`${coupons.usedCount} + 1` })
                                        .where(and(eq(coupons.id, coupon.id), underMaxUses(coupon.maxUses)))
                                        .returning();
                                if (!reserved) {
                                        throw Err.conflict(
                                                "ظرفیت این کد تخفیف همین حالا تکمیل شد — دوباره تلاش کنید.",
                                        );
                                }
                                // phase-fix: کوپن خصوصی — رزرو گرنت همین‌جا (اتمیک با پول).
                                // قبلاً مصرف در تسویه بود و دو چک‌اوت موازی هر دو تخفیف می‌گرفتند.
                                if (!coupon.isPublic) {
                                        const grantTaken = await this.deps.coupons.reserveGrant(
                                                tx,
                                                coupon.id,
                                                userId,
                                        );
                                        if (!grantTaken) {
                                                throw Err.conflict(
                                                        "این کد تخفیف همین حالا استفاده شد — دوباره تلاش کنید.",
                                                );
                                        }
                                }
                                couponId = asCampaignId(coupon.id);
                                discount = Math.round((foodTotal * coupon.discountPercentage) / 100);
                        }

                        const payableFood = foodTotal - discount;
                        const balance = await this.walletBalance(tx, userId);
                        const walletDeduction = input.useWallet
                                ? Math.min(balance, payableFood)
                                : 0;

                        // ── هزینه ارسال/بسته‌بندی — ناحیه‌ای برای DELIVERY؛ بسته‌بندیِ هر محصول ──
                        // stage-10: بسته‌بندی دیگر تنظیم سراسری نیست — جمع هزینه بسته‌بندی
                        // خودِ محصولات است (ستون packaging_cost) و فقط در سرو در محل صفر می‌شود.
                        const deliveryFee =
                                input.deliveryType === "DELIVERY"
                                        ? await this.deps.zones.feeFor(
                                                        addressRow ? { lat: addressRow.lat, lng: addressRow.lng } : null,
                                                )
                                        : 0;
                        const packagingFee =
                                input.deliveryType === "DINE_IN" ? 0 : packagingTotal;

                        const totalAmount = payableFood + deliveryFee + packagingFee;
                        const amountPaidOnline =
                                payableFood - walletDeduction + deliveryFee + packagingFee;
                        const paymentMethod =
                                amountPaidOnline === 0
                                        ? "WALLET"
                                        : walletDeduction > 0
                                                ? "MIXED"
                                                : "GATEWAY";
                        const breakdown: OrderBreakdown = {
                                foodTotal,
                                discount,
                                walletDeduction,
                                deliveryFee,
                                packagingFee,
                                totalAmount,
                                amountPaidOnline,
                        };

                        // ── تصویر لحظه‌ایِ ردیابی — لحظه‌ی ثبت ──
                        const trackingEnabled = await this.deps.settings.liveTrackingEnabled();

                        // ── سفارش ──
                        // امن-۶: برخورد displayId با onConflictDoNothing حل می‌شود —
                        // قبلاً رد شدن قید یکتایی داخل tx، کل tx را لغو می‌کرد (25P02) و
                        // تلاش‌های بعدی حلقه همگی شکست می‌خوردند (تلاش مجددِ مرده). الان:
                        // ردیف خالی = همین تلاش برخورد خورد؛ تلاش بعدی با id تازه.
                        // خطای واقعی (قطعی DB و…) دیگر بلعیده نمی‌شود و همان‌جا می‌ترکد.
                        let orderRow: OrderRow | undefined;
                        for (let attempt = 0; attempt < 5 && !orderRow; attempt++) {
                                [orderRow] = await tx
                                        .insert(orders)
                                        .values({
                                                displayId: newDisplayId(),
                                                userId,
                                                status: "PENDING_PAYMENT",
                                                deliveryType: input.deliveryType,
                                                addressId: addressRow?.id ?? null,
                                                addressSnapshot: addressRow?.address ?? null,
                                                customerNote: input.customerNote?.slice(0, 300) ?? null,
                                                noteSeen: !(
                                                        input.customerNote && input.customerNote.trim().length > 0
                                                ),
                                                couponId,
                                                paymentStatus: "PENDING",
                                                paymentMethod,
                                                totalAmount,
                                                breakdown,
                                                trackingEnabled,
                                                customerLocation: addressRow
                                                        ? { lat: addressRow.lat, lng: addressRow.lng }
                                                        : null,
                                        })
                                        .onConflictDoNothing({ target: orders.displayId })
                                        .returning();
                        }
                        if (!orderRow)
                                throw Err.internal("ساخت سفارش ناموفق بود؛ دوباره تلاش کنید.");

                        await tx.insert(orderItems).values(
                                itemRows.map((it) => ({
                                        orderId: orderRow.id,
                                        productId: it.productId,
                                        sizeId: it.sizeId,
                                        name: it.name,
                                        sizeName: it.sizeName,
                                        unitPrice: it.unitPrice,
                                        quantity: it.quantity,
                                })),
                        );

                        // ── phase-2: رزرو (hold) کیف پول — در همان tx ──
                        // قبلاً برداشت در تسویه اتفاق می‌افتاد؛ در فاصله‌ی چک‌اوت تا تسویه،
                        // دو سفارش موازی همان موجودی را می‌دیدند (خرج دوباره‌ی کیف پول).
                        // حالا همین‌جا کم می‌شود و failPayment / کارِ تایم‌اوت آن را برمی‌گردانند.
                        if (walletDeduction > 0) {
                                await tx.insert(walletTransactions).values({
                                        userId,
                                        type: "WITHDRAW",
                                        amount: walletDeduction,
                                        description:
                                                amountPaidOnline === 0
                                                        ? `پرداخت سفارش ${orderRow.displayId}`
                                                        : `رزرو پرداخت سفارش ${orderRow.displayId}`,
                                        orderId: orderRow.id,
                                });
                        }

                        // ── تمام-کیف‌پول → تسویه فوری ──
                        if (amountPaidOnline === 0) {
                                await this.settlePayment(tx, orderRow);
                                return {
                                        displayId: orderRow.displayId,
                                        requiresPayment: false,
                                        amountPaidOnline: 0,
                                        breakdown,
                                };
                        }

                        // ── ردیف پرداخت — initiate بیرون tx (شبکه) ──
                        const gatewayId = (input.gatewayId ?? "MOCK").toUpperCase();
                        const paymentRow = (
                                await tx
                                        .insert(payments)
                                        .values({
                                                orderId: orderRow.id,
                                                userId,
                                                gateway: gatewayId,
                                                mode: gatewayId === "MOCK" ? "mock" : this.deps.config.gateway.mode,
                                                amount: amountPaidOnline,
                                                status: "PENDING",
                                        })
                                        .returning()
                        )[0];
                        if (!paymentRow) throw Err.internal("ساخت ردیف پرداخت ناموفق بود.");

                        return {
                                displayId: orderRow.displayId,
                                requiresPayment: true,
                                paymentId: paymentRow.id,
                                amountPaidOnline,
                                breakdown,
                        };
                });

                // رارد M9 — اعطای کوپنِ «بعد از commit»: بیرون از tx و بدون قفل کاربر.
                // خطا هرگز نباید چک‌اوتِ موفقِ قبلی را خراب کند — فقط لاگ.
                await this.grantCouponsAfterCommit(userId);
                return result;
        }

        /**
         * رارد M9 — گرنت کوپن‌های واجدشرط، بعد از commit و با tx خودش.
         * عمومی است چون payment.service و reconcile.service هم بعد از تسویه
         * صدا می‌زنند. امن: یکتایی با grants_coupon_user_key.
         */
        async grantCouponsAfterCommit(userId: string): Promise<void> {
                try {
                        const granted = await this.deps.coupons.grantIfEligibleAfterCommit(userId);
                        if (granted > 0) {
                                console.log(
                                        `[order] ${granted} coupon grant(s) for user ${userId} (post-commit)`,
                                );
                                // فاز-۲ — خبرِ کوپن با پوش نوتیفیکیشن (به‌جای پیامک).
                                // شلیک و رها + catch خودش: نوتیف هرگز تسویه را خراب نمی‌کند.
                                void this.notifyCouponGrant(userId, granted).catch(() => {});
                        }
                } catch (e) {
                        console.error(
                                `[order] post-commit coupon grant failed for user ${userId}:`,
                                e,
                        );
                }
        }

        /**
         * فاز-۲ — نوتیفیکیشن «کوپن گرفتی». جزئیات کوپن‌های تازه‌اعطا از
         * سرویس کوپن می‌آید (grantedRecently)؛ خطا فقط لاگ می‌شود.
         */
        private async notifyCouponGrant(userId: string, count: number): Promise<void> {
                try {
                        const granted = await this.deps.coupons.grantedRecently(userId, count);
                        const best = granted[0];
                        const title =
                                granted.length > 1
                                        ? `🎁 ${granted.length} کوپن تخفیف جدید گرفتی!`
                                        : '🎁 یک کوپن تخفیف جدید گرفتی!';
                        const body = best
                                ? `«${best.title ?? best.code}» با ٪${best.discountPercentage} تخفیف به حساب تو اضافه شد — سفارش بعدی‌ات ارزان‌تر می‌شود.`
                                : `کوپن تخفیف جدید به حساب شما اضافه شد.`;
                        await this.deps.notifications.notifyUser(userId, {
                                type: 'coupon',
                                title,
                                body,
                                url: '/checkout',
                                data: { coupons: granted.map((c) => ({ code: c.code, discount: c.discountPercentage })) },
                        });
                } catch (err) {
                        console.error(`[order] coupon-grant notification failed for ${userId}:`, err);
                }
        }

        /**
         * phase-2 — پیش‌نمایش چک‌اوت: همان قیمت‌گذاری سروری، بدون قفل/رزرو/ثبت.
         * مرگ SINSHIN20 و هزینه‌ی ارسال فلتِ فرانت — UI از این اعداد زنده نمایش می‌دهد.
         */
        async preview(
                userId: string,
                input: CheckoutInput,
        ): Promise<CheckoutPreviewData> {
                const { db } = this.deps;
                if (input.items.length === 0) throw Err.validation("سبد خرید خالی است.");

                // phase-3: آدرس در پیش‌نمایش «اختیاری» — UI قبل از انتخاب آدرس هم عدد
                // نشان می‌دهد (نرخ ناحیه‌ی بیرونی، مثل getCheckoutDetails فعلی).
                // اعتبارسنجی واقعی همان‌جا می‌ماند که بود: ثبتِ نهایی (چک‌اوت).
                let addressRow: typeof addresses.$inferSelect | undefined;
                if (input.deliveryType === "DELIVERY" && input.addressId) {
                        addressRow = (
                                await db
                                        .select()
                                        .from(addresses)
                                        .where(eq(addresses.id, asAddressId(input.addressId)))
                        )[0];
                        if (!addressRow || addressRow.userId !== userId) {
                                throw Err.notFound("آدرس تحویل پیدا نشد.");
                        }
                }

                // آیتم‌ها — همان منطق چک‌اوت (فقط‌خواندنی)
                // perf-fix (کار-۲): همان دسته‌ای — قبلاً N+1 (بدون قفل هم بود، فقط کوئری‌های زائد)
                const items: {
                        name: string;
                        sizeName: string | null;
                        unitPrice: number;
                        quantity: number;
                }[] = [];
                let foodTotal = 0;
                // stage-10: بسته‌بندیِ هر محصول — همان جمعِ چک‌اوت
                let packagingTotal = 0;
                const { productMap, sizesByProduct } = await loadPricingBases(
                        db,
                        input.items,
                );
                for (const item of input.items) {
                        const product = productMap.get(asProductId(item.productId));
                        if (!product || product.status !== "ACTIVE") continue;

                        let unitPrice = finalPriceOf(product);
                        let sizeName: string | null = null;
                        if (product.sizesEnabled) {
                                const sizes = sizesByProduct.get(product.id) ?? [];
                                if (sizes.length > 0) {
                                        if (item.sizeId) {
                                                const size = sizes.find((s) => s.id === item.sizeId);
                                                if (!size) {
                                                        throw Err.validation(
                                                                `سایز انتخابی «${product.name}» دیگر موجود نیست — سبد خرید را به‌روز کنید.`,
                                                        );
                                                }
                                                // stage-47 — قیمت مؤثر سایز (تخفیف مستقل/زمان‌دار)
                                                unitPrice = sizeFinalPriceOf(size);
                                                sizeName = size.name;
                                        } else {
                                                unitPrice = sizeFinalPriceOf(sizes[0]!);
                                                sizeName = sizes[0]!.name;
                                        }
                                }
                        }
                        foodTotal += unitPrice * item.quantity;
                        packagingTotal += product.packagingCost * item.quantity;
                        items.push({
                                name: product.name,
                                sizeName,
                                unitPrice,
                                quantity: item.quantity,
                        });
                }
                if (items.length === 0)
                        throw Err.validation("هیچ آیتم معتبری در سبد نیست.");

                // کوپن — فقط اعتبارسنجی؛ رزرو در چک‌اوت اتمیک می‌ماند
                let discount = 0;
                let coupon: {
                        code: string;
                        valid: boolean;
                        discount: number;
                        message?: string;
                } | null = null;
                if (input.couponCode) {
                        const found = await this.deps.coupons.findUsableCoupon(
                                db,
                                userId,
                                input.couponCode,
                        );
                        if (found && found.maxUses > 0 && found.usedCount >= found.maxUses) {
                                coupon = {
                                        code: found.code,
                                        valid: false,
                                        discount: 0,
                                        message: "ظرفیت این کد تخفیف تکمیل شده است.",
                                };
                        } else if (found) {
                                discount = Math.round((foodTotal * found.discountPercentage) / 100);
                                coupon = { code: found.code, valid: true, discount };
                        } else {
                                coupon = {
                                        code: input.couponCode.trim().toUpperCase().slice(0, 32),
                                        valid: false,
                                        discount: 0,
                                        message: "کد تخفیف نامعتبر است یا برای شما فعال نیست.",
                                };
                        }
                }

                const payableFood = foodTotal - discount;
                const balance = await this.walletBalance(db, userId);
                const walletDeduction = input.useWallet
                        ? Math.min(balance, payableFood)
                        : 0;

                const deliveryFee =
                        input.deliveryType === "DELIVERY"
                                ? await this.deps.zones.feeFor(
                                                addressRow ? { lat: addressRow.lat, lng: addressRow.lng } : null,
                                        )
                                : 0;
                // stage-10: بسته‌بندیِ هر محصول — فقط سرو در محل صفر
                const packagingFee = input.deliveryType === "DINE_IN" ? 0 : packagingTotal;

                const totalAmount = payableFood + deliveryFee + packagingFee;
                const amountPaidOnline =
                        payableFood - walletDeduction + deliveryFee + packagingFee;

                return {
                        breakdown: {
                                foodTotal,
                                discount,
                                walletDeduction,
                                deliveryFee,
                                packagingFee,
                                totalAmount,
                                amountPaidOnline,
                        },
                        items,
                        coupon,
                };
        }

        /**
         * تسویه موفق — همه در همین tx:
         *  PAID + برداشت کیف پول + سود معرف + DEPOSIT + redemption کوپن + queuedAt اگر بسته.
         * queuedAt فقط گزارشی است — هیچ سد تاییدی وجود ندارد (قرار فاز ۵).
         */
        async settlePayment(
                tx: DbOrTx,
                orderRow: OrderRow,
        ): Promise<{ displayId: string }> {
                const [user] = await tx
                        .select()
                        .from(users)
                        .where(eq(users.id, orderRow.userId))
                        .for("update");
                if (!user) throw Err.internal("کاربر سفارش پیدا نشد.");

                const b = orderRow.breakdown;

                const [updated] = await tx
                        .update(orders)
                        .set({ status: "PAID", paymentStatus: "SUCCESS", updatedAt: new Date() })
                        .where(
                                and(eq(orders.id, orderRow.id), eq(orders.status, "PENDING_PAYMENT")),
                        )
                        .returning();
                if (!updated) return { displayId: orderRow.displayId };

                // سود معرف — درصدش از کانفیگ (REFERRAL_PERCENT؛ پیش‌فرض ۱۰٪) فقط از
                // پرداخت آنلاینِ غذاها (بدون ارسال و بسته‌بندی)
                const referralBase = Math.max(
                        0,
                        b.amountPaidOnline - b.deliveryFee - b.packagingFee,
                );
                if (user.referredBy && referralBase > 0) {
                        const percent = this.deps.config.referralPercent;
                        const amount = Math.round((referralBase * percent) / 100);
                        if (amount > 0) {
                                const [profit] = await tx
                                        .insert(referralProfits)
                                        .values({
                                                referrerId: user.referredBy,
                                                buyerId: orderRow.userId,
                                                orderId: orderRow.id,
                                                baseAmount: referralBase,
                                                percent: this.deps.config.referralPercent,
                                                amount,
                                        })
                                        .onConflictDoNothing()
                                        .returning();
                                if (profit) {
                                        await tx.insert(walletTransactions).values({
                                                userId: user.referredBy,
                                                type: "DEPOSIT",
                                                amount,
                                                description: `سود معرفی سفارش ${orderRow.displayId}`,
                                                orderId: orderRow.id,
                                                referralProfitId: profit.id,
                                        });
                                }
                        }
                }

                // ── کوپن خصوصی: مصرف گرنت + ثبت redemption (عمومی هم redemption دارد) ──
                // phase-fix: اگر کوپن وسط پرواز حذف/غیب شده، فقط رد را می‌گذریم —
                // درج redemption با FK نمی‌شکند و پولِ گرفته‌شده گیر نمی‌کند.
                if (orderRow.couponId) {
                        const coupon = (
                                await tx.select().from(coupons).where(eq(coupons.id, orderRow.couponId))
                        )[0];
                        if (coupon) {
                                if (!coupon.isPublic) {
                                        // سفارش‌های قدیمی‌تر از phase-fix این‌جا مصرف می‌شوند؛
                                        // سفارش‌های جدید از قبل در چک‌اوت رزرو شده‌اند (بی‌اثر).
                                        await this.deps.coupons.consumeGrant(
                                                tx,
                                                orderRow.couponId,
                                                orderRow.userId,
                                        );
                                }
                                await tx
                                        .insert(couponRedemptions)
                                        .values({
                                                couponId: orderRow.couponId,
                                                userId: orderRow.userId,
                                                orderId: orderRow.id,
                                        })
                                        .onConflictDoNothing();
                        } else {
                                console.warn(
                                        `[order] ${orderRow.displayId}: coupon ${orderRow.couponId} gone at settle — skipping redemption`,
                                );
                        }
                }

                // رارد M9 — اعطای کوپن از داخل tx تسویه (زیر قفل FOR UPDATE کاربر) به
                // بعد از commit منتقل شد: ۲ کوئری به‌ازای هر کوپنِ فعالِ شرطدار دیگر
                // قفل پول را نگه نمی‌دارد. یکتایی گرنت با unique index
                // grants_coupon_user_key + onConflictDoNothing تضمین می‌شود.
                // فراخوانی بعد از commit: order.routes / payment.service / reconcile.

                // گزارشی: «در زمان بسته (هر نوع) ثبت شد» — بدون سد؛ ادمین۲ می‌تواند بلافاصله تایید کند
                const status = await this.deps.settings.restaurantStatus();
                if (status.anyClosed) {
                        await tx
                                .update(orders)
                                .set({ queuedAt: new Date() })
                                .where(eq(orders.id, orderRow.id));
                }

                return { displayId: orderRow.displayId };
        }

        /** پرداخت ناموفق — سفارش ثبت می‌ماند (قرارداد فرانت) + آزادسازی رزرو کوپن */
        async failPayment(tx: DbOrTx, orderRow: OrderRow): Promise<void> {
                // phase-fix: مثل settlePayment گارد گذاشتیم — اگر این سفارش قبلاً
                // نهایی شده، برگشت وجه/کوپن دوباره اجرا نمی‌شود (ضدِ بازگشت دوبل).
                const [updated] = await tx
                        .update(orders)
                        .set({
                                status: "CANCELED",
                                paymentStatus: "FAILED",
                                updatedAt: new Date(),
                        })
                        .where(
                                and(eq(orders.id, orderRow.id), eq(orders.status, "PENDING_PAYMENT")),
                        )
                        .returning();
                if (!updated) return;

                // phase-2: پس‌گرفتن رزرو کیف پول — دفترِ فقط-افزودنی → ردیف جبرانی
                if (orderRow.breakdown.walletDeduction > 0) {
                        await tx.insert(walletTransactions).values({
                                userId: orderRow.userId,
                                type: "DEPOSIT",
                                amount: orderRow.breakdown.walletDeduction,
                                description: `بازگشت کیف پول سفارش لغوشده ${orderRow.displayId}`,
                                orderId: orderRow.id,
                        });
                }

                if (orderRow.couponId) {
                        await tx
                                .update(coupons)
                                .set({ usedCount: sql`greatest(${coupons.usedCount} - 1, 0)` })
                                .where(eq(coupons.id, orderRow.couponId));
                        // phase-fix: گرنت رزروشده در چک‌اوت آزاد می‌شود
                        await this.deps.coupons.releaseGrant(
                                tx,
                                orderRow.couponId,
                                orderRow.userId,
                        );
                }
        }

        /**
         * phase-2 — بازپرداخت (فقط ادمین اصلی): سفارشِ پرداخت‌شده → CANCELED +
         * بازگشت «کل» مبلغ به کیف پول مشتری (wallet + online = بی‌ضرر کامل) +
         * فسخ سود معرف + آزادسازی کوپن. پولِ درگاهی جداگانه با PSP تسویه
         * می‌شود (API زرین‌پال — فاز بعدی/دستی).
         */
        async refund(
                displayId: string,
                reason: string,
        ): Promise<{ displayId: string; refundedAmount: number }> {
                return this.deps.db.transaction(async (tx) => {
                        // رارد ۴۸ — گارد الگو و واکشی از order-lookup مشترک (با قفل سطر)
                        const row = await findOrder(tx, displayId, { forUpdate: true });
                        if (!row) throw Err.notFound("سفارش پیدا نشد.");
                        if (row.status === "CANCELED")
                                throw Err.conflict("این سفارش قبلاً لغو شده است.");
                        if (row.paymentStatus !== "SUCCESS") {
                                throw Err.conflict("فقط سفارش‌های پرداخت‌شده قابل بازگشت وجه هستند.");
                        }

                        await tx
                                .update(orders)
                                .set({
                                        status: "CANCELED",
                                        paymentStatus: "REFUNDED",
                                        internalNote: reason,
                                        updatedAt: new Date(),
                                })
                                .where(eq(orders.id, row.id));

                        // ۱) بازگشت کل مبلغ به کیف پول مشتری — onConflictDoNothing = تکرارناپذر
                        const refundedAmount = row.breakdown.totalAmount;
                        if (refundedAmount > 0) {
                                await tx
                                        .insert(walletTransactions)
                                        .values({
                                                userId: row.userId,
                                                type: "DEPOSIT",
                                                amount: refundedAmount,
                                                description: `بازگشت وجه سفارش ${row.displayId}`,
                                                orderId: row.id,
                                        })
                                        .onConflictDoNothing();
                        }

                        // ۲) فسخ سود معرف — ردیف profit می‌ماند (FK سالم)، ردیف معکوس می‌نشیند
                        // phase-fix: orderId عمداً null است — ایندکس یونیک رزرو (WITHDRAW+
                        // orderId) نباید فسخِ سود را قالب کند؛ تکرارناپذیری با ایندکس یونیک
                        // جدید روی referralProfitId تضمین می‌شود.
                        const profits = await tx
                                .select()
                                .from(referralProfits)
                                .where(eq(referralProfits.orderId, row.id));
                        for (const p of profits) {
                                await tx
                                        .insert(walletTransactions)
                                        .values({
                                                userId: p.referrerId,
                                                type: "WITHDRAW",
                                                amount: p.amount,
                                                description: `فسخ سود معرفی سفارش ${row.displayId}`,
                                                orderId: null,
                                                referralProfitId: p.id,
                                        })
                                        .onConflictDoNothing();
                        }

                        // ۳) آزادسازی کوپن — رزرو + redemption + گرنت
                        if (row.couponId) {
                                await tx
                                        .update(coupons)
                                        .set({ usedCount: sql`greatest(${coupons.usedCount} - 1, 0)` })
                                        .where(eq(coupons.id, row.couponId));
                                await tx
                                        .delete(couponRedemptions)
                                        .where(
                                                and(
                                                        eq(couponRedemptions.couponId, row.couponId),
                                                        eq(couponRedemptions.orderId, row.id),
                                                ),
                                        );
                                const coupon = (
                                        await tx.select().from(coupons).where(eq(coupons.id, row.couponId))
                                )[0];
                                if (coupon && !coupon.isPublic) {
                                        await tx
                                                .update(couponGrants)
                                                .set({ consumedAt: null })
                                                .where(
                                                        and(
                                                                eq(couponGrants.couponId, row.couponId),
                                                                eq(couponGrants.userId, row.userId),
                                                        ),
                                                );
                                }
                        }

                        return { displayId: row.displayId, refundedAmount };
                });
        }

        // ── خواندن ──

        async myOrders(userId: string) {
                // round-16 — سقف دفاعی: داشبورد مشتری پشت این اندپوینت است؛
                // مشتری وفادار با صدها سفارش نباید پاسخ چندمگابایتی + تکثیرِ آیتم‌ها بسازد.
                // ۲۰۰ سفارش آخر + همهٔ سفارش‌های فعال (همان منطق ادغامِ پروفایل سبک).
                const [recent, active] = await Promise.all([
                        this.deps.db
                                .select()
                                .from(orders)
                                .where(eq(orders.userId, userId))
                                .orderBy(desc(orders.createdAt))
                                .limit(200),
                        this.deps.db
                                .select()
                                .from(orders)
                                .where(
                                        and(
                                                eq(orders.userId, userId),
                                                inArray(orders.status, ["PAID", "CONFIRMED", "ON_THE_WAY"]),
                                        ),
                                ),
                ]);
                const seen = new Set(recent.map((r) => r.id));
                const merged = [...recent];
                for (const r of active) {
                        if (!seen.has(r.id)) merged.push(r);
                }
                return this.mapRows(merged);
        }

        /**
         * perf-fix (کار-۶): سفارش‌های پروفایلِ سبک — ۱۰ سفارش آخر + همه‌ی سفارش‌های
         * فعال (PAID/CONFIRMED/ON_THE_WAY) حتی اگر قدیمی‌تر از ۱۰تای آخر باشند.
         * مصرف‌کننده: هدر/لایوت داشبورد/چک‌اوت — فقط برای تشخیص «سفارش فعال» و
         * recentOrders؛ ادغام تضمین می‌کند سفارش فعالِ گیرکرده (مثلاً ۱۰ سفارش
         * جدید بعد از آن) از دید useActiveOrder گم نشود.
         */
        async myOrdersLight(userId: string) {
                const [recent, active] = await Promise.all([
                        this.deps.db
                                .select()
                                .from(orders)
                                .where(eq(orders.userId, userId))
                                .orderBy(desc(orders.createdAt))
                                .limit(10),
                        this.deps.db
                                .select()
                                .from(orders)
                                .where(
                                        and(
                                                eq(orders.userId, userId),
                                                inArray(orders.status, ["PAID", "CONFIRMED", "ON_THE_WAY"]),
                                        ),
                                ),
                ]);
                const seen = new Set(recent.map((r) => r.id));
                const merged = [...recent];
                for (const r of active) {
                        if (!seen.has(r.id)) merged.push(r);
                }
                return this.mapRows(merged);
        }

        async byDisplayId(userId: string, displayId: string) {
                const row = await requireOwnedOrder(this.deps.db, userId, displayId);
                // round-16 — سه کوئری مستقل → Promise.all (همان نتیجه، یک رفت‌وبرگشت)
                const [items, profit, courier] = await Promise.all([
                        this.deps.db
                                .select()
                                .from(orderItems)
                                .where(eq(orderItems.orderId, row.id)),
                        this.deps.db
                                .select({ amount: referralProfits.amount })
                                .from(referralProfits)
                                .where(eq(referralProfits.orderId, row.id))
                                .then((r) => r[0]?.amount ?? 0),
                        this.courierOf(row.courierId),
                ]);
                return this.mapOne(row, items, profit, courier);
        }

        /**
         * round-12 — دیتای فاکتور برای چاپ توسط پنل (ادمین اصلی/سطح ۲).
         * بدون چک مالکیت (مسیر مشتری byDisplayId گاردش را دارد)؛ شامل مشخصات
         * مشتری/نوع تحویل/آدرس/پیک برای فاکتور اشپزخانه + فروش (با QR پیک).
         */
        async invoiceForStaff(displayId: string): Promise<StaffInvoice> {
                const row = await requireOrder(this.deps.db, displayId);

                const [items, user, courier] = await Promise.all([
                        this.deps.db
                                .select()
                                .from(orderItems)
                                .where(eq(orderItems.orderId, row.id)),
                        row.userId
                                ? this.deps.db.select().from(users).where(eq(users.id, row.userId))
                                : Promise.resolve([]),
                        this.courierOf(row.courierId),
                ]);

                return {
                        orderId: row.displayId,
                        date: row.createdAt,
                        status: row.status,
                        userName: user[0]?.name ?? null,
                        userPhone: user[0]?.phone ?? null,
                        deliveryType: row.deliveryType,
                        address: row.addressSnapshot,
                        customerNote: row.customerNote,
                        courierId: row.courierId,
                        courierName: courier?.name ?? null,
                        courierPhone: courier?.phone ?? null,
                        courierSecurityEnabled: row.courierSecurityEnabled,
                        // round-14 — یادداشت ادمین + پرچم چاپ در فاکتور فروش (بیرون‌بر)
                        internalNote: row.internalNote,
                        internalNotePrint: row.internalNotePrint,
                        items: items.map((i) => ({
                                name: i.name,
                                sizeName: i.sizeName,
                                quantity: i.quantity,
                                price: i.unitPrice,
                        })),
                        breakdown: row.breakdown,
                };
        }

        /** تایید تحویل توسط مشتری — قرارداد فرانت */
        async confirmDelivery(userId: string, displayId: string): Promise<void> {
                const row = await requireOwnedOrder(this.deps.db, userId, displayId);
                // امن-۷: فقط بعد از تایید رستوران — PAID یعنی سفارش هنوز وارد جریان
                // آشپزخانه/پیک نشده؛ بستنش توسط مشتری زودهنگام بود و جریان را می‌شکست
                if (row.status !== "CONFIRMED" && row.status !== "ON_THE_WAY") {
                        throw Err.conflict("این سفارش هنوز تایید نشده و قابل تایید تحویل نیست.");
                }
                // گارد دومی روی خود UPDATE — چک-و-آپدیت اتمیک نیست
                const [updated] = await this.deps.db
                        .update(orders)
                        .set({
                                status: "DELIVERED",
                                deliveredAt: new Date(),
                                updatedAt: new Date(),
                        })
                        .where(
                                and(
                                        eq(orders.id, row.id),
                                        inArray(orders.status, ["CONFIRMED", "ON_THE_WAY"]),
                                ),
                        )
                        .returning();
                if (!updated) throw Err.conflict("این سفارش قابل تایید تحویل نیست.");
        }

        /** پرچم ردیابی — تصویر لحظه‌ایِ ثبت سفارش، نه وضعیت فعلی تنظیمات */
        async tracking(
                userId: string,
                displayId: string,
        ): Promise<{ isEnabled: boolean }> {
                const row = await requireOwnedOrder(this.deps.db, userId, displayId);
                return { isEnabled: row.trackingEnabled };
        }

        // ── داخلی ──

        // round-28 — loadPricingBases به menu.service منتقل شد (صادرشده؛
        // مشترک بین چک‌اوت/پیش‌نمایش و سبد خرید — DRY). سیاست انتخاب سایز
        // همین‌جا مانده چون چک‌اوت سخت‌گیر است (سایز حذف‌شده = خطا).
        private async mapRows(rows: OrderRow[]) {
                if (rows.length === 0) return [];
                const ids = rows.map((r) => r.id);

                // round-12 — نام/تلفن پیک واقعی (قبلاً همیشه null بود؛ کامنت «فاز ۵» دیگر
                // درست نبود — سرویس live فقط نمای ادمین را پر می‌کند، نه مسیر کاربر)
                const courierIds = [
                        ...new Set(
                                rows.map((r) => r.courierId).filter((c): c is CourierId => !!c),
                        ),
                ];

                // رارد ۴۸ (اسکن C7) — سه کوئریِ مستقل موازی شدند؛ همان الگویی که
                // round-16 برای byDisplayId رفت (مصرف‌کننده: پروفایل سبک در هدر/چک‌اوت)
                const [items, profits, courierRows] = await Promise.all([
                        this.deps.db
                                .select()
                                .from(orderItems)
                                .where(inArray(orderItems.orderId, ids)),
                        this.deps.db
                                .select({
                                        orderId: referralProfits.orderId,
                                        amount: referralProfits.amount,
                                })
                                .from(referralProfits)
                                .where(inArray(referralProfits.orderId, ids)),
                        courierIds.length
                                ? this.deps.db
                                                .select({
                                                        id: couriers.id,
                                                        name: couriers.name,
                                                        phone: couriers.phone,
                                                })
                                                .from(couriers)
                                                .where(inArray(couriers.id, courierIds))
                                : Promise.resolve([]),
                ]);
                const itemsByOrder = new Map<OrderId, OrderItemRow[]>();
                for (const it of items) {
                        const list = itemsByOrder.get(it.orderId) ?? [];
                        list.push(it);
                        itemsByOrder.set(it.orderId, list);
                }
                const profitByOrder = new Map(profits.map((p) => [p.orderId, p.amount]));
                const courierById = new Map(courierRows.map((c) => [c.id, c]));

                return rows.map((r) =>
                        this.mapOne(
                                r,
                                itemsByOrder.get(r.id) ?? [],
                                profitByOrder.get(r.id) ?? 0,
                                r.courierId ? courierById.get(r.courierId) : undefined,
                        ),
                );
        }

        /** ردیف پیک — null-courierId → undefined (بدون کوئری) */
        private async courierOf(
                courierId: CourierId | null,
        ): Promise<{ name: string; phone: string } | undefined> {
                if (!courierId) return undefined;
                const row = (
                        await this.deps.db
                                .select({ name: couriers.name, phone: couriers.phone })
                                .from(couriers)
                                .where(eq(couriers.id, courierId))
                )[0];
                return row;
        }

        private mapOne(
                row: OrderRow,
                items: OrderItemRow[],
                referralProfit: number,
                courier?: { name: string; phone: string },
        ) {
                return {
                        id: row.displayId,
                        date: row.createdAt,
                        totalAmount: row.breakdown.totalAmount,
                        itemCount: items.reduce((s, i) => s + i.quantity, 0),
                        address: row.addressSnapshot,
                        courierName: courier?.name ?? null,
                        courierPhone: courier?.phone ?? null,
                        status: row.status,
                        deliveryType: row.deliveryType,
                        items: items.map((i) => ({
                                productId: i.productId,
                                sizeId: i.sizeId,
                                sizeName: i.sizeName,
                                name: i.name,
                                quantity: i.quantity,
                                price: i.unitPrice,
                        })),
                        courierLocation: row.courierLocation,
                        customerLocation: row.customerLocation,
                        referralProfit,
                        userFeedback: null, // فاز ۵ (نظرات)
                        customerNote: row.customerNote,
                        paymentStatus: row.paymentStatus,
                        breakdown: row.breakdown,
                        queued: row.queuedAt !== null,
                };
        }
}