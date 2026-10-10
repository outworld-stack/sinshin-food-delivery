// ═══════════════════════════════════════════════════════════════
// stage-55 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/domain/admin/admin.service.ts
// وضعیت: جایگزینی کامل فایل موجود
// تغییر: ماسک شماره برای ادمین۲ + likePattern + ::bigint بدون سقف
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// round-48 — sinshin-food-delivery — فایل 12 از 97
// مسیر مقصد: apps/api/src/domain/admin/admin.service.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage forty-three
// ═════════════════════════════════════════════════════════════

// src/domain/admin/admin.service.ts
import { and, asc, desc, eq, gte, ilike, isNull, ne, or, sql } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import {
    addresses,
    admin2Profiles,
    couriers,
    deviceEvents,
    deviceIdentities,
    devices,
    orders,
    users,
    walletTransactions,
} from '#/infra/db/schema'
import { asUserId, asCourierId, asAddressId, type UserId } from '#/domain/shared/brand'
import { buildRangeCharts, currentPeriodStart, type RangeCharts } from '#/domain/shared/charts'
import { Err } from '#/domain/shared/errors'
import { signedWalletAmount } from '#/domain/shared/wallet-sql'
import { normalizePhone } from '#/domain/shared/phone'
import { likePattern, maskPhone } from '#/domain/shared/pg'
import type { AdminOrdersData, AdminStatsDto, AdminUserSort, AdminUsersData } from '@sinshin/shared'

// رارد ۴۷ — AdminUserSort به قرارداد مشترک رفت (کپی محلی حذف شد) —
// فرانت و بک‌اند حالا یک union واحد برای مرتب‌سازی کاربران دارند.

export class AdminService {
    constructor(private readonly deps: { db: Db }) { }

    // ═════════════ داشبورد ═════════════

    // رارد ۴۶ — تایپ درون‌خطی خروجی با قرارداد مشترک AdminStatsDto جایگزین شد
    // (تولیدکننده حالا تایپ‌چک می‌شود — شکل بدون تغییر)
    async getAdminStats(): Promise<AdminStatsDto> {
        const { db } = this.deps

        const [totalUsers, activeUsers, totalOrdersAgg, totalRevenueAgg, recentOrders, latestUsers, chartItems] =
            await Promise.all([
                db.select({ count: sql<number>`count(*)::int` }).from(users).then((r) => r[0]?.count ?? 0),
                db.select({ count: sql<number>`count(*)::int` }).from(users)
                    .where(isNull(users.bannedAt)).then((r) => r[0]?.count ?? 0),
                db.select({
                    count: sql<number>`count(*)::int`,
                }).from(orders)
                    .where(ne(orders.status, 'CANCELED')).then((r) => r[0] ?? { count: 0 }),
                // totalRevenue جدا:
                // رارد C1 — ::bigint (بدون سقف)؛ Number() چون Bun.sql مقدار bigint
                // را string برمی‌گرداند. الگو: live.service.ts خط 121.
                db.select({
                    revenue: sql<number>`coalesce(sum(${orders.totalAmount}), 0)::bigint`,
                }).from(orders)
                    .where(and(eq(orders.paymentStatus, 'SUCCESS'), ne(orders.status, 'CANCELED')))
                    .then((r) => Number(r[0]?.revenue ?? 0)),
                db.select({
                    id: orders.displayId,
                    user: users.phone,
                    amount: orders.totalAmount,
                    status: orders.status,
                    date: orders.createdAt,
                }).from(orders)
                    .innerJoin(users, eq(users.id, orders.userId))
                    .orderBy(desc(orders.createdAt))
                    .limit(5),
                db.select({
                    id: users.id,
                    phone: users.phone,
                    name: users.name,
                    device: sql<string>`'web'`,
                    registeredAt: users.createdAt,
                }).from(users)
                    .orderBy(desc(users.createdAt))
                    .limit(5),
                // stage-15 — چارت با معنای «بازهٔ جاری» (۶ ستونِ ۴ساعتهٔ امروز /
                // هفتهٔ شنبه‌محور / ماه و سال شمسی) از اقلام خام ساخته می‌شود؛
                // round-16 — داخل همان Promise.all (قبلاً پشتِ آن، موازی نمی‌شد)
                db.select({ date: orders.createdAt, value: orders.totalAmount })
                    .from(orders)
                    .where(and(gte(orders.createdAt, currentPeriodStart()), ne(orders.status, 'CANCELED'))),
            ])

        return {
            totalUsers,
            activeUsers,
            totalRevenue: totalRevenueAgg,
            totalOrders: totalOrdersAgg.count,
            chartData: buildRangeCharts(chartItems),
            recentOrders: recentOrders.map((r) => ({
                id: r.id,
                user: r.user,
                amount: r.amount,
                status: r.status,
                date: r.date,
            })),
            latestUsers: latestUsers.map((u) => ({
                id: asUserId(u.id),
                phone: u.phone,
                name: u.name ?? u.phone,
                device: u.device,
                registeredAt: u.registeredAt,
            })),
        }
    }

