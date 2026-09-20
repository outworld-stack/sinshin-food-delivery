//src/domain/live/live.service.ts
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { buildRangeCharts } from '#/domain/shared/charts'
import type { Db } from '#/infra/db/client'
import {
    admin2Profiles,
    couriers,
    orders,
    users,
    type OrderRow,
} from '#/infra/db/schema'
import type { AppConfig } from '#/infra/config/env'
import { Err } from '#/domain/shared/errors'
import type { Admin2Service } from '#/domain/admin2/admin2.service'
import type { SseHub } from '#/infra/realtime/sse-hub'
import { asCourierId, asUserId, type CourierId } from '#/domain/shared/brand'

const DISPLAY_RE = /^ord-[a-z0-9]{8}$/

export interface LiveOrderView {
    id: string
    userPhone: string
    userName: string
    amount: number
    date: Date
    status: string
    /** رنگ پنل: DELIVERY=آبی | PICKUP=بنفش | DINE_IN=سبز — فرانت بر اساس deliveryType */
    deliveryType: string
    customerNote: string | null
    noteSeen: boolean
    confirmedBy: string | null
    confirmedByName: string | null
    courierId: string | null
    courierName: string | null
    courierPhone: string | null
    courierArrivedAt: Date | null
    courierSecurityEnabled: boolean
    internalNote: string | null
    breakdown: OrderRow['breakdown']
    createdAt: Date
}

/**
 * پنل سفارشات زنده — چند ادمین۲ هم‌زمان.
 * «صف» = PAID بدون confirmedBy — هر ادمین داخل scope خودش می‌بیند.
 * مالکیت با تایید — confirmedBy.
 */
export class LiveService {
    constructor(
        private readonly deps: { db: Db; config: AppConfig; admin2: Admin2Service; hub: SseHub },
    ) { }

    /** لیست زنده برای یک ادمین۲ — PAID های داخل scope + CONFIRMED/ON_THE_WAY های خودش */
    async liveOrders(adminUserId: string): Promise<{ orders: LiveOrderView[]; total: number }> {
        const scope = await this.deps.admin2.scopeOf(adminUserId)
        if (!scope || (!scope.hall && !scope.takeaway)) {
            return { orders: [], total: 0 }
        }

        // PAID (صفِ scope) ∪ CONFIRMED/ON_THE_WAY (مالِ خودش)
        const scopeSql =
            scope.hall && scope.takeaway
                ? sql`true`
                : scope.hall
                    ? eq(orders.deliveryType, 'DINE_IN')
                    : sql`${orders.deliveryType} in ('DELIVERY', 'PICKUP')`

        const rows = await this.deps.db
            .select({ o: orders, buyer: users })
            .from(orders)
            .innerJoin(users, eq(users.id, orders.userId))
            .where(
                sql`(${orders.status} = 'PAID' and ${orders.confirmedBy} is null and ${scopeSql})
            or (${orders.confirmedBy} = ${adminUserId} and ${orders.status} in ('CONFIRMED', 'ON_THE_WAY'))`,
            )
            .orderBy(desc(orders.createdAt))
            .limit(200)

        return {
            orders: await this.toViews(rows), total: rows.length,
        }
    }

    /** آمار داشبورد ادمین۲ — فقط سفارشات خودش */
    async admin2Stats(adminUserId: string) {
        const rows = await this.deps.db
            .select()
            .from(orders)
            .where(
                and(
                    eq(orders.confirmedBy, adminUserId),
                    sql`${orders.status} in ('CONFIRMED', 'ON_THE_WAY', 'DELIVERED')`,
                ),
            )
            .orderBy(desc(orders.createdAt))

        const totalAmount = rows.reduce((s, o) => s + o.totalAmount, 0)
        return {
            totalOrders: rows.length,
            totalAmount,
            recentOrders: rows.slice(0, 5).map((o) => ({
                id: o.displayId,
                amount: o.totalAmount,
                date: o.createdAt,
                status: o.status,
            })),
            // ⬅ phase-3: نمودار از داده‌ی واقعی — مبلغ سفارشات تاییدشده‌ی خودم
            chartData: buildRangeCharts(
                rows.map((o) => ({ date: o.createdAt, value: o.totalAmount })),
            ),
        }
    }

    /** دیدن نکته‌ی مشتری — قبل از اجازه‌ی تایید (قرارداد فرانت) */
    async viewNote(adminUserId: string, displayId: string): Promise<{ note: string | null }> {
        const row = await this.mustGet(displayId)

        // امن-۳: مالک یا سفارشِ صف داخل scope — همان چشمی‌ که liveOrders می‌بیند.
        // قبلاً هر ادمین۲ نکته‌ی هر سفارشی را باز کرده و noteSeen ست می‌کرد.
        await this.assertViewable(adminUserId, row)

        const note = row.customerNote
        await this.deps.db
            .update(orders)
            .set({ noteSeen: true, updatedAt: new Date() })
            .where(eq(orders.id, row.id))
        await this.deps.admin2.log(adminUserId, 'NOTE_SEEN', displayId, {})
        await this.deps.admin2.touchActivity(adminUserId)
        // پنل‌های دیگر هم ببینند noteSeen شد — refresh
        this.deps.hub.publish('orders:new', { event: 'order-updated', data: { id: displayId } })
        return { note }
    }

