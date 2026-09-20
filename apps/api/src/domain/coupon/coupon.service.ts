//src/domain/coupon/coupon.service.ts
import { and, desc, eq, isNull, sql } from 'drizzle-orm'

import type { Db, DbOrTx } from '#/infra/db/client'
import {
  couponConditions,
  couponGrants,
  coupons,
} from '#/infra/db/schema'
import { asCampaignId, type CampaignId } from '#/domain/shared/brand'
import { buildUserCondition, type ConditionType } from './coupon-evaluators'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export interface CouponWithConditions {
  coupon: typeof coupons.$inferSelect
  conditions: Array<{ id: string; type: ConditionType; params: Record<string, unknown> }>
}

export class CouponService {
  constructor(private readonly deps: { db: Db }) { }

  // ══ اعطا ══

  /**
   * اعطای لحظه‌ای — در settle هر سفارش صدا می‌شود (همان tx).
   * برای هر کوپن خصوصیِ فعال: همه‌ی شرط‌ها → grant (یک‌بار، unique).
   */
  async grantIfEligible(tx: DbOrTx, userId: string): Promise<number> {
    const active = await tx
      .select()
      .from(coupons)
      .where(
        and(
          eq(coupons.isActive, true),
          eq(coupons.isPublic, false),
          sql`(${coupons.startsAt} <= now())`,
          sql`(${coupons.endsAt} is null or ${coupons.endsAt} > now())`,
        ),
      )

    if (active.length === 0) return 0

    const ctx = { db: this.deps.db, userId, now: new Date() }
    let granted = 0

    for (const coupon of active) {
      const conds = await tx
        .select()
        .from(couponConditions)
        .where(eq(couponConditions.couponId, coupon.id))

      if (conds.length === 0) continue

      const built = buildUserCondition(
        ctx,
        conds.map((c) => ({
          type: c.type as ConditionType,
          params: (c.params ?? {}) as Record<string, unknown>,
        })),
      )

      const eligible = await tx
        .select({ ok: sql<boolean>`${built.allSatisfied}` })
        .from(sql`users u`)
        .where(sql`u.id = ${userId}::uuid`)
        .then((rows) => rows[0]?.ok === true)

      if (!eligible) continue

      const inserted = await tx
        .insert(couponGrants)
        .values({ couponId: coupon.id, userId })
        .onConflictDoNothing()
        .returning({ id: couponGrants.id })
      if (inserted.length > 0) granted++
    }

    return granted
  }

  // ══ اعتبار در چک‌اوت ══

  async findUsableCoupon(
    tx: DbOrTx,
    userId: string,
    code: string,
  ): Promise<typeof coupons.$inferSelect | null> {
    const clean = code.trim().toUpperCase().slice(0, 32)
    const coupon = (await tx.select().from(coupons).where(eq(coupons.code, clean)))[0]
    if (!coupon) return null

    const now = Date.now()
    if (!coupon.isActive) return null
    if (coupon.startsAt.getTime() > now) return null
    if (coupon.endsAt !== null && coupon.endsAt.getTime() <= now) return null

    if (coupon.isPublic) return coupon

    const grant = await tx
      .select()
      .from(couponGrants)
      .where(
        and(
          eq(couponGrants.couponId, coupon.id),
          eq(couponGrants.userId, userId),
          isNull(couponGrants.consumedAt),
        ),
      )
      .then((rows) => rows[0])
    return grant ? coupon : null
  }