    // ═════════════ کاربران ═════════════

    async getAdminUsers(
        filters: {
            page: number
            limit: number
            search?: string
            device?: string
            status?: string
            sorts?: AdminUserSort[]
        },
        /** stage-55 — ماسک شماره برای نمای ادمین۲ (undefined = شماره کامل) */
        opts?: { maskPhones?: boolean },
    ): Promise<AdminUsersData> {
        const { db } = this.deps
        const conditions = []

        if (filters.search) {
            // stage-55 — escape wildcard جستجو (٪ و _ و \) — الگوی امنِ «شامل»
            const q = likePattern(filters.search)
            const clause = or(ilike(users.phone, q), ilike(users.name, q))
            if (clause) conditions.push(clause)
        }
        if (filters.status && filters.status !== 'all') {
            if (filters.status === 'ACTIVE') {
                conditions.push(isNull(users.bannedAt))
            } else if (filters.status === 'SUSPENDED') {
                conditions.push(sql`${users.bannedAt} is not null`)
            }
        }

        const where = conditions.length > 0 ? and(...conditions) : undefined

        // رارد M2 — سورت روی walletBalance/totalSpent قبلاً زیرکوئریِ همبسته به‌ازای
        // هر کاربر منطبق بود (۵ هزار کاربر = ۵ هزار SUM در هر درخواست). حالا دو
        // تجمیعِ گروه‌بندی‌شده یک‌بار محاسبه و LEFT JOIN می‌شوند — همان الگوی
        // usersReport در report-query.service.ts. ::bigint برای رارد C1.
        const walletAgg = db
            .select({
                userId: walletTransactions.userId,
                balance: sql<number>`coalesce(sum(${signedWalletAmount}), 0)::bigint`.as('balance'),
            })
            .from(walletTransactions)
            .groupBy(walletTransactions.userId)
            .as('wallet_agg')

        const spentAgg = db
            .select({
                userId: orders.userId,
                total: sql<number>`coalesce(sum(${orders.totalAmount}) filter (where ${orders.paymentStatus} = 'SUCCESS' and ${orders.status} <> 'CANCELED'), 0)::bigint`.as('total'),
            })
            .from(orders)
            .groupBy(orders.userId)
            .as('spent_agg')

        // Sort
        let orderBy
        if (filters.sorts && filters.sorts.length > 0) {
            const sort = filters.sorts[0]!
            const col = sort.field === 'walletBalance'
                ? sql`coalesce(${walletAgg.balance}, 0)`
                : sort.field === 'totalSpent'
                    ? sql`coalesce(${spentAgg.total}, 0)`
                    : users.createdAt
            orderBy = sort.dir === 'asc' ? sql`${col} asc` : sql`${col} desc`
        } else {
            orderBy = desc(users.createdAt)
        }

        // رارد M5 — سقف دفاعی: page=999999 یعنی اسکن ~۱۰۰M ردیف در PG
        const page = Math.min(Math.max(1, filters.page || 1), 500)
        const limit = Math.min(Math.max(1, filters.limit || 20), 100)

        const total = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(users)
            .where(where)
            .then((r) => r[0]?.count ?? 0)

        const rows = await db
            .select({
                id: users.id,
                name: users.name,
                phone: users.phone,
                bannedAt: users.bannedAt,
                createdAt: users.createdAt,
                // رارد M2 — ستون‌های تجمیع از همان JOIN (bigint → Number پایین‌تر)
                balance: walletAgg.balance,
                spentTotal: spentAgg.total,
                // stage-10: آیکون مسدودسازی ادمین اصلی در فرانت غیرفعال می‌شود
                role: users.role,
            })
            .from(users)
            .leftJoin(walletAgg, eq(walletAgg.userId, users.id))
            .leftJoin(spentAgg, eq(spentAgg.userId, users.id))
            .where(where)
            .orderBy(orderBy)
            .limit(limit)
            .offset((page - 1) * limit)

        // رارد M2 — موجودی و مجموع خرید از همان JOIN بالا می‌آیند؛ دو کوئریِ
        // batch اضافی حذف شد. Number() برای bigint (رارد C1).

        return {
            users: rows.map((r) => {
                // device از sessions
                return {
                    id: asUserId(r.id),
                    firstName: r.name?.split(' ')[0] ?? null,
                    lastName: r.name?.split(' ').slice(1).join(' ') || null,
                    // stage-55 — شماره‌ی کامل فقط برای ادمین اصلی؛ ادمین۲ ماسک
                    phone: opts?.maskPhones ? maskPhone(r.phone) : r.phone,
                    device: '—',
                    status: r.bannedAt ? 'SUSPENDED' : 'ACTIVE',
                    walletBalance: Number(r.balance ?? 0),
                    totalSpent: Number(r.spentTotal ?? 0),
                    registeredAt: r.createdAt,
                    role: r.role,
                }
            }),
            total,
        }
    }

