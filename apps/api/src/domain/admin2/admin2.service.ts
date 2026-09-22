//src/domain/admin2/admin2.service.ts
import { and, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import {
    admin2Activities,
    admin2Profiles,
    admin2Sessions,
    orders,
    users,
    type UserRow,
} from '#/infra/db/schema'
import type { AppConfig } from '#/infra/config/env'
import { Err } from '#/domain/shared/errors'
import { asUserId, type UserId } from '#/domain/shared/brand'
import type { SettingsService } from '#/domain/settings/settings.service'
import type { SseHub } from '#/infra/realtime/sse-hub'

/** ساختار scope — از دو ستون boolean */
export interface Admin2Scope {
    hall: boolean
    takeaway: boolean
}

export interface Admin2Permissions extends Admin2Scope {
    productsRead: boolean
    productsWrite: boolean
    usersRead: boolean
    usersWrite: boolean
    couriersRead: boolean
    couriersWrite: boolean
    mainCategoriesRead: boolean
    mainCategoriesWrite: boolean
    orderDetailsRead: boolean
    canToggleTemporaryClose: boolean
    canEditPackagingFee: boolean
}

export interface Admin2Public {
    userId: UserId
    phone: string
    firstName: string | null
    lastName: string | null
    isActive: boolean
    ordersConfirmed: number
    permissions: Admin2Permissions
}

/**
 * سرویس ادمین سطح ۲ — بدون تک‌نشست (چند ادمین هم‌زمان).
 *
 * لاگین: فقط با بسته‌بودنِ «ساعتی» رد می‌شود (موقت آزاد است).
 * لاگین موفق → ردیف admin2Sessions + رویداد LOGIN + اطلاعِ صفِ داخل scope.
 */
export class Admin2Service {
    constructor(
        private readonly deps: { db: Db; config: AppConfig; settings: SettingsService; hub: SseHub },
    ) { }

    // ── لاگین ──

    /** قواعد لاگین — در AuthService.loginWithOtp بعد از ساخت user صدا می‌شود */
    async assertLoginAllowed(user: UserRow): Promise<void> {
        if (user.role !== 'admin2') return
        const profile = await this.profile(user.id)
        if (!profile?.isActive) throw Err.forbidden('دسترسی این ادمین غیرفعال است.')

        const allowed = await this.deps.settings.admin2LoginAllowed()
        if (!allowed) {
            // فقط بسته‌ی ساعتی رد می‌کند؛ موقت آزاد است
            throw Err.forbidden('رستوران در ساعات کاری بسته است — ورود ادمین سطح ۲ ممکن نیست.')
        }
    }

    /** بعد از لاگین موفق — سشن + رویداد + اطلاع صفِ scope */
    async onLogin(user: UserRow): Promise<{ queueCount: number }> {
        if (user.role !== 'admin2') return { queueCount: 0 }
        const profile = await this.profile(user.id)
        if (!profile) return { queueCount: 0 }

        await this.deps.db.insert(admin2Sessions).values({
            adminUserId: asUserId(user.id),
        } as typeof admin2Sessions.$inferInsert)
        await this.log(user.id, 'LOGIN', null, {})

        // صفِ داخل scope او — «تخصیص» نیست؛ فقط نمایش
        const queueCount = await this.queueCountFor(user.id)
        return { queueCount }
    }

    /** خروج — بستن سشن باز + رویداد */
    async onLogout(user: UserRow): Promise<void> {
        if (user.role !== 'admin2') return
        const uid = asUserId(user.id)
        await this.deps.db
            .update(admin2Sessions)
            .set({ logoutAt: new Date() })
            .where(and(eq(admin2Sessions.adminUserId, uid), isNull(admin2Sessions.logoutAt)))
        await this.log(user.id, 'LOGOUT', null, {})
    }

    /** لمس فعالیت — با هر اکشن معنادار (wasActive/lastActivityAt) */
    async touchActivity(adminUserId: string): Promise<void> {
        const uid = asUserId(adminUserId)
        await this.deps.db
            .update(admin2Sessions)
            .set({ wasActive: true, lastActivityAt: new Date() })
            .where(and(eq(admin2Sessions.adminUserId, uid), isNull(admin2Sessions.logoutAt)))
    }

    // ── صف ──

    /** «صف» = PAID بدون confirmedBy — داخل scope ادمین؛ ادمین اصلی: کل صف */
    async queueCountFor(adminUserId: string, viewerRole?: string): Promise<number> {
        if (viewerRole === 'admin') {
            return this.deps.db
                .select({ count: sql<number>`count(*)::int` })
                .from(orders)
                .where(and(eq(orders.status, 'PAID'), isNull(orders.confirmedBy)))
                .then((r) => r[0]?.count ?? 0)
        }
        const scope = await this.scopeOf(adminUserId)
        if (!scope) return 0
        return this.deps.db
            .select({ count: sql<number>`count(*)::int` })
            .from(orders)
            .where(and(eq(orders.status, 'PAID'), isNull(orders.confirmedBy), this.scopeClause(scope)))
            .then((r) => r[0]?.count ?? 0)
    }

    // ── خواندن ──

    async profile(userId: string) {
        const uid = asUserId(userId)
        return this.deps.db.query.admin2Profiles.findFirst({
            where: eq(admin2Profiles.userId, uid),
        })
    }

    async scopeOf(userId: string): Promise<Admin2Scope | null> {
        const p = await this.profile(userId)
        if (!p) return null
        return { hall: p.scopeHall, takeaway: p.scopeTakeaway }
    }

    async permissionsOf(userId: string): Promise<Admin2Permissions | null> {
        const p = await this.profile(userId)
        if (!p) return null
        if (!p.isActive) throw Err.forbidden('دسترسی این ادمین غیرفعال است.')
        return {
            hall: p.scopeHall,
            takeaway: p.scopeTakeaway,
            productsRead: p.productsRead,
            productsWrite: p.productsWrite,
            usersRead: p.usersRead,
            usersWrite: p.usersWrite,
            couriersRead: p.couriersRead,
            couriersWrite: p.couriersWrite,
            mainCategoriesRead: p.mainCategoriesRead,
            mainCategoriesWrite: p.mainCategoriesWrite,
            orderDetailsRead: p.orderDetailsRead,
            canToggleTemporaryClose: p.canToggleTemporaryClose,
            canEditPackagingFee: p.canEditPackagingFee,
        }
    }

    /** لیست ادمین‌های ۲ — پنل ادمین اصلی */
    async list(): Promise<Admin2Public[]> {
        const rows = await this.deps.db
            .select({ u: users, p: admin2Profiles })
            .from(admin2Profiles)
            .innerJoin(users, eq(users.id, admin2Profiles.userId))
            .orderBy(desc(admin2Profiles.createdAt))
        return rows.map(({ u, p }) => this.toPublic(u, p))
    }

    async detail(adminUserId: string) {
        const uid = asUserId(adminUserId)
        const row = await this.deps.db
            .select({ u: users, p: admin2Profiles })
            .from(admin2Profiles)
            .innerJoin(users, eq(users.id, admin2Profiles.userId))
            .where(eq(admin2Profiles.userId, uid))
            .then((r) => r[0])
        if (!row) throw Err.notFound('ادمین سطح ۲ پیدا نشد.')
        return this.toPublic(row.u, row.p)
    }

    // ── فعالیت‌ها — گزارش کامل با فیلتر ──

    async activities(filters: {
        adminUserId?: string
        action?: string
        from?: Date
        to?: Date
        page: number
        limit: number
    }): Promise<{ activities: Array<typeof admin2Activities.$inferSelect>; total: number }> {
        const conditions = []
        if (filters.adminUserId) {
            conditions.push(eq(admin2Activities.adminUserId, asUserId(filters.adminUserId)))
        }
        if (filters.action) conditions.push(eq(admin2Activities.action, filters.action))
        if (filters.from) conditions.push(gte(admin2Activities.createdAt, filters.from))
        if (filters.to) conditions.push(lte(admin2Activities.createdAt, filters.to))
        const where = conditions.length > 0 ? and(...conditions) : undefined

        const total = await this.deps.db
            .select({ count: sql<number>`count(*)::int` })
            .from(admin2Activities)
            .where(where)
            .then((r) => r[0]?.count ?? 0)

        const activities = await this.deps.db
            .select()
            .from(admin2Activities)
            .where(where)
            .orderBy(desc(admin2Activities.createdAt))
            .limit(filters.limit)
            .offset((filters.page - 1) * filters.limit)

        return { activities, total }
    }

    /** سشن‌های یک ادمین — بخش «گزارش حضور» گسترش‌یافته */
    async sessions(adminUserId: string) {
        const uid = asUserId(adminUserId)
        return this.deps.db
            .select()
            .from(admin2Sessions)
            .where(eq(admin2Sessions.adminUserId, uid))
            .orderBy(desc(admin2Sessions.loginAt))
            .limit(100)
    }

    // ── مدیریت (ادمین اصلی) ──

    /** افزودن — user با نقش admin2 ساخته/به‌روز می‌شود + پروفایل با scope */
    async add(input: {
        phone: string
        firstName: string
        lastName: string
        scopeHall: boolean
        scopeTakeaway: boolean
    }): Promise<{ success: boolean; message?: string; userId?: string }> {
        const { db } = this.deps
        const existing = await db.query.users.findFirst({ where: eq(users.phone, input.phone) })
        if (existing) {
            if (existing.role === 'admin2') {
                return { success: false, message: 'این شماره قبلاً ادمین سطح ۲ است' }
            }
            // phase-1: ادمین اصلی هرگز demote نمی‌شود
            if (existing.role === 'admin') {
                return { success: false, message: 'ادمین اصلی قابل تبدیل به ادمین سطح ۲ نیست' }
            }
            // ارتقا: user عادی → admin2 + پروفایل
            await db.update(users).set({ role: 'admin2' }).where(eq(users.id, existing.id))
            await db
                .insert(admin2Profiles)
                .values({
                    userId: asUserId(existing.id),
                    firstName: input.firstName,
                    lastName: input.lastName,
                    scopeHall: input.scopeHall,
                    scopeTakeaway: input.scopeTakeaway,
                } as typeof admin2Profiles.$inferInsert)
                .onConflictDoNothing()
            return { success: true, userId: existing.id }
        }

        // کاربر جدید — اولین لاگین OTP خودش را می‌سازد
        // ولی ثبت‌نام ادمین۲ بدون terms منطقی است — مستقیم insert با نقش
        const [created] = await db
            .insert(users)
            .values({
                phone: input.phone,
                role: 'admin2',
                termsAcceptedAt: new Date(),
                termsVersion: '1',
            })
            .returning()
        if (!created) return { success: false, message: 'ذخیره‌سازی ناموفق بود' }

        await db.insert(admin2Profiles).values({
            userId: asUserId(created.id),
            firstName: input.firstName,
            lastName: input.lastName,
            scopeHall: input.scopeHall,
            scopeTakeaway: input.scopeTakeaway,
        } as typeof admin2Profiles.$inferInsert)

        return { success: true, userId: created.id }
    }

    async setPermissions(
        adminUserId: string,
        perms: Partial<Admin2Permissions>,
    ): Promise<void> {
        const uid = asUserId(adminUserId)
        await this.deps.db
            .update(admin2Profiles)
            .set({ ...perms, updatedAt: new Date() })
            .where(eq(admin2Profiles.userId, uid))
    }

    async toggleActive(adminUserId: string): Promise<void> {
        const uid = asUserId(adminUserId)
        const p = await this.profile(adminUserId)
        if (!p) throw Err.notFound('ادمین سطح ۲ پیدا نشد.')
        await this.deps.db
            .update(admin2Profiles)
            .set({ isActive: !p.isActive, updatedAt: new Date() })
            .where(eq(admin2Profiles.userId, uid))
    }

    // stage-10: setPackagingFee حذف شد — بسته‌بندی per-product در فرم محصول است.

    /**
     * اعلام بسته/باز موقت — ادمین اصلی یا ادمین۲ با permission.
     * round-13: علت برای «هر دو» جهت اجباری است (بسته و باز)؛ با باز شدن،
     * علت ذخیره‌شده پاک می‌شود تا متن کهنه به مشتری نشت نکند.
     */
    async setTemporaryClose(
        actorUserId: string,
        actorRole: string,
        closed: boolean,
        reason?: string | null,
    ): Promise<void> {
        const p = actorRole === 'admin2' ? await this.profile(actorUserId) : null
        if (actorRole === 'admin2' && !(p?.canToggleTemporaryClose)) {
            throw Err.forbidden('اجازه‌ی اعلام وضعیت موقت را ندارید.')
        }
        await this.deps.settings.set('temporarily_closed', closed)
        await this.deps.settings.set(
            'temporary_close_reason',
            closed ? (reason ?? '').slice(0, 120) : '',
        )
        if (actorRole === 'admin2') {
            await this.log(
                actorUserId,
                closed ? 'TEMP_CLOSE' : 'TEMP_OPEN',
                null,
                reason ? { reason } : {},
            )
        }
    }

    // ── داخلی ──

    /** شرط scope روی deliveryType */
    private scopeClause(scope: Admin2Scope) {
        if (scope.hall && scope.takeaway) return sql`true`
        if (scope.hall) return eq(orders.deliveryType, 'DINE_IN')
        if (scope.takeaway) {
            return sql`${orders.deliveryType} in ('DELIVERY', 'PICKUP')`
        }
        return sql`false` // بدون scope — هیچ
    }

    private toPublic(u: UserRow, p: typeof admin2Profiles.$inferSelect): Admin2Public {
        return {
            userId: asUserId(u.id),
            phone: u.phone,
            firstName: p.firstName,
            lastName: p.lastName,
            isActive: p.isActive,
            ordersConfirmed: p.ordersConfirmed,
            permissions: {
                hall: p.scopeHall,
                takeaway: p.scopeTakeaway,
                productsRead: p.productsRead,
                productsWrite: p.productsWrite,
                usersRead: p.usersRead,
                usersWrite: p.usersWrite,
                couriersRead: p.couriersRead,
                couriersWrite: p.couriersWrite,
                mainCategoriesRead: p.mainCategoriesRead,
                mainCategoriesWrite: p.mainCategoriesWrite,
                orderDetailsRead: p.orderDetailsRead,
                canToggleTemporaryClose: p.canToggleTemporaryClose,
                canEditPackagingFee: p.canEditPackagingFee,
            },
        }
    }

    /** رویداد — append-only */
    async log(
        adminUserId: string,
        action: string,
        orderDisplayId: string | null,
        metadata: Record<string, unknown>,
    ): Promise<void> {
        await this.deps.db.insert(admin2Activities).values({
            adminUserId: asUserId(adminUserId),
            orderDisplayId,
            action,
            metadata,
        } as typeof admin2Activities.$inferInsert)
    }
}