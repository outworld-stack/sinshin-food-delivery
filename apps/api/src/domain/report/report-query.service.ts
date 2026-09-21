//src/domain/report/report-query.service.ts
import { and, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import {
    admin2Activities,
    couponGrants,
    couponRedemptions,
    coupons,
    courierDeliveries,
    courierTrips,
    couriers,
    orders,
    users,
    walletTransactions,
} from '#/infra/db/schema'
import type { UserId } from '#/domain/shared/brand'
import { Err } from '#/domain/shared/errors'
import type { AuditService } from '#/domain/audit/audit.service'

/**
 * stage-10 — موتور باکس گزارشات داشبورد ادمین اصلی.
 *
 * یک اندپوینت، هفت نوع گزارش — همه با همان قرارداد نمایشی
 * (عنوان + آمار + جدول‌های رشته‌ای آماده‌ی رندر/چاپ):
 *  orders  — سفارشات با فیلتر وضعیت/نوع تحویل + بازه
 *  admin2  — گزارش کار ادمین‌های سطح ۲ (activities)
 *  couriers — تحویل‌های پیک‌ها (اختیاری: یک پیک)
 *  coupons — ریز کوپن‌ها (مصرف/گیرنده/وضعیت)
 *  users   — کاربران با آمار خرید
 *  user    — یک کاربر خاص (موبایل) — سفارشات + کیف پول
 *  audit   — لاگ ممیزی عملیات ادمین اصلی
 */
export type ReportQueryType =
    | 'orders'
    | 'admin2'
    | 'couriers'
    | 'coupons'
    | 'users'
    | 'user'
    | 'audit'

export interface ReportQueryInput {
    type: ReportQueryType
    from?: string | null
    to?: string | null
    status?: string | null
    deliveryType?: string | null
    adminUserId?: string | null
    courierId?: string | null
    phone?: string | null
}

export interface ReportResultDto {
    title: string
    subtitle: string
    generatedAt: string
    stats: { label: string; value: string }[]
    tables: { title: string; head: string[]; rows: string[][] }[]
}

const faNum = (n: number) => n.toLocaleString('fa-IR')
const faDate = (d: Date) =>
    new Intl.DateTimeFormat('fa-IR', { dateStyle: 'short', timeStyle: 'short' }).format(d)
const faDelivery = (t: string) =>
    t === 'DELIVERY' ? 'ارسال با پیک' : t === 'PICKUP' ? 'بیرون‌بر' : 'سرو در سالن'
const faStatus = (s: string) =>
    s === 'PAID' ? 'در انتظار تایید'
        : s === 'CONFIRMED' ? 'تایید شده'
            : s === 'ON_THE_WAY' ? 'در مسیر'
                : s === 'DELIVERED' ? 'تحویل شده'
                    : s === 'CANCELED' ? 'پرداخت ناموفق'
                        : 'در انتظار پرداخت'
const faAction = (a: string) =>
    ({
        LOGIN: 'ورود',
        LOGOUT: 'خروج',
        ORDER_CONFIRM: 'تایید سفارش',
        COURIER_ASSIGN: 'تخصیص پیک',
        COURIER_REASSIGN: 'جابه‌جایی پیک',
        NOTE_SEEN: 'مشاهده یادداشت',
        TEMP_CLOSE: 'بستن موقت',
        TEMP_OPEN: 'بازگشایی موقت',
        PACKAGING_FEE_CHANGE: 'تغییر هزینه بسته‌بندی',
        SECURITY_TOGGLE: 'تغییر امنیت پیک',
    })[a] ?? a

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const PHONE_RE = /^09[0-9]{9}$/

export class ReportQueryService {
    constructor(
        private readonly deps: {
            db: Db
            audit: AuditService
        },
    ) { }

    async query(input: ReportQueryInput): Promise<ReportResultDto> {
        const from = this.parseDate(input.from)
        const to = this.parseDate(input.to)
        const generatedAt = new Date().toISOString()
        const subtitle = this.rangeLabel(from, to)

        switch (input.type) {
            case 'orders':
                return this.ordersReport(from, to, input, generatedAt, subtitle)
            case 'admin2':
                return this.admin2Report(from, to, input, generatedAt, subtitle)
            case 'couriers':
                return this.couriersReport(from, to, input, generatedAt, subtitle)
            case 'coupons':
                return this.couponsReport(from, to, generatedAt, subtitle)
            case 'users':
                return this.usersReport(from, to, generatedAt, subtitle)
            case 'user':
                return this.userReport(input, generatedAt)
            case 'audit':
                return this.auditReport(from, to, input, generatedAt, subtitle)
            default:
                throw Err.validation('نوع گزارش معتبر نیست.')
        }
    }

    // ══ سفارشات ══

    private async ordersReport(
        from: Date | undefined,
        to: Date | undefined,
        input: ReportQueryInput,
        generatedAt: string,
        subtitle: string,
    ): Promise<ReportResultDto> {
        const conditions = this.orderConditions(from, to, input)

        const rows = await this.deps.db
            .select({ o: orders, u: users })
            .from(orders)
            .innerJoin(users, eq(users.id, orders.userId))
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(desc(orders.createdAt))
            .limit(2000)

        const paid = rows.filter(({ o }) => o.status !== 'CANCELED')
        const sum = (fn: (o: typeof orders.$inferSelect) => number) =>
            paid.reduce((s, { o }) => s + fn(o), 0)

        return {
            title: 'گزارش سفارشات',
            subtitle,
            generatedAt,
            stats: [
                { label: 'تعداد سفارش', value: faNum(rows.length) },
                { label: 'مبلغ کل (تومان)', value: faNum(sum((o) => o.totalAmount)) },
                { label: 'پرداخت آنلاین (تومان)', value: faNum(sum((o) => o.breakdown.amountPaidOnline)) },
                { label: 'تخفیف (تومان)', value: faNum(sum((o) => o.breakdown.discount)) },
            ],
            tables: [
                {
                    title: 'سفارشات',
                    head: ['شناسه', 'نوع تحویل', 'وضعیت', 'مبلغ کل', 'پرداخت آنلاین', 'کیف پول', 'تخفیف', 'ارسال', 'بسته‌بندی', 'مشتری', 'زمان ثبت'],
                    rows: rows.map(({ o, u }) => [
                        o.displayId,
                        faDelivery(o.deliveryType),
                        faStatus(o.status),
                        faNum(o.breakdown.totalAmount),
                        faNum(o.breakdown.amountPaidOnline),
                        faNum(o.breakdown.walletDeduction),
                        faNum(o.breakdown.discount),
                        faNum(o.breakdown.deliveryFee),
                        faNum(o.breakdown.packagingFee),
                        u.phone,
                        faDate(o.createdAt),
                    ]),
                },
            ],
        }
    }

    // ══ گزارش کار ادمین‌های سطح ۲ ══

    private async admin2Report(
        from: Date | undefined,
        to: Date | undefined,
        input: ReportQueryInput,
        generatedAt: string,
        subtitle: string,
    ): Promise<ReportResultDto> {
        const conditions: SQL[] = []
        if (from) conditions.push(gte(admin2Activities.createdAt, from))
        if (to) conditions.push(lte(admin2Activities.createdAt, to))
        if (input.adminUserId && UUID_RE.test(input.adminUserId)) {
            conditions.push(eq(admin2Activities.adminUserId, input.adminUserId as UserId))
        }

        const rows = await this.deps.db
            .select({ a: admin2Activities, u: users })
            .from(admin2Activities)
            .innerJoin(users, eq(users.id, admin2Activities.adminUserId))
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(desc(admin2Activities.createdAt))
            .limit(2000)

        const byAdmin = new Map<string, number>()
        for (const { u } of rows) byAdmin.set(u.phone, (byAdmin.get(u.phone) ?? 0) + 1)

        return {
            title: 'گزارش کار ادمین‌های سطح ۲',
            subtitle,
            generatedAt,
            stats: [
                { label: 'تعداد فعالیت', value: faNum(rows.length) },
                { label: 'تعداد ادمین فعال‌شده', value: faNum(byAdmin.size) },
            ],
            tables: [
                {
                    title: 'خلاصه هر ادمین',
                    head: ['ادمین', 'تعداد فعالیت'],
                    rows: [...byAdmin.entries()].map(([phone, count]) => [phone, faNum(count)]),
                },
                {
                    title: 'ریز فعالیت‌ها',
                    head: ['ادمین', 'نوع فعالیت', 'سفارش', 'جزئیات', 'زمان'],
                    rows: rows.map(({ a, u }) => [
                        `${u.name ?? '—'} (${u.phone})`,
                        faAction(a.action),
                        a.orderDisplayId ?? '—',
                        Object.keys(a.metadata ?? {}).length > 0
                            ? JSON.stringify(a.metadata)
                            : '—',
                        faDate(a.createdAt),
                    ]),
                },
            ],
        }
    }

    // ══ پیک‌ها ══

    private async couriersReport(
        from: Date | undefined,
        to: Date | undefined,
        input: ReportQueryInput,
        generatedAt: string,
        subtitle: string,
    ): Promise<ReportResultDto> {
        const conditions: SQL[] = []
        if (from) conditions.push(gte(courierDeliveries.deliveredAt, from))
        if (to) conditions.push(lte(courierDeliveries.deliveredAt, to))
        if (input.courierId && UUID_RE.test(input.courierId)) {
            conditions.push(eq(courierTrips.courierId, input.courierId as never))
        }

        const rows = await this.deps.db
            .select({ d: courierDeliveries, c: couriers })
            .from(courierDeliveries)
            .innerJoin(courierTrips, eq(courierTrips.id, courierDeliveries.tripId))
            .innerJoin(couriers, eq(couriers.id, courierTrips.courierId))
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(desc(courierDeliveries.deliveredAt))
            .limit(2000)

        return {
            title: 'گزارش پیک‌ها',
            subtitle,
            generatedAt,
            stats: [
                { label: 'تعداد تحویل', value: faNum(rows.length) },
                { label: 'مجموع مبالغ (تومان)', value: faNum(rows.reduce((s, r) => s + r.d.amount, 0)) },
            ],
            tables: [
                {
                    title: 'تحویل‌ها',
                    head: ['پیک', 'سفارش', 'آدرس', 'مبلغ (تومان)', 'زمان تحویل'],
                    rows: rows.map(({ d, c }) => [
                        `${c.name} (${c.phone})`,
                        d.orderId,
                        d.addressSnapshot ?? '—',
                        faNum(d.amount),
                        faDate(d.deliveredAt),
                    ]),
                },
            ],
        }
    }

    // ══ ریز کوپن‌ها ══

    private async couponsReport(
        from: Date | undefined,
        to: Date | undefined,
        generatedAt: string,
        subtitle: string,
    ): Promise<ReportResultDto> {
        const conditions: SQL[] = []
        if (from) conditions.push(gte(coupons.createdAt, from))
        if (to) conditions.push(lte(coupons.createdAt, to))

        const rows = await this.deps.db
            .select()
            .from(coupons)
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(desc(coupons.createdAt))
            .limit(1000)

        const ids = rows.map((r) => r.id)
        const [grants, redemptions] = await Promise.all([
            ids.length
                ? this.deps.db
                    .select({ couponId: couponGrants.couponId, count: sql<number>`count(*)::int` })
                    .from(couponGrants)
                    .where(inArray(couponGrants.couponId, ids))
                    .groupBy(couponGrants.couponId)
                : Promise.resolve([]),
            ids.length
                ? this.deps.db
                    .select({ couponId: couponRedemptions.couponId, count: sql<number>`count(*)::int` })
                    .from(couponRedemptions)
                    .where(inArray(couponRedemptions.couponId, ids))
                    .groupBy(couponRedemptions.couponId)
                : Promise.resolve([]),
        ])
        const grantMap = new Map(grants.map((g) => [g.couponId as string, g.count]))
        const redeemMap = new Map(redemptions.map((r) => [r.couponId as string, r.count]))

        return {
            title: 'گزارش کوپن‌ها',
            subtitle,
            generatedAt,
            stats: [
                { label: 'تعداد کوپن', value: faNum(rows.length) },
                { label: 'کوپن‌های فعال', value: faNum(rows.filter((c) => c.isActive).length) },
                { label: 'مجموع مصرف', value: faNum(rows.reduce((s, c) => s + c.usedCount, 0)) },
            ],
            tables: [
                {
                    title: 'کوپن‌ها',
                    head: ['کد', 'درصد', 'مصرف / سقف', 'مخاطب', 'وضعیت', 'انقضا', 'گیرندگان', 'استفاده واقعی'],
                    rows: rows.map((c) => [
                        c.code,
                        `${faNum(c.discountPercentage)}٪`,
                        c.maxUses === 0 ? `${faNum(c.usedCount)} / ∞` : `${faNum(c.usedCount)} / ${faNum(c.maxUses)}`,
                        c.isPublic ? 'همه' : 'گروه خاص',
                        !c.isActive ? 'غیرفعال'
                            : c.endsAt && c.endsAt.getTime() <= Date.now() ? 'منقضی' : 'فعال',
                        c.endsAt
                            ? new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium' }).format(c.endsAt)
                            : 'بدون انقضا',
                        c.isPublic ? '—' : faNum(grantMap.get(c.id as string) ?? 0),
                        faNum(redeemMap.get(c.id as string) ?? 0),
                    ]),
                },
            ],
        }
    }

    // ══ کاربران ══

    private async usersReport(
        from: Date | undefined,
        to: Date | undefined,
        generatedAt: string,
        subtitle: string,
    ): Promise<ReportResultDto> {
        const conditions: SQL[] = []
        if (from) conditions.push(gte(users.createdAt, from))
        if (to) conditions.push(lte(users.createdAt, to))

        const rows = await this.deps.db
            .select({
                u: users,
                ordersCount: sql<number>`(
                    select count(*)::int from orders o
                    where o.user_id = ${users.id} and o.status != 'CANCELED'
                )`,
                totalSpent: sql<number>`coalesce((
                    select sum(o.total_amount) from orders o
                    where o.user_id = ${users.id} and o.payment_status = 'SUCCESS' and o.status != 'CANCELED'
                ), 0)::int`,
                wallet: sql<number>`coalesce((
                    select sum(case when wt.type = 'DEPOSIT' then wt.amount else -wt.amount end)
                    from wallet_transactions wt where wt.user_id = ${users.id}
                ), 0)::int`,
            })
            .from(users)
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(desc(users.createdAt))
            .limit(2000)

        return {
            title: 'گزارش کاربران',
            subtitle,
            generatedAt,
            stats: [
                { label: 'تعداد کاربر', value: faNum(rows.length) },
                { label: 'کاربران فعال', value: faNum(rows.filter(({ u }) => !u.bannedAt).length) },
            ],
            tables: [
                {
                    title: 'کاربران',
                    head: ['نام', 'موبایل', 'وضعیت', 'تعداد سفارش', 'مجموع خرید (تومان)', 'موجودی کیف پول (تومان)', 'تاریخ ثبت‌نام'],
                    rows: rows.map(({ u, ordersCount, totalSpent, wallet }) => [
                        u.name ?? 'ناشناس',
                        u.phone,
                        u.bannedAt ? 'مسدود' : 'فعال',
                        faNum(ordersCount),
                        faNum(totalSpent),
                        faNum(wallet),
                        faDate(u.createdAt),
                    ]),
                },
            ],
        }
    }

    // ══ کاربر خاص ══

    private async userReport(
        input: ReportQueryInput,
        generatedAt: string,
    ): Promise<ReportResultDto> {
        const phone = (input.phone ?? '').trim()
        if (!PHONE_RE.test(phone)) {
            throw Err.validation('موبایل کاربر را با قالب ۰۹XXXXXXXXX وارد کنید.')
        }

        const target = (
            await this.deps.db.select().from(users).where(eq(users.phone, phone))
        )[0]
        if (!target) throw Err.notFound('کاربری با این شماره پیدا نشد.')

        // تعداد ارجاع — زیرکوئری روی referred_by
        const referralCount = await this.deps.db
            .select({ count: sql<number>`count(*)::int` })
            .from(users)
            .where(eq(users.referredBy, target.id))
            .then((r) => r[0]?.count ?? 0)

        const [orderRows, walletRows] = await Promise.all([
            this.deps.db
                .select()
                .from(orders)
                .where(eq(orders.userId, target.id))
                .orderBy(desc(orders.createdAt))
                .limit(500),
            this.deps.db
                .select()
                .from(walletTransactions)
                .where(eq(walletTransactions.userId, target.id))
                .orderBy(desc(walletTransactions.createdAt))
                .limit(200),
        ])

        const paid = orderRows.filter((o) => o.status !== 'CANCELED')
        const totalSpent = paid
            .filter((o) => o.paymentStatus === 'SUCCESS')
            .reduce((s, o) => s + o.totalAmount, 0)
        const walletBalance = walletRows.reduce(
            (s, w) => s + (w.type === 'DEPOSIT' ? w.amount : -w.amount),
            0,
        )

        return {
            title: `گزارش کاربر ${target.name ?? target.phone}`,
            subtitle: `موبایل: ${target.phone} — ${target.bannedAt ? 'مسدود' : 'فعال'}`,
            generatedAt,
            stats: [
                { label: 'تعداد سفارش', value: faNum(orderRows.length) },
                { label: 'مجموع خرید (تومان)', value: faNum(totalSpent) },
                { label: 'موجودی کیف پول (تومان)', value: faNum(walletBalance) },
                { label: 'تعداد ارجاع', value: faNum(referralCount) },
            ],
            tables: [
                {
                    title: 'سفارشات',
                    head: ['شناسه', 'نوع تحویل', 'وضعیت', 'مبلغ کل', 'پرداخت آنلاین', 'کیف پول', 'تخفیف', 'زمان ثبت'],
                    rows: orderRows.map((o) => [
                        o.displayId,
                        faDelivery(o.deliveryType),
                        faStatus(o.status),
                        faNum(o.breakdown.totalAmount),
                        faNum(o.breakdown.amountPaidOnline),
                        faNum(o.breakdown.walletDeduction),
                        faNum(o.breakdown.discount),
                        faDate(o.createdAt),
                    ]),
                },
                {
                    title: 'تراکنش‌های کیف پول',
                    head: ['نوع', 'مبلغ (تومان)', 'توضیح', 'زمان'],
                    rows: walletRows.map((w) => [
                        w.type === 'DEPOSIT' ? 'واریز' : 'برداشت',
                        faNum(w.amount),
                        w.description,
                        faDate(w.createdAt),
                    ]),
                },
            ],
        }
    }

    // ══ لاگ ممیزی ══

    private async auditReport(
        from: Date | undefined,
        to: Date | undefined,
        input: ReportQueryInput,
        generatedAt: string,
        subtitle: string,
    ): Promise<ReportResultDto> {
        const { rows, total } = await this.deps.audit.report({
            from,
            to,
            actorId: input.adminUserId ?? undefined,
        })

        return {
            title: 'لاگ ممیزی (عملیات ادمین اصلی)',
            subtitle,
            generatedAt,
            stats: [
                { label: 'تعداد رکورد', value: faNum(total) },
                { label: 'نمایش داده شده', value: faNum(rows.length) },
            ],
            tables: [
                {
                    title: 'عملیات‌ها',
                    head: ['بازیگر', 'موبایل', 'عملیات', 'موجودیت', 'جزئیات', 'زمان'],
                    rows: rows.map((r) => [
                        r.actorName,
                        r.actorPhone,
                        r.action,
                        r.entity ?? '—',
                        Object.keys(r.metadata ?? {}).length > 0
                            ? JSON.stringify(r.metadata)
                            : '—',
                        faDate(r.createdAt),
                    ]),
                },
            ],
        }
    }

    // ══ داخلی ══

    private parseDate(iso: string | null | undefined): Date | undefined {
        if (!iso) return undefined
        const d = new Date(iso)
        return Number.isNaN(d.getTime()) ? undefined : d
    }

    private orderConditions(
        from: Date | undefined,
        to: Date | undefined,
        input: ReportQueryInput,
    ): SQL[] {
        const conditions: SQL[] = []
        if (from) conditions.push(gte(orders.createdAt, from))
        if (to) conditions.push(lte(orders.createdAt, to))
        if (input.status && input.status !== 'all') {
            conditions.push(sql`${orders.status} = ${input.status}`)
        }
        if (input.deliveryType && input.deliveryType !== 'all') {
            conditions.push(sql`${orders.deliveryType} = ${input.deliveryType}`)
        }
        return conditions
    }

    private rangeLabel(from: Date | undefined, to: Date | undefined): string {
        const f = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium' })
        if (!from && !to) return 'همه‌ی زمان‌ها — سین‌شین فودپارک'
        if (from && to) return `از ${f.format(from)} تا ${f.format(to)} — سین‌شین فودپارک`
        if (from) return `از ${f.format(from)} — سین‌شین فودپارک`
        return `تا ${f.format(to as Date)} — سین‌شین فودپارک`
    }
}