    /** stage-55 — opts.maskPhones: ماسک شماره‌ی کاربر/معرف‌ها برای ادمین۲ */
    async getAdminUserDetails(userId: string, opts?: { maskPhones?: boolean }): Promise<{
        id: UserId
        phone: string
        referralCode: string | null
        name: string | null
        email: string | null
        status: string
        device: string
        registeredAt: Date
        walletBalance: number
        totalSpent: number
        referralsCount: number
        referrerId: UserId | null
        devices: Array<{ id: string; name: string; platform: string | null; lastActiveAt: Date; isCurrent: boolean }>
        orders: Array<{ id: string; date: Date; amount: number; status: string; addressId: string | null }>
        referrals: Array<{ id: UserId; phone: string; registeredAt: Date; totalOrders: number }>
        addresses: Array<{ id: string; address: string; lat: number; lng: number; orderCount: number }>
        logs: Array<{ id: string; type: string; action: string; timestamp: Date }>
        chartData: RangeCharts
    } | null> {
        const { db } = this.deps
        const uid = asUserId(userId)

        const user = await db.query.users.findFirst({ where: eq(users.id, uid) })
        if (!user) return null

        const [walletRow, spentRow, referralCount, deviceRows, orderRows, refRows, addressRows, eventRows] =
            await Promise.all([
                // رارد C1 — bigint بدون سقف؛ Number() چون Bun.sql مقدار bigint
                // را string برمی‌گرداند (الگو: live.service.ts).
                db.select({
                    balance: sql<number>`sum(${signedWalletAmount})::bigint`,
                }).from(walletTransactions).where(eq(walletTransactions.userId, uid)).then((r) => Number(r[0]?.balance ?? 0)),

                // رارد C1 — هم‌الگوی کیف پول بالا
                db.select({
                    total: sql<number>`coalesce(sum(${orders.totalAmount}), 0)::bigint`,
                }).from(orders)
                    .where(and(eq(orders.userId, uid), eq(orders.paymentStatus, 'SUCCESS'), ne(orders.status, 'CANCELED')))
                    .then((r) => Number(r[0]?.total ?? 0)),

                db.select({ count: sql<number>`count(*)::int` }).from(users)
                    .where(eq(users.referredBy, uid)).then((r) => r[0]?.count ?? 0),

                db.select({
                    id: devices.id,
                    name: devices.label,
                    platform: devices.platform,
                    lastActiveAt: devices.lastSeenAt,
                }).from(deviceIdentities)
                    .innerJoin(devices, eq(devices.id, deviceIdentities.deviceId))
                    .where(eq(deviceIdentities.phone, user.phone)),

                db.select({
                    id: orders.displayId,
                    date: orders.createdAt,
                    amount: orders.totalAmount,
                    status: orders.status,
                    addressId: orders.addressId,
                }).from(orders).where(eq(orders.userId, uid))
                    .orderBy(desc(orders.createdAt)).limit(25),

                db.select({
                    id: users.id,
                    phone: users.phone,
                    registeredAt: users.createdAt,
                }).from(users).where(eq(users.referredBy, uid)),

                db.select({
                    id: addresses.id,
                    address: addresses.address,
                    lat: addresses.lat,
                    lng: addresses.lng,
                }).from(addresses).where(eq(addresses.userId, uid)),

                db.select().from(deviceEvents)
                    .where(eq(deviceEvents.phone, user.phone))
                    .orderBy(desc(deviceEvents.createdAt))
                    .limit(50),
            ])

        // شمار سفارش‌ها به‌ازای آدرس
        const addressOrderCounts = await db
            .select({
                addressId: orders.addressId,
                count: sql<number>`count(*)::int`,
            })
            .from(orders)
            .where(eq(orders.userId, uid))
            .groupBy(orders.addressId)
        const addrCountMap = new Map(
            addressOrderCounts
                .filter((r) => r.addressId !== null)
                .map((r) => [r.addressId!, r.count]),
        )

        // رارد ۴۸ (اسکن C3) — چارت فقط بازه‌ی جاری را می‌خواند (سند charts)؛
        // بدون این کران، کل تاریخچه‌ی سفارش کاربر برای نموداری که داده‌های
        // قدیمی‌تر را دور می‌ریخت واکشی می‌شد (کاربر ۸۰۰ سفارشی = ۸۰۰ ردیف).
        const chartOrders = await db
            .select({ date: orders.createdAt, value: orders.totalAmount })
            .from(orders)
            .where(and(eq(orders.userId, uid), gte(orders.createdAt, currentPeriodStart())))

        return {
            id: uid,
            // stage-55 — شماره‌ی کامل فقط برای ادمین اصلی؛ نمای ادمین۲ ماسک
            phone: opts?.maskPhones ? maskPhone(user.phone) : user.phone,
            referralCode: user.referralCode,
            name: user.name,
            email: user.email,
            status: user.bannedAt ? 'SUSPENDED' : 'ACTIVE',
            device: '—',
            registeredAt: user.createdAt,
            walletBalance: walletRow,
            totalSpent: spentRow,
            referralsCount: referralCount,
            referrerId: user.referredBy ? asUserId(user.referredBy) : null,
            devices: deviceRows.map((d) => ({
                id: d.id,
                name: d.name ?? 'دستگاه',
                platform: d.platform,
                lastActiveAt: d.lastActiveAt,
                isCurrent: false,
            })),
            orders: orderRows.map((o) => ({
                id: o.id,
                date: o.date,
                amount: o.amount,
                status: o.status,
                addressId: o.addressId,
            })),
            referrals: refRows.map((r) => ({
                id: asUserId(r.id),
                // stage-55 — شماره‌ی معرف‌ها هم در نمای ادمین۲ ماسک می‌شود
                phone: opts?.maskPhones ? maskPhone(r.phone) : r.phone,
                registeredAt: r.registeredAt,
                totalOrders: 0, // ساده — گسترش بعدی
            })),
            addresses: addressRows.map((a) => ({
                id: a.id,
                address: a.address,
                lat: a.lat,
                lng: a.lng,
                orderCount: addrCountMap.get(a.id) ?? 0,
            })),
            logs: eventRows.map((e) => ({
                id: e.id,
                type: e.event,
                action: e.ip ? `IP: ${e.ip}` : 'بدون IP',
                timestamp: e.createdAt,
            })),
            chartData: buildRangeCharts(chartOrders),
        }
    }

