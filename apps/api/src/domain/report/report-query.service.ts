// ═══════════════════════════════════════════════════════════════
// stage-55 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/domain/report/report-query.service.ts
// وضعیت: جایگزینی کامل فایل موجود
// تغییر: آمار گزارش‌ها از تجمیع SQL واقعی (count/sum::bigint) به‌جای reduce روی ردیف‌های سقف‌دار — رارد C1
// ═══════════════════════════════════════════════════════════════

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
import { signedWalletAmount } from '#/domain/shared/wallet-sql'
import type { AuditService } from '#/domain/audit/audit.service'
import type { AdminReportQuery, AdminReportResult } from '@sinshin/shared'

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
 *  ممیزی   — لاگ ممیزی عملیات ادمین اصلی
 *
 * رارد ۴۶ — سه تایپی که همین‌جا تعریف می‌شدند (ReportQueryType/
 * ReportQueryInput/ReportResultDto) به قرارداد مشترک منتقل شدند
 * (AdminReportType/AdminReportQuery/AdminReportResult در @sinshin/shared)؛
 * کپی موازی server/reports فرانت هم با همان منبع بسته شد. شکل‌ها تغییر نکرده‌اند.
 */

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

import { faNum, faDate, faDelivery, faStatus, ORDER_TABLE_HEAD, orderRow } from './format'
import { UUID_RE } from '#/domain/shared/ids'

const PHONE_RE = /^09[0-9]{9}$/

// رارد M8 — کش کوچکِ TTL برای گزارش‌ها (۶۰s): گزارش ادمین معمولاً چند‌بار
// پشت‌سرهم (رفرش/چاپ) صدا می‌شوند و کوئری‌های سنگینشان تکرار می‌شود.
const reportCache = new Map<string, { at: number; value: AdminReportResult }>()

export class ReportQueryService {
    constructor(
        private readonly deps: {
            db: Db
            audit: AuditService
        },
    ) { }

    async query(input: AdminReportQuery): Promise<AdminReportResult> {
        // رارد M8 — کلید کش = خودِ ورودی (قطعی و کامل)؛ TTL = ۶۰ ثانیه.
        const cacheKey = JSON.stringify(input)
        const hit = reportCache.get(cacheKey)
        if (hit && Date.now() - hit.at < 60_000) return hit.value
        const value = await this.runQuery(input)
        if (reportCache.size > 100) reportCache.clear()
        reportCache.set(cacheKey, { at: Date.now(), value })
        return value
    }

