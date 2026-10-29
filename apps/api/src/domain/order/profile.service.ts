//src/domain/order/profile.service.ts
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import {
  addresses,
  devices,
  deviceEvents,
  deviceIdentities,
  orders,
  referralProfits,
  users,
  walletTransactions,
} from '#/infra/db/schema'
import type { AppConfig } from '#/infra/config/env'
import { Err } from '#/domain/shared/errors'
import { ensureUserReferralCode } from '#/domain/shared/referral-code'
import { asDeviceId } from '#/domain/shared/brand'
import { signedWalletAmount } from '#/domain/shared/wallet-sql'
import type { DeviceService } from '#/domain/device/device.service'
import type { OrderService } from './order.service'

/** پروفایل کامل — قرارداد getUserProfile فرانت */
export class ProfileService {
  constructor(
    private readonly deps: {
      db: Db
      config: AppConfig
      orders: OrderService
      devices: DeviceService
    },
  ) { }

  /**
   * round-12 — پیوندِ معرف پس از ثبت‌نام (اسکن QR در داشبورد کاربر).
   * گاردها: یک‌بار بودن، کد خودتان نه، وجود معرف، REFERRAL_BLOCK خوشهٔ دستگاه —
   * همان قواعد ثبت‌نام (auth.service) این‌جا برای کاربرِ ازقبل‌موجود تکرار می‌شود.
   */
  async applyReferral(
    userId: string,
    deviceId: string,
    rawCode: string,
  ): Promise<{ referrerCode: string }> {
    const { db, config } = this.deps
    const code = rawCode.trim().toUpperCase()
    if (!code) throw Err.validation('کد معرف را وارد کنید.')
    if (!/^[A-Z0-9_-]{3,16}$/.test(code)) throw Err.validation('کد معرف معتبر نیست.')

    const result = await db.transaction(async (tx) => {
      // Serializing bindings makes the ancestry check safe for reciprocal and
      // longer concurrent cycles. Signup only adds a new leaf to this graph.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('referral-graph-binding'))`)
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('no key update')
      if (!user) throw Err.unauthorized()
      if (user.referredBy) throw Err.conflict('قبلاً معرف برای حساب شما ثبت شده است.')

      // Old custom codes may contain lowercase. Ambiguous legacy codes must
      // never silently attribute rewards to a different account.
      const matches = await tx.select().from(users)
        .where(sql`upper(${users.referralCode}) = ${code}`).limit(2)
      const referrer = matches.length === 1 ? matches[0] : undefined
      if (!referrer) throw Err.notFound('کد معرف معتبر نیست.')
      if (referrer.id === user.id) {
        throw Err.validation('کد معرف خودتان قابل استفاده نیست.')
      }
      const ancestry = await tx.execute(sql`
        with recursive chain as (
          select id, referred_by from users where id = ${referrer.id}
          union
          select parent.id, parent.referred_by from users parent
          join chain on parent.id = chain.referred_by
        )
        select exists(select 1 from chain where id = ${user.id})
          or not exists(select 1 from chain where referred_by is null) as cyclic
      `)
      if ((ancestry[0] as { cyclic: boolean } | undefined)?.cyclic) {
        throw Err.validation('این کد باعث معرفی حلقه‌ای می‌شود و قابل استفاده نیست.')
      }

      const clusterPhones = await this.deps.devices.referralBlockedForDeviceOn(
        tx, deviceId, user.phone,
      )
      if (clusterPhones >= config.device.referralBlockAfter) {
        await tx.insert(deviceEvents).values({
          deviceId: asDeviceId(deviceId), phone: user.phone, event: 'REFERRAL_BLOCKED',
          metadata: { refCode: code, clusterPhones, via: 'profile-apply' },
        })
        return { blocked: true } as const
      }

      await tx.update(users).set({ referredBy: referrer.id }).where(eq(users.id, user.id))
      await tx.insert(deviceEvents).values({
        deviceId: asDeviceId(deviceId), phone: user.phone, event: 'REFERRAL_APPLIED',
        metadata: { refCode: code, referrerId: referrer.id },
      })
      return { blocked: false, referrerCode: referrer.referralCode ?? code } as const
    })
    if (result.blocked) {
      throw Err.forbidden(
        'به دلایل امنیتی، ثبت معرف از این دستگاه امکان‌پذیر نیست.',
      )
    }
    return { referrerCode: result.referrerCode }
  }

  /** phase-3 — ویرایش name/email (مرجع: فرانت قبلاً پوسته‌ی بی‌اثر بود) */
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
    if (!user.referralCode?.trim()) user.referralCode = await ensureUserReferralCode(db, user.id)

    let referrerCode: string | null = null
    if (user.referredBy) {
      const referrer = (await db.select().from(users).where(eq(users.id, user.referredBy)))[0]
      referrerCode = referrer?.referralCode ?? null
    }