    async toggleUserStatus(userId: string, actorRole: string): Promise<void> {
        const { db } = this.deps
        const uid = asUserId(userId)
        const user = await db.query.users.findFirst({
            where: eq(users.id, uid),
            columns: { bannedAt: true, role: true },
        })
        // round-11 (اسکن L-3): کاربر ناموجود قبلاً بی‌صدا 200 برمی‌گرداند و
        // روتِ ممیزیِ فانتوم (USER_TOGGLE روی هیچ) ثبت می‌کرد — notFound صریح.
        if (!user) throw Err.notFound('کاربر پیدا نشد.')
        // phase-3.5: ادمین۲ (حتی با usersWrite) فقط کاربر عادی را مسدود می‌کند
        if (actorRole === 'admin2' && user.role !== 'user') {
            throw Err.forbidden('تغییر وضعیت ادمین‌ها فقط توسط ادمین اصلی')
        }
        // stage-10: حساب ادمین اصلی اصلاً قابل تغییر وضعیت نیست —
        // حتی توسط خودش (روت لایه‌ی اول را می‌گیرد؛ این لایه‌ی دوم است)
        if (user.role === 'admin') {
            throw Err.forbidden('حساب ادمین اصلی قابل مسدودسازی نیست.')
        }
        await db
            .update(users)
            .set({ bannedAt: user.bannedAt ? null : new Date(), updatedAt: new Date() })
            .where(eq(users.id, uid))
    }