    private async runQuery(input: AdminReportQuery): Promise<AdminReportResult> {
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
                // round-11 (اسکن M-2-web): گزارش کاربر خاص هم بازهٔ زمانی می‌گیرد —
                // سفارشات/تراکنش‌ها با فیلتر؛ موجودی کیف پول همیشه کل است (پول واقعی).
                return this.userReport(input, generatedAt, from, to, subtitle)
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
        input: AdminReportQuery,
        generatedAt: string,
        subtitle: string,
    ): Promise<AdminReportResult> {
        const conditions = this.orderConditions(from, to, input)

        // stage-55 — آمار از تجمیعِ واقعی SQL با همان conditions (قبلاً:
        // rows.length و reduce روی حداکثر ۵۰۰ ردیف → با سفارش‌های بیشتر از
        // سقف، آمار فقط توصیفِ جدیدترین زیرمجموعه بود). ردیف‌ها با همان سقف
        // فقط برای جدول می‌مانند؛ همان join به users هم آینه‌شده تا شرط‌ها
        // همیشه همان‌جا کامپایل شوند. رارد C1 — ::bigint (بدون سقفِ int)؛
        // Number() چون Bun.sql مقدار bigint را string برمی‌گرداند.
        const [rows, aggRows] = await Promise.all([
            this.deps.db
                .select({ o: orders, u: users })
                .from(orders)
                .innerJoin(users, eq(users.id, orders.userId))
                .where(conditions.length > 0 ? and(...conditions) : undefined)
                .orderBy(desc(orders.createdAt))
                // رارد M8 — سقف ۵۰۰ ردیف (۲۰۰۰ × ردیف کاملِ orders خیلی سنگین بود)
                .limit(500),
            this.deps.db
                .select({
                    count: sql<number>`count(*)::int`,
                    total: sql<number>`coalesce(sum(${orders.totalAmount}) filter (where ${orders.status} <> 'CANCELED'), 0)::bigint`,
                    online: sql<number>`coalesce(sum((${orders.breakdown} ->> 'amountPaidOnline')::bigint) filter (where ${orders.status} <> 'CANCELED'), 0)::bigint`,
                    discount: sql<number>`coalesce(sum((${orders.breakdown} ->> 'discount')::bigint) filter (where ${orders.status} <> 'CANCELED'), 0)::bigint`,
                })
                .from(orders)
                .innerJoin(users, eq(users.id, orders.userId))
                .where(conditions.length > 0 ? and(...conditions) : undefined),
        ])
        const agg = aggRows[0]

        return {
            title: 'گزارش سفارشات',
            subtitle,
            generatedAt,
            stats: [
                { label: 'تعداد سفارش', value: faNum(Number(agg?.count ?? 0)) },
                { label: 'مبلغ کل (تومان)', value: faNum(Number(agg?.total ?? 0)) },
                { label: 'پرداخت آنلاین (تومان)', value: faNum(Number(agg?.online ?? 0)) },
                { label: 'تخفیف (تومان)', value: faNum(Number(agg?.discount ?? 0)) },
            ],
            tables: [
                {
                    title: 'سفارشات',
                    head: ORDER_TABLE_HEAD,
                    rows: rows.map(({ o, u }) => orderRow(o, u, { num: faNum, date: faDate })),
                },
            ],
        }
    }

    // ══ گزارش کار ادمین‌های سطح ۲ ══