    /**
     * تایید سفارش — قلب پنل:
     *  - نکته‌ی دیده‌نشده → رد
     *  - PAID + داخل scope → CONFIRMED + مالکیت + پیک + صف چاپ
     */
    async confirmOrder(
        adminUserId: string,
        displayId: string,
        input: { courierId?: string | null; courierNote?: string | null; securityEnabled?: boolean },
    ): Promise<{ success: boolean; message?: string }> {
        const row = await this.mustGet(displayId)

        if (row.customerNote && !row.noteSeen) {
            return { success: false, message: 'ابتدا نکته مشتری را ببینید و تیک بزنید' }
        }
        // scope قبل از status — پیام درست برای ادمینِ خارج از حوزه
        const scope = await this.deps.admin2.scopeOf(adminUserId)
        if (!scope) return { success: false, message: 'دسترسی scope ندارید' }
        const inScope =
            (scope.hall && row.deliveryType === 'DINE_IN') ||
            (scope.takeaway && (row.deliveryType === 'DELIVERY' || row.deliveryType === 'PICKUP'))
        if (!inScope) return { success: false, message: 'این سفارش خارج از حوزه‌ی شماست' }

        if (row.status !== 'PAID') {
            return { success: false, message: 'این سفارش قابل تایید نیست' }
        }


        let courierId: string | null = null
        if (row.deliveryType === 'DELIVERY' && input.courierId) {
            const courier = await this.deps.db.query.couriers.findFirst({
                where: eq(couriers.id, asCourierId(input.courierId)),
            })
            if (!courier) return { success: false, message: 'پیک یافت نشد' }
            courierId = courier.id
        }

        const [updated] = await this.deps.db
            .update(orders)
            .set({
                status: 'CONFIRMED',
                confirmedBy: adminUserId,
                courierId: input.courierId ? asCourierId(input.courierId) : null,
                courierSecurityEnabled: input.securityEnabled ?? false,
                internalNote: input.courierNote?.slice(0, 300) ?? null,
                updatedAt: new Date(),
            })
            .where(and(eq(orders.id, row.id), eq(orders.status, 'PAID')))
            .returning()
        if (!updated) return { success: false, message: 'سفارش هم‌زمان توسط ادمین دیگری تایید شد' }

        // آمار + رویداد
        await this.deps.db.execute(sql`
      update admin2_profiles set orders_confirmed = orders_confirmed + 1
      where user_id = ${adminUserId}
    `)
        await this.deps.admin2.log(adminUserId, 'ORDER_CONFIRM', displayId, {
            courierId,
            securityEnabled: input.securityEnabled ?? false,
        })
        await this.deps.admin2.touchActivity(adminUserId)

        // پنل‌های همه‌ی ادمین‌های دیگر — سفارش از صف رفت
        this.deps.hub.publish('orders:new', { event: 'order-confirmed', data: { id: displayId, by: adminUserId } })
        return { success: true }
    }

    /** تغییر/تخصیص پیک — فقط CONFIRMED و فقط تا قبل از رسیدن پیک */
    async reassignCourier(
        adminUserId: string,
        displayId: string,
        newCourierId: string | null,
    ): Promise<{ success: boolean; message?: string }> {
        const row = await this.mustGet(displayId)
        // امن-۳: فقط سفارش خودِ ادمین — قبلاً هر ادمین۲ می‌توانست پیکِ
        // سفارش CONFIRMED شده‌ی ادمین دیگر را عوض کند
        if (row.confirmedBy !== adminUserId) {
            return { success: false, message: 'این سفارش به شما تعلق ندارد' }
        }
        if (row.status !== 'CONFIRMED') {
            return { success: false, message: 'وضعیت سفارش اجازه تغییر پیک نمی‌دهد' }
        }
        if (row.courierArrivedAt) {
            return { success: false, message: 'پیک به مغازه رسیده — امکان تغییر نیست' }
        }
        if (row.deliveryType !== 'DELIVERY') {
            return { success: false, message: 'این سفارش ارسال با پیک ندارد' }
        }

        if (newCourierId) {
            const courier = await this.deps.db.query.couriers.findFirst({
                where: eq(couriers.id, asCourierId(newCourierId)),
            })
            if (!courier) return { success: false, message: 'پیک یافت نشد' }
        }

        await this.deps.db
            .update(orders)
            .set({
                courierId: newCourierId ? asCourierId(newCourierId) : null,
                updatedAt: new Date(),
            })
            .where(eq(orders.id, row.id))
        await this.deps.admin2.log(adminUserId, 'COURIER_REASSIGN', displayId, { newCourierId })
        await this.deps.admin2.touchActivity(adminUserId)
        this.deps.hub.publish('orders:new', { event: 'order-updated', data: { id: displayId } })
        return { success: true }
    }