    // ═══ phase-3.5: اکشن‌هایی که فرانت از قبل صدا می‌زد — روت‌ها نبودند! ═══

    /** تلفن کاربر — برای ترمینیت دستگاه توسط ادمین */
    async getUserPhone(userId: string): Promise<string | null> {
        const u = await this.deps.db.query.users.findFirst({
            where: eq(users.id, asUserId(userId)),
            columns: { phone: true },
        })
        return u?.phone ?? null
    }


    /** ویرایش name/email/phone/referralCode — phone و referralCode فقط ادمین اصلی */
    async updateAdminUser(
        userId: string,
        input: {
            firstName?: string
            lastName?: string
            email?: string | null
            phone?: string
            referralCode?: string
        },
        actorRole: string,
    ): Promise<void> {
        const uid = asUserId(userId)
        const user = await this.deps.db.query.users.findFirst({
            where: eq(users.id, uid),
            columns: { role: true, phone: true, referralCode: true },
        })
        if (!user) throw Err.notFound('کاربر پیدا نشد.')
        if (actorRole === 'admin2' && user.role !== 'user') {
            throw Err.forbidden('ویرایش ادمین‌ها فقط توسط ادمین اصلی')
        }

        const patch: {
            name?: string | null
            email?: string | null
            phone?: string
            referralCode?: string
        } = {}

        if (input.firstName !== undefined || input.lastName !== undefined) {
            patch.name =
                [input.firstName?.trim(), input.lastName?.trim()].filter(Boolean).join(' ') || null
        }
        if (input.email !== undefined) patch.email = input.email?.trim() || null

        // phase-3.5: شماره موبایل — هویتِ ورود؛ فقط ادمین اصلی + یکتایی
        if (input.phone !== undefined && input.phone.trim() !== '') {
            if (actorRole !== 'admin') {
                throw Err.forbidden('تغییر شماره موبایل فقط توسط ادمین اصلی')
            }
            const normalized = normalizePhone(input.phone)
            if (!normalized) throw Err.validation('شماره موبایل معتبر نیست (09xxxxxxxxx).')
            if (normalized !== user.phone) {
                const clash = await this.deps.db.query.users.findFirst({
                    where: eq(users.phone, normalized),
                })
                if (clash && clash.id !== uid) {
                    throw Err.conflict('این شماره موبایل قبلاً برای کاربر دیگری ثبت شده است.')
                }
                patch.phone = normalized
            }
        }

        // phase-3.5: کد معرف — سیستم پولی معرفی؛ فقط ادمین اصلی + یکتایی
        if (input.referralCode !== undefined && input.referralCode.trim() !== '') {
            if (actorRole !== 'admin') {
                throw Err.forbidden('تغییر کد معرف فقط توسط ادمین اصلی')
            }
            const clean = input.referralCode.trim()
            if (!/^[A-Za-z0-9_-]{3,16}$/.test(clean)) {
                throw Err.validation('کد معرف فقط حروف، رقم و خط تیره (۳ تا ۳۲ کاراکتر).')
            }
            if (clean !== user.referralCode) {
                const clash = await this.deps.db.query.users.findFirst({
                    where: eq(users.referralCode, clean),
                })
                if (clash && clash.id !== uid) {
                    throw Err.conflict('این کد معرف قبلاً برای کاربر دیگری ثبت شده است.')
                }
                patch.referralCode = clean
            }
        }

        if (Object.keys(patch).length === 0) return
        await this.deps.db.update(users).set(patch).where(eq(users.id, uid))
    }


    /** حذف آدرس — scoped به همان کاربر (FK سفارشات SET NULL؛ تصویر لحظه‌ای می‌ماند) */
    async deleteUserAddress(userId: string, addressId: string): Promise<void> {
        await this.deps.db
            .delete(addresses)
            .where(and(eq(addresses.id, asAddressId(addressId)), eq(addresses.userId, asUserId(userId))))
    }

