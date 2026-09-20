//src/domain/order/order.service.ts
import { and, desc, eq, inArray, sql } from 'drizzle-orm'

import type { Db, DbOrTx } from '#/infra/db/client'
import {
  addresses,
  couponRedemptions,
  couponGrants,
  coupons,
  orderItems,
  orders,
  payments,
  productSizes,
  products,
  referralProfits,
  users,
  walletTransactions,
  type OrderItemRow,
  type OrderRow,
} from '#/infra/db/schema'
import {
  asAddressId,
  asCampaignId,
  asProductId,
  asSizeId,
  type CampaignId,
  type OrderId,
  type PaymentId,
  type ProductId,
  type SizeId,
} from '#/domain/shared/brand'
import type { AppConfig } from '#/infra/config/env'
import { Err } from '#/domain/shared/errors'
import { finalPriceOf } from '#/domain/menu/menu.service'
import type { DeliveryZoneService } from '#/domain/delivery/delivery-zone.service'
import type { SettingsService } from '#/domain/settings/settings.service'
import type { OrderBreakdown } from '#/infra/db/schema'
import type { CouponService } from '../coupon/coupon.service'

const REFERRAL_PERCENT = 10
const DISPLAY_RE = /^ord-[a-z0-9]{8}$/

function newDisplayId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  let s = ''
  for (const b of bytes) s += b.toString(36).padStart(2, '0')
  return `ord-${s.slice(0, 8)}`
}

/** شرط رزرو کوپن: نامحدود (۰) یا زیر سقف */
function underMaxUses(maxUses: number) {
  return maxUses === 0 ? sql`true` : sql`${coupons.usedCount} < ${maxUses}`
}

export type DeliveryType = 'DELIVERY' | 'PICKUP' | 'DINE_IN'

/** ورودی چک‌اوت — id ها خامِ HTTP؛ cast فقط داخل سرویس */
export interface CheckoutInput {
  items: { productId: string; sizeId?: string | null; quantity: number }[]
  deliveryType: DeliveryType
  useWallet: boolean
  addressId?: string | null
  customerNote?: string | null
  couponCode?: string | null
  gatewayId?: string | null
}

export interface CheckoutResult {
  displayId: string
  requiresPayment: boolean
  paymentId?: PaymentId
  amountPaidOnline: number
  breakdown: OrderBreakdown
}

export class OrderService {
  constructor(
    private readonly deps: {
      db: Db
      config: AppConfig
      zones: DeliveryZoneService
      settings: SettingsService
      coupons: CouponService
    },
  ) { }

  /** موجودی کیف پول — SUM تراکنش‌ها (منبع حقیقت؛ عدد ذخیره‌شده وجود ندارد) */
  async walletBalance(db: DbOrTx, userId: string): Promise<number> {
    const rows = await db
      .select({
        balance: sql<number>`coalesce(sum(case when ${walletTransactions.type} = 'DEPOSIT' then ${walletTransactions.amount} else -${walletTransactions.amount} end), 0)::int`,
      })
      .from(walletTransactions)
      .where(eq(walletTransactions.userId, userId))
    return rows[0]?.balance ?? 0
  }