    /** گزینه‌های پیک برای مودال تخصیص */
    async courierOptions(): Promise<Array<{ id: string; name: string; phone: string }>> {
        return this.deps.db
            .select({ id: couriers.id, name: couriers.name, phone: couriers.phone })
            .from(couriers)
            .where(eq(couriers.isActive, true))
    }

    /** جزئیات سفارش — نقش‌محور: ادمین۲ فقط سفارش خودش/صف */
    async orderDetail(viewerUserId: string, viewerRole: string, displayId: string) {
        const row = await this.mustGet(displayId)
        const buyer = (await this.deps.db.select().from(users).where(eq(users.id, row.userId)))[0]!

        // امن-۳: ادمین۲ فقط مالک خودش یا صفِ PAID داخل scope را می‌بیند.
        // قبلاً سفارش‌های PAID بدون چک scope برای همه‌ی ادمین‌های۲ باز بود.
        if (viewerRole === 'admin2') {
            await this.assertViewable(viewerUserId, row)
        }

        return (await this.toViews([{ o: row, buyer }]))[0]!
    }

    // ── داخلی ──

    /**
     * امن-۳ — اجازه‌ی دیدن/باز کردن یک سفارش برای ادمین۲:
     *  مالک (confirmedBy = خودش، هر وضعیتی) یا سفارشِ صفِ PAID داخل scope.
     * همان قاعده‌ی liveOrders؛ ادمین اصلی (role=admin) از مسیر بالاتر رد می‌شود.
     */
    private async assertViewable(adminUserId: string, row: OrderRow): Promise<void> {
        if (row.confirmedBy === adminUserId) return
        if (row.status === 'PAID') {
            const scope = await this.deps.admin2.scopeOf(adminUserId)
            const inScope =
                !!scope &&
                ((scope.hall && row.deliveryType === 'DINE_IN') ||
                    (scope.takeaway &&
                        (row.deliveryType === 'DELIVERY' || row.deliveryType === 'PICKUP')))
            if (inScope) return
            throw Err.forbidden('این سفارش خارج از حوزه‌ی شماست')
        }
        throw Err.forbidden('این سفارش به شما تعلق ندارد')
    }

    private async mustGet(displayId: string): Promise<OrderRow> {
        if (!DISPLAY_RE.test(displayId)) throw Err.notFound('سفارش پیدا نشد.')
        const row = (
            await this.deps.db.select().from(orders).where(eq(orders.displayId, displayId))
        )[0]
        if (!row) throw Err.notFound('سفارش پیدا نشد.')
        return row
    }

    /**
     * phase-5 — batch view: قبلاً هر سفارش ۲ کوئری مجزا می‌زد (پیک + پروفایل)
     * → با ۲۰۰ سفارش = تا ۴۰۰ کوئری در هر pollِ ۲.۵ ثانیه‌ای، روی pool با max=10!
     * حالا: ۲ کوئری inArray + دو Map.
     */
    private async toViews(
        rows: Array<{ o: OrderRow; buyer: typeof users.$inferSelect }>,
    ): Promise<LiveOrderView[]> {
        const courierIds = [
            ...new Set(rows.map(({ o }) => o.courierId).filter((x): x is CourierId => x !== null)),
        ]
        const confirmerIds = [
            ...new Set(rows.map(({ o }) => o.confirmedBy).filter((x): x is string => x !== null)),
        ]

        const [courierRows, profileRows] = await Promise.all([
            courierIds.length
                ? this.deps.db
                    .select({ id: couriers.id, name: couriers.name, phone: couriers.phone })
                    .from(couriers)
                    .where(inArray(couriers.id, courierIds))
                : [],
            confirmerIds.length
                ? this.deps.db
                    .select({
                        userId: admin2Profiles.userId,
                        firstName: admin2Profiles.firstName,
                        lastName: admin2Profiles.lastName,
                    })
                    .from(admin2Profiles)
                    .where(inArray(admin2Profiles.userId, confirmerIds.map(asUserId)))
                : [],
        ])

        const courierMap = new Map(courierRows.map((c) => [c.id, c]))
        const profileMap = new Map(profileRows.map((p) => [p.userId as string, p]))

        return rows.map(({ o, buyer }) => {
            const c = o.courierId ? courierMap.get(o.courierId) : undefined
            const p = o.confirmedBy ? profileMap.get(o.confirmedBy) : undefined
            return {
                id: o.displayId,
                userPhone: buyer.phone,
                userName: `${buyer.name ?? ''}`.trim() || buyer.phone,
                amount: o.totalAmount,
                date: o.createdAt,
                status: o.status,
                deliveryType: o.deliveryType,
                customerNote: o.customerNote,
                noteSeen: o.noteSeen,
                confirmedBy: o.confirmedBy,
                confirmedByName: p ? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() : null,
                courierId: o.courierId,
                courierName: c?.name ?? null,
                courierPhone: c?.phone ?? null,
                courierArrivedAt: o.courierArrivedAt,
                courierSecurityEnabled: o.courierSecurityEnabled,
                internalNote: o.internalNote,
                breakdown: o.breakdown,
                createdAt: o.createdAt,
            }
        })
    }
}