    // ═════════════ سفارشات ادمین ═════════════

    // رارد ۴۶ — تایپ درون‌خطیِ خروجی با قرارداد مشترک AdminOrdersData جایگزین شد؛
    // فیلدهای note این سرویس required بودند و در قرارداد optional اند — جهت
    // انتساب بی‌صدا مشکلی نیست (required → optional همیشه مجاز است).
    async getAdminOrders(
        filters: {
            page: number
            limit: number
            search?: string
            status?: string
            sortDate?: string
            sortAmount?: string
            confirmedBy?: string
            courierId?: string
        },
        /** stage-55 — ماسک شماره‌ی مشتری برای نمای ادمین۲ */
        opts?: { maskPhones?: boolean },
    ): Promise<AdminOrdersData> {
        const { db } = this.deps
        const conditions = []

        if (filters.search) {
            // stage-55 — escape wildcard جستجو (٪ و _ و \) — الگوی امنِ «شامل»
            const q = likePattern(filters.search)
            const clause = or(ilike(orders.displayId, q), ilike(users.phone, q))
            if (clause) conditions.push(clause)
        }
        if (filters.status && filters.status !== 'all') {
            conditions.push(eq(orders.status, filters.status as 'PAID'))
        }
        // ⬅ phase-3: فیلترهای قبلاً no-op
        if (filters.confirmedBy && filters.confirmedBy !== 'all') {
            conditions.push(eq(orders.confirmedBy, filters.confirmedBy))
        }
        if (filters.courierId && filters.courierId !== 'all') {
            conditions.push(eq(orders.courierId, asCourierId(filters.courierId)))
        }

        const where = conditions.length > 0 ? and(...conditions) : undefined

        // رارد M5 — سقف دفاعی صفحه (جلوی page=999999 و limit غول‌پیکر)
        const page = Math.min(Math.max(1, filters.page || 1), 500)
        const limit = Math.min(Math.max(1, filters.limit || 20), 100)

        // ⬅ phase-3: سورت واقعی (قبلاً همیشه createdAt desc)
        const orderBy =
            filters.sortAmount === 'highest'
                ? desc(orders.totalAmount)
                : filters.sortAmount === 'lowest'
                    ? asc(orders.totalAmount)
                    : filters.sortDate === 'oldest'
                        ? asc(orders.createdAt)
                        : desc(orders.createdAt)

        const total = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(orders)
            .innerJoin(users, eq(users.id, orders.userId))
            .where(where)
            .then((r) => r[0]?.count ?? 0)

        // ⬅ phase-3: نام واقعی تاییدکننده/پیک با LEFT JOIN
        const rows = await db
            .select({
                id: orders.displayId,
                userPhone: users.phone,
                userName: users.name,
                amount: orders.totalAmount,
                date: orders.createdAt,
                status: orders.status,
                customerNote: orders.customerNote,
                confirmedFirst: admin2Profiles.firstName,
                confirmedLast: admin2Profiles.lastName,
                courierName: couriers.name,
            })
            .from(orders)
            .innerJoin(users, eq(users.id, orders.userId))
            .leftJoin(admin2Profiles, eq(admin2Profiles.userId, orders.confirmedBy))
            .leftJoin(couriers, eq(couriers.id, orders.courierId))
            .where(where)
            .orderBy(orderBy)
            .limit(limit)
            .offset((page - 1) * limit)

        return {
            orders: rows.map((r) => {
                // stage-55 — شماره‌ی کامل مشتری فقط برای ادمین اصلی؛ نمای
                // ادمین۲ ماسک می‌شود (حتی در fallback نام).
                const userPhone = opts?.maskPhones ? maskPhone(r.userPhone) : r.userPhone
                return {
                    id: r.id,
                    userPhone,
                    userName: r.userName ?? userPhone,
                    amount: r.amount,
                    date: r.date,
                    status: r.status,
                    customerNote: r.customerNote,
                    confirmedByName:
                        r.confirmedFirst || r.confirmedLast
                            ? `${r.confirmedFirst ?? ''} ${r.confirmedLast ?? ''}`.trim()
                            : null,
                    courierName: r.courierName ?? null,
                }
            }),
            total,
        }
    }
}