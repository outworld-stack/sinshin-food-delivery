//src/domain/order/profile.service.ts
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import {
  addresses,
  devices,
  deviceIdentities,
  orders,
  referralProfits,
  users,
  walletTransactions,
} from '#/infra/db/schema'
import type { AppConfig } from '#/infra/config/env'
import { Err } from '#/domain/shared/errors'
import type { OrderService } from './order.service'

/** پروفایل کامل — قرارداد getUserProfile فرانت */
export class ProfileService {
  constructor(
    private readonly deps: { db: Db; config: AppConfig; orders: OrderService },
  ) { }

  /** phase-3 — ویرایش name/email (مرجع: فرانت قبلاً stub no-op بود) */
  async updateProfile(
    userId: string,
    input: { name: string | null; email: string | null },
  ): Promise<void> {
    await this.deps.db
      .update(users)
      .set({ name: input.name, email: input.email })
      .where(eq(users.id, userId))
  }

  /**
   * perf-fix (کار-۶): حالت سبک برای لایه‌های همیشگی (هدر سایت/لایوت داشبورد/چک‌اوت).
   *
   * مشکل: هدر در «هر» صفحه‌ی سایت پروفایل مگا می‌گرفت — allOrders بدون سقف
   * (با آیتم‌ها)، همه‌ی تراکنش‌های کیف پول، دستگاه‌ها و تجمیع معرفی‌ها.
   * حالت سبک: همان DTO (قرارداد فرانت دست‌نخورده) ولی لیست‌های سنگین خالی و
   * سفارش‌ها = ۱۰ مورد آخر + سفارش‌های فعال (myOrdersLight). مصرف‌کننده‌های
   * سبک فقط اسکالرها/آدرس‌ها/تشخیص سفارش فعال را می‌خوانند.
   */
  async get(
    userId: string,
    currentDeviceId: string,
    opts: { light?: boolean } = {},
  ) {
    const light = opts.light === true
    const { db } = this.deps
    const user = (await db.select().from(users).where(eq(users.id, userId)))[0]
    if (!user) throw Err.unauthorized()

    let referrerCode: string | null = null
    if (user.referredBy) {
      const referrer = (await db.select().from(users).where(eq(users.id, user.referredBy)))[0]
      referrerCode = referrer?.referralCode ?? null
    }

    // حالت سبک: ستون‌های سنگین (txs/devices/referrals) خالی — نه کوئری
    const [balance, totalProfit, txRows, addressRows, deviceRows, referralRows] =
      await Promise.all([
        this.deps.orders.walletBalance(db, userId),
        db
          .select({ total: sql<number>`coalesce(sum(${referralProfits.amount}), 0)::int` })
          .from(referralProfits)
          .where(eq(referralProfits.referrerId, userId))
          .then((r) => r[0]?.total ?? 0),
        light
          ? Promise.resolve([] as { tx: typeof walletTransactions.$inferSelect; orderDisplayId: string | null }[])
          : db
              .select({ tx: walletTransactions, orderDisplayId: orders.displayId })
              .from(walletTransactions)
              .leftJoin(orders, eq(orders.id, walletTransactions.orderId))
              .where(eq(walletTransactions.userId, userId))
              .orderBy(desc(walletTransactions.createdAt)),
        db.select().from(addresses).where(eq(addresses.userId, userId)),
        light
          ? Promise.resolve([] as {
              id: string
              name: string
              platform: string
              riskScore: number
              lastLoginAt: Date | null
              firstLoginAt: Date | null
            }[])
          : db
              .select({
                id: devices.id,
                name: sql<string>`coalesce(${devices.label}, ${devices.platform}, 'دستگاه')`,
                platform: devices.platform,
                riskScore: devices.riskScore,
                lastLoginAt: deviceIdentities.lastLoginAt,
                firstLoginAt: deviceIdentities.firstLoginAt,
              })
              .from(deviceIdentities)
              .innerJoin(devices, eq(devices.id, deviceIdentities.deviceId))
              .where(eq(deviceIdentities.phone, user.phone))
              .orderBy(sql`${deviceIdentities.lastLoginAt} desc nulls last`),
        light ? Promise.resolve([] as Awaited<ReturnType<ProfileService['myReferrals']>>) : this.myReferrals(userId),
      ])

    const allOrders = light
      ? await this.deps.orders.myOrdersLight(userId)
      : await this.deps.orders.myOrders(userId)

    return {
      id: user.id,
      phone: user.phone,
      name: user.name,
      email: user.email,
      walletBalance: balance,
      referralCode: user.referralCode,
      referralLink: `${this.deps.config.siteUrl}/referral/${user.referralCode ?? ''}`,
      referrerCode,
      totalReferralProfit: totalProfit,
      joinedAt: user.createdAt,
      devices: deviceRows.map((d) => ({
        id: d.id,
        name: d.name,
        platform: d.platform,
        riskScore: d.riskScore,
        lastActiveAt: d.lastLoginAt ?? d.firstLoginAt,
        createdAt: d.firstLoginAt,
        current: d.id === currentDeviceId,
      })),
      recentOrders: allOrders.slice(0, 5),
      allOrders,
      addresses: addressRows.map((a) => ({
        id: a.id,
        title: a.title,
        address: a.address,
        lat: a.lat,
        lng: a.lng,
      })),
      myReferrals: referralRows,
      walletTransactions: txRows.map(({ tx, orderDisplayId }) => ({
        id: tx.id,
        type: tx.type,
        amount: tx.amount,
        date: tx.createdAt,
        description: tx.description,
        orderId: orderDisplayId ?? null,
      })),
    }
  }

  private async myReferrals(userId: string) {
    const { db } = this.deps
    const referrals = await db.select().from(users).where(eq(users.referredBy, userId))
    if (referrals.length === 0) return []

    const buyerIds = referrals.map((r) => r.id)
    const [orderAgg, profitAgg] = await Promise.all([
      db
        .select({
          userId: orders.userId,
          orderCount: sql<number>`count(*)::int`,
          spent: sql<number>`coalesce(sum(${orders.totalAmount}), 0)::int`,
        })
        .from(orders)
        .where(
          and(
            inArray(orders.userId, buyerIds),
            eq(orders.paymentStatus, 'SUCCESS'),
            ne(orders.status, 'CANCELED'),
          ),
        )
        .groupBy(orders.userId),
      db
        .select({
          buyerId: referralProfits.buyerId,
          profit: sql<number>`coalesce(sum(${referralProfits.amount}), 0)::int`,
        })
        .from(referralProfits)
        .where(eq(referralProfits.referrerId, userId))
        .groupBy(referralProfits.buyerId),
    ])

    const orderMap = new Map(orderAgg.map((o) => [o.userId, o]))
    const profitMap = new Map(profitAgg.map((p) => [p.buyerId, p.profit]))

    return referrals.map((r) => ({
      id: r.id,
      phone: r.phone,
      registerDate: r.createdAt,
      totalOrders: orderMap.get(r.id)?.orderCount ?? 0,
      totalSpent: orderMap.get(r.id)?.spent ?? 0,
      myProfit: profitMap.get(r.id) ?? 0,
    }))
  }
}