  /**
   * چک‌اوت — کل محاسبه و ثبت در یک تراکنش:
   *  قیمت‌ها سروری (سایز/تخفیف/کوپن/ناحیه/بسته‌بندی)، رزرو کوپن اتمیک زیر قفل،
   *  کیف پول با قفلِ کاربر serialize می‌شود.
   *  amountPaidOnline === 0 → settle فوری (تمام-کیف‌پول).
   */
  async checkout(userId: string, input: CheckoutInput): Promise<CheckoutResult> {
    const { db } = this.deps
    if (input.items.length === 0) throw Err.validation('سبد خرید خالی است.')

    return db.transaction(async (tx) => {
      // ── قفل کاربر — serialize برداشت‌های کیف پول ──
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update')
      if (!user) throw Err.unauthorized()
      if (user.bannedAt) throw Err.banned()

      // ── آدرس (DELIVERY اجباری — قرارداد فرانت) ──
      let addressRow: typeof addresses.$inferSelect | undefined
      if (input.deliveryType === 'DELIVERY') {
        if (!input.addressId) throw Err.validation('لطفاً آدرس تحویل را انتخاب کنید.')
        addressRow = (
          await tx
            .select()
            .from(addresses)
            .where(eq(addresses.id, asAddressId(input.addressId)))
        )[0]
        if (!addressRow || addressRow.userId !== userId) {
          throw Err.notFound('آدرس تحویل پیدا نشد.')
        }
      }

      // ── قیمت آیتم‌ها — سروری، snapshot ──
      const itemRows: {
        productId: ProductId
        sizeId: SizeId | null
        sizeName: string | null
        name: string
        unitPrice: number
        quantity: number
      }[] = []
      let foodTotal = 0
      for (const item of input.items) {
        const product = (
          await tx
            .select()
            .from(products)
            .where(eq(products.id, asProductId(item.productId)))
        )[0]
        if (!product || product.status !== 'ACTIVE') continue // skip نامعتبر — قرارداد فرانت

        let unitPrice = finalPriceOf(product)
        let sizeId: SizeId | null = null
        let sizeName: string | null = null
        if (product.sizesEnabled) {
          const sizes = await tx
            .select()
            .from(productSizes)
            .where(eq(productSizes.productId, product.id))
            .orderBy(productSizes.sortOrder)
          if (sizes.length > 0) {
            // phase-2: تعویض بی‌صدای سایز ممنوع — اگر سایزِ سبد حذف/تغییر کرده،
            // مشتری باید خطا ببیند، نه اینکه بی‌سروصدا اولین سایز قیمت شود
            if (item.sizeId) {
              const wanted = asSizeId(item.sizeId)
              const size = sizes.find((s) => s.id === wanted)
              if (!size) {
                throw Err.validation(
                  `سایز انتخابی «${product.name}» دیگر موجود نیست — سبد خرید را به‌روز کنید.`,
                )
              }
              unitPrice = size.price
              sizeId = size.id
              sizeName = size.name
            } else {
              const size = sizes[0]!
              unitPrice = size.price
              sizeId = size.id
              sizeName = size.name
            }
          }
        }
        foodTotal += unitPrice * item.quantity
        itemRows.push({
          productId: product.id,
          sizeId,
          sizeName,
          name: product.name,
          unitPrice,
          quantity: item.quantity,
        })
      }
      if (itemRows.length === 0) throw Err.validation('هیچ آیتم معتبری در سبد نیست.')

      // ── کوپن — اعتبار سروری + رزرو اتمیک زیر قفل ──
      let discount = 0
      let couponId: CampaignId | null = null
      if (input.couponCode) {
        const coupon = await this.deps.coupons.findUsableCoupon(tx, userId, input.couponCode)
        if (coupon) {
          const [reserved] = await tx
            .update(coupons)
            .set({ usedCount: sql`${coupons.usedCount} + 1` })
            .where(and(eq(coupons.id, coupon.id), underMaxUses(coupon.maxUses)))
            .returning()
          if (reserved) {
            couponId = asCampaignId(coupon.id)
            discount = Math.round((foodTotal * coupon.discountPercentage) / 100)
          }
        }
      }

      const payableFood = foodTotal - discount
      const balance = await this.walletBalance(tx, userId)
      const walletDeduction = input.useWallet ? Math.min(balance, payableFood) : 0

      // ── هزینه ارسال/بسته‌بندی — ناحیه‌ای برای DELIVERY، ثابت برای PICKUP ──
      const deliveryFee =
        input.deliveryType === 'DELIVERY'
          ? await this.deps.zones.feeFor(
            addressRow ? { lat: addressRow.lat, lng: addressRow.lng } : null,
          )
          : 0
      const packagingFee =
        input.deliveryType === 'PICKUP' ? await this.deps.settings.packagingFee() : 0

      const totalAmount = payableFood + deliveryFee + packagingFee
      const amountPaidOnline = payableFood - walletDeduction + deliveryFee + packagingFee
      const paymentMethod =
        amountPaidOnline === 0 ? 'WALLET' : walletDeduction > 0 ? 'MIXED' : 'GATEWAY'
      const breakdown: OrderBreakdown = {
        foodTotal,
        discount,
        walletDeduction,
        deliveryFee,
        packagingFee,
        totalAmount,
        amountPaidOnline,
      }

      // ── snapshot ردیابی — لحظه‌ی ثبت ──
      const trackingEnabled = await this.deps.settings.liveTrackingEnabled()

      // ── سفارش ──
      let orderRow: OrderRow | undefined
      for (let attempt = 0; attempt < 5 && !orderRow; attempt++) {
        try {
          ;[orderRow] = await tx
            .insert(orders)
            .values({
              displayId: newDisplayId(),
              userId,
              status: 'PENDING_PAYMENT',
              deliveryType: input.deliveryType,
              addressId: addressRow?.id ?? null,
              addressSnapshot: addressRow?.address ?? null,
              customerNote: input.customerNote?.slice(0, 300) ?? null,
              noteSeen: !(input.customerNote && input.customerNote.trim().length > 0),
              couponId,
              paymentStatus: 'PENDING',
              paymentMethod,
              totalAmount,
              breakdown,
              trackingEnabled,
              customerLocation: addressRow
                ? { lat: addressRow.lat, lng: addressRow.lng }
                : null,
            })
            .returning()
        } catch (e) {
          if (attempt === 4) {
            console.error('[order] displayId collision loop exhausted:', e)
            throw Err.internal('ساخت سفارش ناموفق بود؛ دوباره تلاش کنید.')
          }
        }
      }
      if (!orderRow) throw Err.internal('ساخت سفارش ناموفق بود.')

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
      )

      // ── phase-2: رزرو (hold) کیف پول — در همان tx ──
      // قبلاً برداشت در settle اتفاق می‌افتاد؛ در فاصله‌ی چک‌اوت تا settle،
      // دو سفارش موازی همان موجودی را می‌دیدند (خرج دوباره‌ی کیف پول).
      // حالا همین‌جا کم می‌شود و failPayment / job تایم‌اوت آن را برمی‌گردانند.
      if (walletDeduction > 0) {
        await tx.insert(walletTransactions).values({
          userId,
          type: 'WITHDRAW',
          amount: walletDeduction,
          description:
            amountPaidOnline === 0
              ? `پرداخت سفارش ${orderRow.displayId}`
              : `رزرو پرداخت سفارش ${orderRow.displayId}`,
          orderId: orderRow.id,
        })
      }

      // ── تمام-کیف‌پول → settle فوری ──
      if (amountPaidOnline === 0) {
        await this.settlePayment(tx, orderRow)
        return {
          displayId: orderRow.displayId,
          requiresPayment: false,
          amountPaidOnline: 0,
          breakdown,
        }
      }

      // ── ردیف پرداخت — initiate بیرون tx (شبکه) ──
      const gatewayId = (input.gatewayId ?? 'MOCK').toUpperCase()
      const paymentRow = (
        await tx
          .insert(payments)
          .values({
            orderId: orderRow.id,
            userId,
            gateway: gatewayId,
            mode: gatewayId === 'MOCK' ? 'mock' : this.deps.config.gateway.mode,
            amount: amountPaidOnline,
            status: 'PENDING',
          })
          .returning()
      )[0]
      if (!paymentRow) throw Err.internal('ساخت ردیف پرداخت ناموفق بود.')

      return {
        displayId: orderRow.displayId,
        requiresPayment: true,
        paymentId: paymentRow.id,
        amountPaidOnline,
        breakdown,
      }
    })
  }


  /**
 * phase-2 — پیش‌نمایش چک‌اوت: همان قیمت‌گذاری سروری، بدون قفل/رزرو/ثبت.
 * مرگ SINSHIN20 و هزینه‌ی ارسال فلتِ فرانت — UI از این اعداد زنده نمایش می‌دهد.
 */
  async preview(userId: string, input: CheckoutInput): Promise<{
    breakdown: OrderBreakdown
    items: { name: string; sizeName: string | null; unitPrice: number; quantity: number }[]
    coupon: { code: string; valid: boolean; discount: number; message?: string } | null
  }> {
    const { db } = this.deps
    if (input.items.length === 0) throw Err.validation('سبد خرید خالی است.')

    // phase-3: آدرس در پیش‌نمایش «اختیاری» — UI قبل از انتخاب آدرس هم عدد
    // نشان می‌دهد (نرخ ناحیه‌ی بیرونی، مثل getCheckoutDetails فعلی).
    // اعتبارسنجی واقعی همان‌جا می‌ماند که بود: submit (checkout).
    let addressRow: typeof addresses.$inferSelect | undefined
    if (input.deliveryType === 'DELIVERY' && input.addressId) {
      addressRow = (
        await db.select().from(addresses).where(eq(addresses.id, asAddressId(input.addressId)))
      )[0]
      if (!addressRow || addressRow.userId !== userId) {
        throw Err.notFound('آدرس تحویل پیدا نشد.')
      }
    }

    // آیتم‌ها — همان منطق checkout (read-only)
    const items: { name: string; sizeName: string | null; unitPrice: number; quantity: number }[] = []
    let foodTotal = 0
    for (const item of input.items) {
      const product = (
        await db.select().from(products).where(eq(products.id, asProductId(item.productId)))
      )[0]
      if (!product || product.status !== 'ACTIVE') continue

      let unitPrice = finalPriceOf(product)
      let sizeName: string | null = null
      if (product.sizesEnabled) {
        const sizes = await db
          .select()
          .from(productSizes)
          .where(eq(productSizes.productId, product.id))
          .orderBy(productSizes.sortOrder)
        if (sizes.length > 0) {
          if (item.sizeId) {
            const size = sizes.find((s) => s.id === item.sizeId)
            if (!size) {
              throw Err.validation(
                `سایز انتخابی «${product.name}» دیگر موجود نیست — سبد خرید را به‌روز کنید.`,
              )
            }
            unitPrice = size.price
            sizeName = size.name
          } else {
            unitPrice = sizes[0]!.price
            sizeName = sizes[0]!.name
          }
        }
      }
      foodTotal += unitPrice * item.quantity
      items.push({ name: product.name, sizeName, unitPrice, quantity: item.quantity })
    }
    if (items.length === 0) throw Err.validation('هیچ آیتم معتبری در سبد نیست.')

    // کوپن — فقط اعتبارسنجی؛ رزرو در checkout اتمیک می‌ماند
    let discount = 0
    let coupon: { code: string; valid: boolean; discount: number; message?: string } | null = null
    if (input.couponCode) {
      const found = await this.deps.coupons.findUsableCoupon(db, userId, input.couponCode)
      if (found && found.maxUses > 0 && found.usedCount >= found.maxUses) {
        coupon = { code: found.code, valid: false, discount: 0, message: 'ظرفیت این کد تخفیف تکمیل شده است.' }
      } else if (found) {
        discount = Math.round((foodTotal * found.discountPercentage) / 100)
        coupon = { code: found.code, valid: true, discount }
      } else {
        coupon = {
          code: input.couponCode.trim().toUpperCase().slice(0, 32),
          valid: false,
          discount: 0,
          message: 'کد تخفیف نامعتبر است یا برای شما فعال نیست.',
        }
      }
    }

    const payableFood = foodTotal - discount
    const balance = await this.walletBalance(db, userId)
    const walletDeduction = input.useWallet ? Math.min(balance, payableFood) : 0

    const deliveryFee =
      input.deliveryType === 'DELIVERY'
        ? await this.deps.zones.feeFor(
          addressRow ? { lat: addressRow.lat, lng: addressRow.lng } : null,
        )
        : 0
    const packagingFee = input.deliveryType === 'PICKUP' ? await this.deps.settings.packagingFee() : 0

    const totalAmount = payableFood + deliveryFee + packagingFee
    const amountPaidOnline = payableFood - walletDeduction + deliveryFee + packagingFee

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
    }
  }

  /**
   * settle موفق — همه در همین tx:
   *  PAID + برداشت کیف پول + سود معرف + DEPOSIT + redemption کوپن + queuedAt اگر بسته.
   * queuedAt فقط گزارشی است — هیچ سد تاییدی وجود ندارد (قرار فاز ۵).
   */
  async settlePayment(tx: DbOrTx, orderRow: OrderRow): Promise<{ displayId: string }> {
    const [user] = await tx
      .select()
      .from(users)
      .where(eq(users.id, orderRow.userId))
      .for('update')
    if (!user) throw Err.internal('کاربر سفارش پیدا نشد.')

    const b = orderRow.breakdown

    const [updated] = await tx
      .update(orders)
      .set({ status: 'PAID', paymentStatus: 'SUCCESS', updatedAt: new Date() })
      .where(and(eq(orders.id, orderRow.id), eq(orders.status, 'PENDING_PAYMENT')))
      .returning()
    if (!updated) return { displayId: orderRow.displayId }

    // سود معرف — ۱۰٪ فقط از پرداخت آنلاینِ غذاها (بدون ارسال و بسته‌بندی)
    const referralBase = Math.max(0, b.amountPaidOnline - b.deliveryFee - b.packagingFee)
    if (user.referredBy && referralBase > 0) {
      const amount = Math.round((referralBase * REFERRAL_PERCENT) / 100)
      if (amount > 0) {
        const [profit] = await tx
          .insert(referralProfits)
          .values({
            referrerId: user.referredBy,
            buyerId: orderRow.userId,
            orderId: orderRow.id,
            baseAmount: referralBase,
            percent: REFERRAL_PERCENT,
            amount,
          })
          .onConflictDoNothing()
          .returning()
        if (profit) {
          await tx.insert(walletTransactions).values({
            userId: user.referredBy,
            type: 'DEPOSIT',
            amount,
            description: `سود معرفی سفارش ${orderRow.displayId}`,
            orderId: orderRow.id,
            referralProfitId: profit.id,
          })
        }
      }
    }

    // ── کوپن خصوصی: مصرف گرنت + ثبت redemption (عمومی هم redemption دارد) ──
    if (orderRow.couponId) {
      const coupon = (await tx.select().from(coupons).where(eq(coupons.id, orderRow.couponId)))[0]
      if (coupon && !coupon.isPublic) {
        // گرنتِ این کاربر را مصرف کن — اتمیک با پول
        await this.deps.coupons.consumeGrant(tx, orderRow.couponId, orderRow.userId)
      }
      await tx
        .insert(couponRedemptions)
        .values({ couponId: orderRow.couponId, userId: orderRow.userId, orderId: orderRow.id })
        .onConflictDoNothing()
    }

    // ── اعطای لحظه‌ای — شرط‌های کوپن‌های خصوصی فعال چک و گرنت ──
    const granted = await this.deps.coupons.grantIfEligible(tx, orderRow.userId)
    if (granted > 0) {
      console.log(`[order] ${orderRow.displayId}: ${granted} coupon grant(s) for user ${orderRow.userId}`)
    }

    // گزارشی: «در زمان بسته (هر نوع) ثبت شد» — بدون سد؛ ادمین۲ می‌تواند بلافاصله تایید کند
    const status = await this.deps.settings.restaurantStatus()
    if (status.anyClosed) {
      await tx.update(orders).set({ queuedAt: new Date() }).where(eq(orders.id, orderRow.id))
    }

    return { displayId: orderRow.displayId }
  }

  /** پرداخت ناموفق — سفارش ثبت می‌ماند (قرارداد فرانت) + آزادسازی رزرو کوپن */
  async failPayment(tx: DbOrTx, orderRow: OrderRow): Promise<void> {
    await tx
      .update(orders)
      .set({ status: 'CANCELED', paymentStatus: 'FAILED', updatedAt: new Date() })
      .where(and(eq(orders.id, orderRow.id), eq(orders.status, 'PENDING_PAYMENT')))

    // phase-2: پس‌گرفتن رزرو کیف پول — ledger append-only → ردیف جبرانی
    if (orderRow.breakdown.walletDeduction > 0) {
      await tx.insert(walletTransactions).values({
        userId: orderRow.userId,
        type: 'DEPOSIT',
        amount: orderRow.breakdown.walletDeduction,
        description: `بازگشت کیف پول سفارش لغوشده ${orderRow.displayId}`,
        orderId: orderRow.id,
      })
    }

    if (orderRow.couponId) {
      await tx
        .update(coupons)
        .set({ usedCount: sql`greatest(${coupons.usedCount} - 1, 0)` })
        .where(eq(coupons.id, orderRow.couponId))
    }
  }

  /**
 * phase-2 — refund (فقط ادمین اصلی): سفارشِ پرداخت‌شده → CANCELED +
 * بازگشت «کل» مبلغ به کیف پول مشتری (wallet + online = بی‌ضرر کامل) +
 * فسخ سود معرف + آزادسازی کوپن. پولِ درگاهی جداگانه با PSP تسویه
 * می‌شود (API زرین‌پال — فاز بعدی/دستی).
 */
  async refund(
    displayId: string,
    reason: string,
  ): Promise<{ displayId: string; refundedAmount: number }> {
    if (!DISPLAY_RE.test(displayId)) throw Err.notFound('سفارش پیدا نشد.')

    return this.deps.db.transaction(async (tx) => {
      const row = (
        await tx.select().from(orders).where(eq(orders.displayId, displayId)).for('update')
      )[0]
      if (!row) throw Err.notFound('سفارش پیدا نشد.')
      if (row.status === 'CANCELED') throw Err.conflict('این سفارش قبلاً لغو شده است.')
      if (row.paymentStatus !== 'SUCCESS') {
        throw Err.conflict('فقط سفارش‌های پرداخت‌شده قابل بازگشت وجه هستند.')
      }

      await tx
        .update(orders)
        .set({
          status: 'CANCELED',
          paymentStatus: 'REFUNDED',
          internalNote: reason,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, row.id))

      // ۱) بازگشت کل مبلغ به کیف پول مشتری — onConflictDoNothing = idempotent
      const refundedAmount = row.breakdown.totalAmount
      if (refundedAmount > 0) {
        await tx
          .insert(walletTransactions)
          .values({
            userId: row.userId,
            type: 'DEPOSIT',
            amount: refundedAmount,
            description: `بازگشت وجه سفارش ${row.displayId}`,
            orderId: row.id,
          })
          .onConflictDoNothing()
      }

      // ۲) فسخ سود معرف — ردیف profit می‌ماند (FK سالم)، ردیف معکوس می‌نشیند
      const profits = await tx
        .select()
        .from(referralProfits)
        .where(eq(referralProfits.orderId, row.id))
      for (const p of profits) {
        await tx
          .insert(walletTransactions)
          .values({
            userId: p.referrerId,
            type: 'WITHDRAW',
            amount: p.amount,
            description: `فسخ سود معرفی سفارش ${row.displayId}`,
            orderId: row.id,
            referralProfitId: p.id,
          })
          .onConflictDoNothing()
      }

      // ۳) آزادسازی کوپن — رزرو + redemption + گرنت
      if (row.couponId) {
        await tx
          .update(coupons)
          .set({ usedCount: sql`greatest(${coupons.usedCount} - 1, 0)` })
          .where(eq(coupons.id, row.couponId))
        await tx
          .delete(couponRedemptions)
          .where(
            and(eq(couponRedemptions.couponId, row.couponId), eq(couponRedemptions.orderId, row.id)),
          )
        const coupon = (await tx.select().from(coupons).where(eq(coupons.id, row.couponId)))[0]
        if (coupon && !coupon.isPublic) {
          await tx
            .update(couponGrants)
            .set({ consumedAt: null })
            .where(
              and(eq(couponGrants.couponId, row.couponId), eq(couponGrants.userId, row.userId)),
            )
        }
      }

      return { displayId: row.displayId, refundedAmount }
    })
  }

  // ── خواندن ──

  async myOrders(userId: string) {
    const rows = await this.deps.db
      .select()
      .from(orders)
      .where(eq(orders.userId, userId))
      .orderBy(desc(orders.createdAt))
    return this.mapRows(rows)
  }

  async byDisplayId(userId: string, displayId: string) {
    if (!DISPLAY_RE.test(displayId)) throw Err.notFound('سفارش پیدا نشد.')
    const row = (
      await this.deps.db.select().from(orders).where(eq(orders.displayId, displayId))
    )[0]
    if (!row || row.userId !== userId) throw Err.notFound('سفارش پیدا نشد.')
    const items = await this.deps.db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, row.id))
    const profit = await this.deps.db
      .select({ amount: referralProfits.amount })
      .from(referralProfits)
      .where(eq(referralProfits.orderId, row.id))
      .then((r) => r[0]?.amount ?? 0)
    return this.mapOne(row, items, profit)
  }

  /** تایید تحویل توسط مشتری — قرارداد فرانت */
  async confirmDelivery(userId: string, displayId: string): Promise<void> {
    if (!DISPLAY_RE.test(displayId)) throw Err.notFound('سفارش پیدا نشد.')
    const row = (
      await this.deps.db.select().from(orders).where(eq(orders.displayId, displayId))
    )[0]
    if (!row || row.userId !== userId) throw Err.notFound('سفارش پیدا نشد.')
    if (row.status !== 'PAID' && row.status !== 'CONFIRMED' && row.status !== 'ON_THE_WAY') {
      throw Err.conflict('این سفارش قابل تایید تحویل نیست.')
    }
    await this.deps.db
      .update(orders)
      .set({ status: 'DELIVERED', deliveredAt: new Date(), updatedAt: new Date() })
      .where(eq(orders.id, row.id))
  }

  /** پرچم ردیابی — snapshot ثبت سفارش، نه وضعیت فعلی تنظیمات */
  async tracking(userId: string, displayId: string): Promise<{ isEnabled: boolean }> {
    if (!DISPLAY_RE.test(displayId)) throw Err.notFound('سفارش پیدا نشد.')
    const row = (
      await this.deps.db.select().from(orders).where(eq(orders.displayId, displayId))
    )[0]
    if (!row || row.userId !== userId) throw Err.notFound('سفارش پیدا نشد.')
    return { isEnabled: row.trackingEnabled }
  }

  // ── داخلی ──

  private async mapRows(rows: OrderRow[]) {
    if (rows.length === 0) return []
    const ids = rows.map((r) => r.id)

    const items = await this.deps.db
      .select()
      .from(orderItems)
      .where(inArray(orderItems.orderId, ids))
    const itemsByOrder = new Map<OrderId, OrderItemRow[]>()
    for (const it of items) {
      const list = itemsByOrder.get(it.orderId) ?? []
      list.push(it)
      itemsByOrder.set(it.orderId, list)
    }

    const profits = await this.deps.db
      .select({ orderId: referralProfits.orderId, amount: referralProfits.amount })
      .from(referralProfits)
      .where(inArray(referralProfits.orderId, ids))
    const profitByOrder = new Map(profits.map((p) => [p.orderId, p.amount]))

    return rows.map((r) =>
      this.mapOne(r, itemsByOrder.get(r.id) ?? [], profitByOrder.get(r.id) ?? 0),
    )
  }

  private mapOne(row: OrderRow, items: OrderItemRow[], referralProfit: number) {
    return {
      id: row.displayId,
      date: row.createdAt,
      totalAmount: row.breakdown.totalAmount,
      itemCount: items.reduce((s, i) => s + i.quantity, 0),
      address: row.addressSnapshot,
      courierName: null, // فاز ۵ — سرویس live پر می‌کند
      courierPhone: null,
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
    }
  }
}