  /**
 * phase-fix — رزرو گرنت کوپن خصوصی، در همان tx چک‌اوت.
 * اتمیک: UPDATE ... WHERE consumedAt IS NULL — فقط یکی از دو چک‌اوت
 * موازی برنده می‌شود؛ بازنده خطا می‌گیرد (نه اینکه هر دو تخفیف ببرند).
 * آزادسازی در failPayment / refund انجام می‌شود.
 */
  async reserveGrant(tx: DbOrTx, couponId: CampaignId, userId: string): Promise<boolean> {
    const rows = await tx
      .update(couponGrants)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(couponGrants.couponId, couponId),
          eq(couponGrants.userId, userId),
          isNull(couponGrants.consumedAt),
        ),
      )
      .returning({ id: couponGrants.id })
    return rows.length > 0
  }

  /** آزادسازی گرنت — در failPayment / refund (برگرداندن به قابل‌استفاده) */
  async releaseGrant(tx: DbOrTx, couponId: CampaignId, userId: string): Promise<void> {
    await tx
      .update(couponGrants)
      .set({ consumedAt: null })
      .where(
        and(
          eq(couponGrants.couponId, couponId),
          eq(couponGrants.userId, userId),
        ),
      )
  }


  /** مصرف گرنت — در settle؛ اتمیک با پول */
  async consumeGrant(tx: DbOrTx, couponId: CampaignId, userId: string): Promise<void> {
    await tx
      .update(couponGrants)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(couponGrants.couponId, couponId),
          eq(couponGrants.userId, userId),
          isNull(couponGrants.consumedAt),
        ),
      )
  }

  // ══ اسکن شبانه ══

  async findNudgeCandidates(couponId: CampaignId): Promise<
    Array<{ userId: string; phone: string; missingCount: number }>
  > {
    const conds = await this.deps.db
      .select()
      .from(couponConditions)
      .where(eq(couponConditions.couponId, couponId))
    if (conds.length === 0) return []

    const ctx = { db: this.deps.db, userId: '', now: new Date() }
    const built = buildUserCondition(
      ctx,
      conds.map((c) => ({
        type: c.type as ConditionType,
        params: (c.params ?? {}) as Record<string, unknown>,
      })),
    )

    return this.deps.db
      .select({
        userId: sql<string>`u.id`,
        phone: sql<string>`u.phone`,
        missingCount: sql<number>`(${built.totalConditions} - ${built.satisfiedCount})`,
      })
      .from(sql`users u`)
      .where(
        sql`${built.allButOne}
             and not ${built.allSatisfied}
             and u.banned_at is null
             and not exists (
               select 1 from coupon_grants g
               where g.coupon_id = ${couponId}::uuid and g.user_id = u.id
             )`,
      )
      .limit(5000)
  }

  // ══ CRUD ادمین ══

  async list(): Promise<CouponWithConditions[]> {
    const rows = await this.deps.db.select().from(coupons).orderBy(desc(coupons.createdAt))
    const out: CouponWithConditions[] = []
    for (const c of rows) {
      out.push({ coupon: c, conditions: await this.conditionsOf(c.id) })
    }
    return out
  }

  async create(input: {
    code: string
    title?: string | null
    discountPercentage: number
    maxUses: number
    isPublic: boolean
    expiryDate: string | null
    rules: Array<{ type: string; params: Record<string, unknown> }>
  }): Promise<{ success: boolean; message?: string; id?: string }> {
    const code = input.code.trim().toUpperCase().slice(0, 32)
    if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
      return { success: false, message: 'کد تخفیف فقط حروف بزرگ، رقم و خط تیره (۳-۳۲)' }
    }
    if (input.discountPercentage < 1 || input.discountPercentage > 99) {
      return { success: false, message: 'درصد تخفیف باید بین ۱ تا ۹۹ باشد' }
    }
    const clash = await this.deps.db.query.coupons.findFirst({ where: eq(coupons.code, code) })
    if (clash) return { success: false, message: 'این کد قبلاً ثبت شده است' }

    const [created] = await this.deps.db
      .insert(coupons)
      .values({
        code,
        title: input.title ?? null,
        discountPercentage: input.discountPercentage,
        maxUses: input.maxUses,
        isPublic: input.isPublic,
        isActive: true,
        ...(input.expiryDate ? { endsAt: new Date(input.expiryDate) } : {}),
      })
      .returning()
    if (!created) return { success: false, message: 'ذخیره‌سازی ناموفق بود' }

    for (const rule of input.rules) {
      await this.deps.db.insert(couponConditions).values({
        couponId: created.id,
        type: rule.type as never,
        params: rule.params,
      })
    }

    return { success: true, id: created.id }
  }

  /** phase-5: ویرایش — کوپن + جایگزینی شرط‌ها (حذف+اینسرت؛ nudges با cascade می‌روند) */
  async update(
    id: string,
    input: {
      code: string
      title?: string | null
      discountPercentage: number
      maxUses: number
      isPublic: boolean
      expiryDate: string | null
      rules: Array<{ type: string; params: Record<string, unknown> }>
    },
  ): Promise<{ success: boolean; message?: string }> {
    const { db } = this.deps
    const code = input.code.trim().toUpperCase().slice(0, 16)
    if (!/^[A-Z0-9_-]{3,16}$/.test(code)) {
      return { success: false, message: 'کد تخفیف فقط حروف بزرگ، رقم و خط تیره (۳-۱۶)' }
    }
    if (input.discountPercentage < 1 || input.discountPercentage > 99) {
      return { success: false, message: 'درصد تخفیف باید بین ۱ تا ۹۹ باشد' }
    }
    const clash = await db.query.coupons.findFirst({ where: eq(coupons.code, code) })
    if (clash && clash.id !== id) {
      return { success: false, message: 'این کد قبلاً ثبت شده است' }
    }

    const cid = asCampaignId(id)
    const [updated] = await db
      .update(coupons)
      .set({
        code,
        title: input.title ?? null,
        discountPercentage: input.discountPercentage,
        maxUses: input.maxUses,
        isPublic: input.isPublic,
        ...(input.expiryDate ? { endsAt: new Date(input.expiryDate) } : { endsAt: null }),
      })
      .where(eq(coupons.id, cid))
      .returning()
    if (!updated) return { success: false, message: 'کوپن پیدا نشد' }

    await db.delete(couponConditions).where(eq(couponConditions.couponId, cid))
    for (const rule of input.rules) {
      await db.insert(couponConditions).values({
        couponId: cid,
        type: rule.type as never,
        params: rule.params,
      })
    }
    return { success: true }
  }

  /**
   * phase-fix — حذفِ سخت ممنوع: سفارش‌های در پرواز (PENDING_PAYMENT) به
   * couponId اشاره می‌کنند و درج redemption در settle با FK می‌شکند و
   * سفارشِ «پول‌گرفته‌شده» برای همیشه گیر می‌کند. حذف = غیرفعال‌سازی.
   */
  async remove(id: string): Promise<{ success: boolean; message?: string }> {
    if (!UUID_RE.test(id)) return { success: false, message: 'شناسه معتبر نیست' }
    const couponId = asCampaignId(id)
    const updated = await this.deps.db
      .update(coupons)
      .set({ isActive: false })
      .where(eq(coupons.id, couponId))
      .returning({ id: coupons.id })
    if (updated.length === 0) return { success: false, message: 'کوپن پیدا نشد' }
    return { success: true, message: 'کوپن غیرفعال شد' }
  }

  // ══ داخلی ══

  private async conditionsOf(couponId: CampaignId) {
    const rows = await this.deps.db
      .select()
      .from(couponConditions)
      .where(eq(couponConditions.couponId, couponId))
    return rows.map((r) => ({
      id: r.id,
      type: r.type as ConditionType,
      params: (r.params ?? {}) as Record<string, unknown>,
    }))
  }
}