    private async admin2Report(
        from: Date | undefined,
        to: Date | undefined,
        input: AdminReportQuery,
        generatedAt: string,
        subtitle: string,
    ): Promise<AdminReportResult> {
        const conditions: SQL[] = []
        if (from) conditions.push(gte(admin2Activities.createdAt, from))
        if (to) conditions.push(lte(admin2Activities.createdAt, to))
        if (input.adminUserId && UUID_RE.test(input.adminUserId)) {
            conditions.push(eq(admin2Activities.adminUserId, input.adminUserId as UserId))
        }

        // stage-55 — «تعداد فعالیت» از count واقعی SQL با همان conditions
        // (قبلاً: rows.length روی حداکثر ۲۰۰۰ ردیف → با فعالیت‌های بیشتر از
        // سقف، آمار ناقص می‌شد). ردیف‌ها فقط برای جدول و Map خلاصه‌ی هر ادمین
        // می‌مانند (داده‌ی نمایشی).
        const [rows, aggRows] = await Promise.all([
            this.deps.db
                .select({ a: admin2Activities, u: users })
                .from(admin2Activities)
                .innerJoin(users, eq(users.id, admin2Activities.adminUserId))
                .where(conditions.length > 0 ? and(...conditions) : undefined)
                .orderBy(desc(admin2Activities.createdAt))
                .limit(2000),
            this.deps.db
                .select({ count: sql<number>`count(*)::int` })
                .from(admin2Activities)
                .innerJoin(users, eq(users.id, admin2Activities.adminUserId))
                .where(conditions.length > 0 ? and(...conditions) : undefined),
        ])
        const agg = aggRows[0]

        const byAdmin = new Map<string, number>()
        for (const { u } of rows) byAdmin.set(u.phone, (byAdmin.get(u.phone) ?? 0) + 1)

        return {
            title: 'گزارش کار ادمین‌های سطح ۲',
            subtitle,
            generatedAt,
            stats: [
                { label: 'تعداد فعالیت', value: faNum(Number(agg?.count ?? 0)) },
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
        input: AdminReportQuery,
        generatedAt: string,
        subtitle: string,
    ): Promise<AdminReportResult> {
        const conditions: SQL[] = []
        if (from) conditions.push(gte(courierDeliveries.deliveredAt, from))
        if (to) conditions.push(lte(courierDeliveries.deliveredAt, to))
        if (input.courierId) {
            // round-11 (اسکن L-8): مقدار غیر-UUID قبلاً بی‌صدا ignore می‌شد و
            // گزارشِ «همهٔ پیک‌ها» برمی‌گشت — خطای صریح، بهتر از سکوت گمراه‌کننده.
            if (!UUID_RE.test(input.courierId)) {
                throw Err.validation('شناسهٔ پیک معتبر نیست.')
            }
            conditions.push(eq(courierTrips.courierId, input.courierId as never))
        }

        // stage-55 — آمار از تجمیع SQL واقعی با همان from/joins/شرط‌ها
        // (قبلاً: rows.length و reduce روی حداکثر ۲۰۰۰ ردیف → با تحویل‌های
        // بیشتر از سقف، «مجموع مبالغ» فقط زیرمجموعه‌ی جدید را جمع می‌کرد).
        // join به courierTrips لازم است چون شرطِ پیک روی آن است. ردیف‌ها با
        // همان سقف فقط برای جدول می‌مانند. رارد C1 — ::bigint + Number()
        // (Bun.sql مقدار bigint را string برمی‌گرداند).
        const [rows, aggRows] = await Promise.all([
            this.deps.db
                .select({ d: courierDeliveries, c: couriers, displayId: orders.displayId })
                .from(courierDeliveries)
                .innerJoin(courierTrips, eq(courierTrips.id, courierDeliveries.tripId))
                .innerJoin(couriers, eq(couriers.id, courierTrips.courierId))
                .leftJoin(orders, eq(orders.id, courierDeliveries.orderId))
                .where(conditions.length > 0 ? and(...conditions) : undefined)
                .orderBy(desc(courierDeliveries.deliveredAt))
                .limit(2000),
            this.deps.db
                .select({
                    count: sql<number>`count(*)::int`,
                    total: sql<number>`coalesce(sum(${courierDeliveries.amount}), 0)::bigint`,
                })
                .from(courierDeliveries)
                .innerJoin(courierTrips, eq(courierTrips.id, courierDeliveries.tripId))
                .innerJoin(couriers, eq(couriers.id, courierTrips.courierId))
                .leftJoin(orders, eq(orders.id, courierDeliveries.orderId))
                .where(conditions.length > 0 ? and(...conditions) : undefined),
        ])
        const agg = aggRows[0]

        return {
            title: 'گزارش پیک‌ها',
            subtitle,
            generatedAt,
            stats: [
                { label: 'تعداد تحویل', value: faNum(Number(agg?.count ?? 0)) },
                { label: 'مجموع مبالغ (تومان)', value: faNum(Number(agg?.total ?? 0)) },
            ],
            tables: [
                {
                    title: 'تحویل‌ها',
                    head: ['پیک', 'سفارش', 'آدرس', 'مبلغ (تومان)', 'زمان تحویل'],
                    rows: rows.map(({ d, c, displayId }) => [
                        `${c.name} (${c.phone})`,
                        // round-11: شناسهٔ خوانا (ord-xxxxxxxx) به‌جای UUID خام
                        displayId ?? '—',
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
    ): Promise<AdminReportResult> {
        const conditions: SQL[] = []
        if (from) conditions.push(gte(coupons.createdAt, from))
        if (to) conditions.push(lte(coupons.createdAt, to))

        // stage-55 — آمار از تجمیع SQL واقعی با همان conditions (قبلاً:
        // rows.length/filter/reduce روی حداکثر ۱۰۰۰ کوپن → با کوپن‌های بیشتر
        // از سقف، آمار ناقص می‌شد). ردیف‌ها فقط برای جدول می‌مانند. رارد C1 —
        // ::bigint + Number().
        const [rows, aggRows] = await Promise.all([
            this.deps.db
                .select()
                .from(coupons)
                .where(conditions.length > 0 ? and(...conditions) : undefined)
                .orderBy(desc(coupons.createdAt))
                .limit(1000),
            this.deps.db
                .select({
                    count: sql<number>`count(*)::int`,
                    active: sql<number>`count(*) filter (where ${coupons.isActive})::int`,
                    used: sql<number>`coalesce(sum(${coupons.usedCount}), 0)::bigint`,
                })
                .from(coupons)
                .where(conditions.length > 0 ? and(...conditions) : undefined),
        ])
        const agg = aggRows[0]

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
                { label: 'تعداد کوپن', value: faNum(Number(agg?.count ?? 0)) },
                { label: 'کوپن‌های فعال', value: faNum(Number(agg?.active ?? 0)) },
                { label: 'مجموع مصرف', value: faNum(Number(agg?.used ?? 0)) },
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

    /**
     * round-17 — آمار هر کاربر با دو تجمیعِ گروه‌بندی‌شده + JOIN، نه
     * سه زیرکوئری همبسته به‌ازای هر ردیف (۲۰۰۰ کاربر × ۳ = تا ۶۰۰۰
     * زیرکوئری در هر گزارش). دقت همان است: تجمیع در SQL، معنای همان
     * عبارت‌های قبلی (سفارش غیر-لغو / پرداخت موفق / مبلغ امضادار کیف).
     */
    private async usersReport(
        from: Date | undefined,
        to: Date | undefined,
        generatedAt: string,
        subtitle: string,
    ): Promise<AdminReportResult> {
        const conditions: SQL[] = []
        if (from) conditions.push(gte(users.createdAt, from))
        if (to) conditions.push(lte(users.createdAt, to))

        // رارد M1 — تجمیع‌ها قبلاً بدون هیچ WHERE روی کل تاریخِ orders و
        // wallet_transactions می‌رفتند (هر کلیک = چند اسکن کامل). حالا به
        // بازه‌ی خودِ گزارش محدودند. رارد C1 — ::bigint + Number() در مصرف.
        const orderAggConds: SQL[] = []
        if (from) orderAggConds.push(gte(orders.createdAt, from))
        if (to) orderAggConds.push(lte(orders.createdAt, to))
        const ordersAgg = this.deps.db
            .select({
                userId: orders.userId,
                ordersCount: sql<number>`count(*) filter (where ${orders.status} <> 'CANCELED')::int`.as('orders_count'),
                totalSpent: sql<number>`coalesce(sum(${orders.totalAmount}) filter (where ${orders.paymentStatus} = 'SUCCESS' and ${orders.status} <> 'CANCELED'), 0)::bigint`.as('total_spent'),
            })
            .from(orders)
            .where(orderAggConds.length > 0 ? and(...orderAggConds) : undefined)
            .groupBy(orders.userId)
            .as('orders_agg')

        const walletAggConds: SQL[] = []
        if (from) walletAggConds.push(gte(walletTransactions.createdAt, from))
        if (to) walletAggConds.push(lte(walletTransactions.createdAt, to))
        const walletAgg = this.deps.db
            .select({
                userId: walletTransactions.userId,
                wallet: sql<number>`coalesce(sum(${signedWalletAmount}), 0)::bigint`.as('wallet'),
            })
            .from(walletTransactions)
            .where(walletAggConds.length > 0 ? and(...walletAggConds) : undefined)
            .groupBy(walletTransactions.userId)
            .as('wallet_agg')

        const rows = await this.deps.db
            .select({
                u: users,
                ordersCount: ordersAgg.ordersCount,
                totalSpent: ordersAgg.totalSpent,
                wallet: walletAgg.wallet,
            })
            .from(users)
            .leftJoin(ordersAgg, eq(ordersAgg.userId, users.id))
            .leftJoin(walletAgg, eq(walletAgg.userId, users.id))
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
                        faNum(Number(ordersCount ?? 0)),
                        faNum(Number(totalSpent ?? 0)),
                        faNum(Number(wallet ?? 0)),
                        faDate(u.createdAt),
                    ]),
                },
            ],
        }
    }

    // ══ کاربر خاص ══

    private async userReport(
        input: AdminReportQuery,
        generatedAt: string,
        from: Date | undefined,
        to: Date | undefined,
        subtitle: string,
    ): Promise<AdminReportResult> {
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

        // round-11 (اسکن M-2-web + M-1): سفارشات/تراکنش‌ها با فیلتر بازه؛
        // موجودی کیف پول با SUM روی کل ledger (قبلاً از ۲۰۰ ردیف آخر جمع می‌شد
        // و برای کاربر پرحجم غلط بود).
        const orderConds: SQL[] = [eq(orders.userId, target.id)]
        if (from) orderConds.push(gte(orders.createdAt, from))
        if (to) orderConds.push(lte(orders.createdAt, to))
        const walletConds: SQL[] = [eq(walletTransactions.userId, target.id)]
        if (from) walletConds.push(gte(walletTransactions.createdAt, from))
        if (to) walletConds.push(lte(walletTransactions.createdAt, to))

        // stage-55 — آمار سفارش کاربر از تجمیع SQL واقعی با همان orderConds
        // (قبلاً: orderRows.length و reduce روی حداکثر ۵۰۰ ردیف آخر → برای
        // کاربر پرحجم غلط بود). ردیف‌ها فقط برای جدول می‌مانند. رارد C1 —
        // ::bigint + Number() چون Bun.sql مقدار bigint را string برمی‌گرداند.
        const [orderRows, walletRows, walletTotalRow, orderAggRow] = await Promise.all([
            this.deps.db
                .select()
                .from(orders)
                .where(and(...orderConds))
                .orderBy(desc(orders.createdAt))
                .limit(500),
            this.deps.db
                .select()
                .from(walletTransactions)
                .where(and(...walletConds))
                .orderBy(desc(walletTransactions.createdAt))
                .limit(200),
            this.deps.db
                .select({
                    balance: sql<number>`coalesce(sum(${signedWalletAmount}), 0)::bigint`,
                })
                .from(walletTransactions)
                .where(eq(walletTransactions.userId, target.id))
                .then((r) => Number(r[0]?.balance ?? 0)),
            this.deps.db
                .select({
                    count: sql<number>`count(*)::int`,
                    totalSpent: sql<number>`coalesce(sum(${orders.totalAmount}) filter (where ${orders.status} <> 'CANCELED' and ${orders.paymentStatus} = 'SUCCESS'), 0)::bigint`,
                })
                .from(orders)
                .where(and(...orderConds))
                .then((r) => r[0]),
        ])

        return {
            title: `گزارش کاربر ${target.name ?? target.phone}`,
            subtitle: `موبایل: ${target.phone} — ${target.bannedAt ? 'مسدود' : 'فعال'} — ${subtitle}`,
            generatedAt,
            stats: [
                { label: 'تعداد سفارش (بازه)', value: faNum(Number(orderAggRow?.count ?? 0)) },
                { label: 'مجموع خرید (تومان)', value: faNum(Number(orderAggRow?.totalSpent ?? 0)) },
                { label: 'موجودی کیف پول (تومان)', value: faNum(walletTotalRow) },
                { label: 'تعداد ارجاع', value: faNum(referralCount) },
            ],
            tables: [
                {
                    title: 'سفارشات',
                    head: ['شناسه', 'نوع تحویل', 'وضعیت', 'مبلغ کل', 'پرداخت آنلاین', 'کیف پول', 'تخفیف', 'زمان ثبت'],
                    rows: orderRows.map((o) => [
                        o.displayId,
                        faDelivery(o.deliveryType),
                        faStatus(o.status, o.paymentStatus),
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
        input: AdminReportQuery,
        generatedAt: string,
        subtitle: string,
    ): Promise<AdminReportResult> {
        // round-11 (اسکن L-8): مقدار غیر-UUID صریحاً رد می‌شود (نه ignore بی‌صدا)
        if (input.adminUserId && !UUID_RE.test(input.adminUserId)) {
            throw Err.validation('شناسهٔ ادمین معتبر نیست.')
        }
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
        input: AdminReportQuery,
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