    // حالت سبک: ستون‌های سنگین (txs/devices/referrals) خالی — نه کوئری
    const [balance, totalProfit, txRows, addressRows, deviceRows, referralRows, totalReferrals] =
      await Promise.all([
        this.deps.orders.walletBalance(db, userId),
        db
          .select({ total: sql<number>`coalesce(sum(${signedWalletAmount}), 0)::bigint` })
          .from(referralProfits)
          .innerJoin(walletTransactions, eq(walletTransactions.referralProfitId, referralProfits.id))
          .where(and(eq(referralProfits.referrerId, userId), eq(walletTransactions.userId, userId)))
          .then((r) => Number(r[0]?.total ?? 0)),
        light
          ? Promise.resolve([] as { tx: typeof walletTransactions.$inferSelect; orderDisplayId: string | null }[])
          : db
              .select({ tx: walletTransactions, orderDisplayId: orders.displayId })
              .from(walletTransactions)
              .leftJoin(orders, and(eq(orders.id, walletTransactions.orderId), eq(orders.userId, userId)))
              .where(eq(walletTransactions.userId, userId))
              // round-16 — سقف دفاعی: صفحهٔ کیف پول سمت کلاینت صفحه‌بندی دارد؛
              // ۲۰۰ تراکنش آخر کفایت می‌کند و پاسخ بی‌سقف با گذر زمان بمب حافظه/پهنای‌باند است
              .orderBy(desc(walletTransactions.createdAt))
              .limit(200),
        db.select().from(addresses).where(eq(addresses.userId, userId)),
        light
          ? Promise.resolve([] as {
              id: string
              name: string
              platform: string
              riskScore: number
              deviceType: string | null
              deviceBrand: string | null
              deviceModel: string | null
              lastLoginAt: Date | null
              firstLoginAt: Date | null
            }[])
          : db
              .select({
                id: devices.id,
                name: sql<string>`coalesce(${devices.label}, ${devices.platform}, 'دستگاه')`,
                platform: devices.platform,
                riskScore: devices.riskScore,
                deviceType: devices.deviceType,
                deviceBrand: devices.deviceBrand,
                deviceModel: devices.deviceModel,
                lastLoginAt: deviceIdentities.lastLoginAt,
                firstLoginAt: deviceIdentities.firstLoginAt,
              })
              .from(deviceIdentities)
              .innerJoin(devices, eq(devices.id, deviceIdentities.deviceId))
              .where(eq(deviceIdentities.phone, user.phone))
              .orderBy(sql`${deviceIdentities.lastLoginAt} desc nulls last`),
        light ? Promise.resolve([] as Awaited<ReturnType<ProfileService['myReferrals']>>) : this.myReferrals(userId),
        db.select({ total: sql<number>`count(*)::bigint` }).from(users)
          .where(eq(users.referredBy, userId))
          .then((r) => Number(r[0]?.total ?? 0)),
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
      totalReferrals,
      joinedAt: user.createdAt,
      devices: deviceRows.map((d) => ({
        id: d.id,
        name: d.name,
        platform: d.platform,
        riskScore: d.riskScore,
        // stage-70 — نوع/برند/مدل برای «دستگاه‌های فعال» پروفایل
        deviceType:
          d.deviceType === 'mobile' || d.deviceType === 'tablet' || d.deviceType === 'desktop'
            ? d.deviceType
            : null,
        deviceBrand: d.deviceBrand,
        deviceModel: d.deviceModel,
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
    // round-16 — سقف دفاعی: ۲۰۰ زیرمجموعهٔ آخر (لیست سمت کلاینت صفحه‌بندی دارد)
    const referrals = await db
      .select()
      .from(users)
      .where(eq(users.referredBy, userId))
      .orderBy(desc(users.createdAt), desc(users.id))
      .limit(200)
    if (referrals.length === 0) return []

    const buyerIds = referrals.map((r) => r.id)
    const [orderAgg, profitAgg] = await Promise.all([
      db
        .select({
          userId: orders.userId,
          orderCount: sql<number>`count(*)::int`,
          spent: sql<number>`coalesce(sum(${orders.totalAmount}), 0)::bigint`,
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
          profit: sql<number>`coalesce(sum(${signedWalletAmount}), 0)::bigint`,
        })
        .from(referralProfits)
        .innerJoin(walletTransactions, eq(walletTransactions.referralProfitId, referralProfits.id))
        .where(and(eq(referralProfits.referrerId, userId), eq(walletTransactions.userId, userId), inArray(referralProfits.buyerId, buyerIds)))
        .groupBy(referralProfits.buyerId),
    ])

    const orderMap = new Map(orderAgg.map((o) => [o.userId, o]))
    const profitMap = new Map(profitAgg.map((p) => [p.buyerId, p.profit]))

    return referrals.map((r) => ({
      id: r.id,
      phone: r.phone,
      registerDate: r.createdAt,
      totalOrders: orderMap.get(r.id)?.orderCount ?? 0,
      totalSpent: Number(orderMap.get(r.id)?.spent ?? 0),
      myProfit: Number(profitMap.get(r.id) ?? 0),
    }))
  }
}
