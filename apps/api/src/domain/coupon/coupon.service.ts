//src/domain/coupon/coupon.service.ts
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'

import type { Db, DbOrTx } from '#/infra/db/client'
import {
  couponConditions,
  couponGrants,
  coupons,
} from '#/infra/db/schema'
import { asCampaignId, type CampaignId } from '#/domain/shared/brand'
import { Err } from '#/domain/shared/errors'
import { buildUserCondition, type ConditionType } from './coupon-evaluators'
import { UUID_RE } from '#/domain/shared/ids'


// رارد ۴۷ — شکل سیم این خروجی = CouponWithConditionsDto در قرارداد مشترک؛
// ردیف خام دیتابیس مستقیم برمی‌گردد (createdAt هم روی سیم هست و از رارد ۴۷
// در قرارداد دیده می‌شود) و تاریخ‌ها پس از سریال‌سازی ISO می‌شوند.
export interface CouponWithConditions {
  coupon: typeof coupons.$inferSelect
  conditions: Array<{ id: string; type: ConditionType; params: Record<string, unknown> }>
  /** phase-9: شمارش گیرندگان (coupon_grants) — برای لیست/جزئیات ادمین */
  recipientsCount: number
}

export class CouponService {
  constructor(private readonly deps: { db: Db }) { }

  // ══ اعطا ══

  /**
   * اعطای لحظه‌ای — در تسویه هر سفارش صدا می‌شود (همان tx).
   * برای هر کوپن خصوصیِ فعال: همه‌ی شرط‌ها → grant (یک‌بار، یکتا).
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

    // رارد ۴۸ (اسکن C1) — این مسیر داخل tx تسویه‌ی هر پرداخت موفق و زیر
    // قفل ردیف کاربر اجرا می‌شود؛ قبلاً ۱+۳K کوئری به‌ازای K کوپن فعال بود.
    // شرط‌ها حالا با یک کوئریِ inArray گروه می‌شوند و کوپن‌هایی که از قبل
    // grant دارند (درجِ تکراری جز عمل بی‌اثر چیزی نمی‌کرد)
    // از همان اول skip می‌شوند. کوئری واجدشرط‌ها هر کوپن مستقل می‌ماند
    // (ترکیب چند کوپن در یک SQL ریسک رفتاری دارد — عمداً انجام نشد).
    const activeIds = active.map((c) => c.id)
    const [allConds, grantedRows] = await Promise.all([
      tx
        .select()
        .from(couponConditions)
        .where(inArray(couponConditions.couponId, activeIds)),
      tx
        .select({ couponId: couponGrants.couponId })
        .from(couponGrants)
        .where(and(inArray(couponGrants.couponId, activeIds), eq(couponGrants.userId, userId))),
    ])
    const condsByCoupon = new Map<string, Array<typeof couponConditions.$inferSelect>>()
    for (const c of allConds) {
      const list = condsByCoupon.get(c.couponId as string) ?? []
      list.push(c)
      condsByCoupon.set(c.couponId as string, list)
    }
    const alreadyGranted = new Set(grantedRows.map((r) => r.couponId as string))

    const ctx = { db: this.deps.db, userId, now: new Date() }
    let granted = 0

    for (const coupon of active) {
      const conds = condsByCoupon.get(coupon.id as string) ?? []

      if (conds.length === 0) continue
      if (alreadyGranted.has(coupon.id as string)) continue

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

  /**
   * رارد M9 — اعطای کوپن بعد از commit: با tx خودش، بیرون از قفلِ کاربرِ
   * چک‌اوت/تسویه. یکتایی گرنت با grants_coupon_user_key + onConflictDoNothing
   * تضمین شده است → تکرارناپذیر و بی‌خطر (صدا زدن دوباره فقط no-op است).
   */
  async grantIfEligibleAfterCommit(userId: string): Promise<number> {
    return this.deps.db.transaction((tx) => this.grantIfEligible(tx, userId))
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
 * آزادسازی در failPayment / بازپرداخت انجام می‌شود.
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

  /** آزادسازی گرنت — در failPayment / بازپرداخت (برگرداندن به قابل‌استفاده) */
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


  /** مصرف گرنت — در تسویه؛ اتمیک با پول */
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

  /** phase-9: شمارش گیرندگان چند کوپن با یک کوئری گروهی */
  private async recipientsCounts(couponIds: CampaignId[]): Promise<Map<string, number>> {
    if (couponIds.length === 0) return new Map()
    const rows = await this.deps.db
      .select({ couponId: couponGrants.couponId, count: sql<number>`count(*)::int` })
      .from(couponGrants)
      .where(inArray(couponGrants.couponId, couponIds))
      .groupBy(couponGrants.couponId)
    return new Map(rows.map((r) => [r.couponId as string, r.count]))
  }

  async list(): Promise<CouponWithConditions[]> {
    const rows = await this.deps.db.select().from(coupons).orderBy(desc(coupons.createdAt))
    // رارد ۴۸ (اسکن C4) — شرط‌ها هم مثل recipientsCounts (phase-9) دسته‌ای
    // کشیده می‌شوند؛ قبلاً ۲+N کوئری در هر بازدید صفحه‌ی کوپن‌ها بود.
    const [counts, conditionsByCoupon] = await Promise.all([
      this.recipientsCounts(rows.map((r) => r.id)),
      this.conditionsOfMany(rows.map((r) => r.id)),
    ])
    return rows.map((c) => ({
      coupon: c,
      conditions: conditionsByCoupon.get(c.id as string) ?? [],
      recipientsCount: counts.get(c.id as string) ?? 0,
    }))
  }

  /** phase-9: جزئیات یک کوپن — صفحه‌ی اختصاصی ادمین (پیوند مستقیم بدون وابستگی به کش لیست) */
  async get(id: string): Promise<CouponWithConditions> {
    if (!UUID_RE.test(id)) throw Err.validation('شناسه‌ی کوپن معتبر نیست')
    const row = (
      await this.deps.db.select().from(coupons).where(eq(coupons.id, asCampaignId(id)))
    )[0]
    if (!row) throw Err.notFound('کوپن پیدا نشد')
    const [granted] = await this.deps.db
      .select({ count: sql<number>`count(*)::int` })
      .from(couponGrants)
      .where(eq(couponGrants.couponId, row.id))
    return {
      coupon: row,
      conditions: await this.conditionsOf(row.id),
      recipientsCount: granted?.count ?? 0,
    }
  }

  async create(input: {
    code: string
    title?: string | null
    discountPercentage: number
    maxUses: number
    isPublic: boolean
    expiryDate: string | null
    rules: Array<{ type: string; params: Record<string, unknown> }>
  }): Promise<{ success: boolean; id?: string }> {
    // phase-9: حروف فارسی هم مجاز شد (پلتفرم کاملاً فارسی است؛ چک‌اوت toUpperCase
    // روی فارسی بی‌اثر و بی‌ضرر است) + خطاها به‌جای success:false با 200،
    // Err.validation می‌شوند تا فرانت پیام واقعی را ببیند (باگ «اضافه شد
    // ولی اضافه نشد» برای کد فارسی دقیقاً از همین‌جا می‌آمد).
    const code = input.code.trim().toUpperCase().slice(0, 16)
    if (!/^[A-Z0-9\u0600-\u06FF_-]{3,16}$/.test(code)) {
      throw Err.validation('کد تخفیف باید ۳ تا ۱۶ نویسه باشد: حروف لاتین یا فارسی، رقم و خط تیره')
    }
    if (input.discountPercentage < 1 || input.discountPercentage > 99) {
      throw Err.validation('درصد تخفیف باید بین ۱ تا ۹۹ باشد')
    }
    // round-11 (اسکن L-5): تاریخ خراب قبلاً Invalid Date می‌ساخت که وسط درج
    // با خطای DB (۵۰۰) می‌ترکید — اعتبارسنجی صریح با پیام روشن.
    if (input.expiryDate && Number.isNaN(new Date(input.expiryDate).getTime())) {
      throw Err.validation('تاریخ انقضا معتبر نیست')
    }
    const clash = await this.deps.db.query.coupons.findFirst({ where: eq(coupons.code, code) })
    if (clash) throw Err.conflict('این کد قبلاً ثبت شده است')

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
    if (!created) throw Err.validation('ذخیره‌سازی ناموفق بود')

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
  ): Promise<{ success: boolean }> {
    const { db } = this.deps
    // phase-9: هم‌الگوی create — کد فارسی مجاز + خطاها Err (۴۲۲/۴۰۹) نه success:false با 200
    const code = input.code.trim().toUpperCase().slice(0, 16)
    if (!/^[A-Z0-9\u0600-\u06FF_-]{3,16}$/.test(code)) {
      throw Err.validation('کد تخفیف باید ۳ تا ۱۶ نویسه باشد: حروف لاتین یا فارسی، رقم و خط تیره')
    }
    if (input.discountPercentage < 1 || input.discountPercentage > 99) {
      throw Err.validation('درصد تخفیف باید بین ۱ تا ۹۹ باشد')
    }
    // round-11 (اسکن L-5): هم‌الگوی create — انقضای خراب ۵۰۰ نمی‌دهد، ۴۲۲ می‌دهد
    if (input.expiryDate && Number.isNaN(new Date(input.expiryDate).getTime())) {
      throw Err.validation('تاریخ انقضا معتبر نیست')
    }
    const clash = await db.query.coupons.findFirst({ where: eq(coupons.code, code) })
    if (clash && clash.id !== id) {
      throw Err.conflict('این کد قبلاً ثبت شده است')
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
    if (!updated) throw Err.notFound('کوپن پیدا نشد')

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
   * couponId اشاره می‌کنند و درج redemption در تسویه با FK می‌شکند و
   * سفارشِ «پول‌گرفته‌شده» برای همیشه گیر می‌کند. حذف = غیرفعال‌سازی.
   */
  async remove(id: string): Promise<{ success: boolean; message?: string }> {
    if (!UUID_RE.test(id)) throw Err.validation('شناسه معتبر نیست')
    const couponId = asCampaignId(id)
    const updated = await this.deps.db
      .update(coupons)
      .set({ isActive: false })
      .where(eq(coupons.id, couponId))
      .returning({ id: coupons.id })
    if (updated.length === 0) throw Err.notFound('کوپن پیدا نشد')
    return { success: true, message: 'کوپن غیرفعال شد' }
  }

  /**
   * stage-10: فعال‌سازی مجدد — رفع باگ «غیرفعال کردم دیگر برنمی‌گردد».
   * remove فقط isActive=false می‌گذاشت و هیچ مسیری برای برگشت نبود.
   * اگر تاریخ انقضا گذشته باشد خطا می‌دهیم — ادمین اول باید انقضا را ویرایش کند
   * (وگرنه کوپن «فعال» ولی عملاً غیرقابل‌استفاده می‌شد — گمراه‌کننده).
   */
  async setActive(id: string, active: boolean): Promise<{ success: boolean; message: string }> {
    if (!UUID_RE.test(id)) throw Err.validation('شناسه معتبر نیست')
    const couponId = asCampaignId(id)
    const row = (await this.deps.db.select().from(coupons).where(eq(coupons.id, couponId)))[0]
    if (!row) throw Err.notFound('کوپن پیدا نشد')

    if (active && row.endsAt !== null && row.endsAt.getTime() <= Date.now()) {
      throw Err.conflict('تاریخ انقضای این کوپن گذشته است — ابتدا انقضا را ویرایش کنید')
    }
    if (row.isActive === active) {
      return { success: true, message: active ? 'کوپن از قبل فعال است' : 'کوپن از قبل غیرفعال است' }
    }

    await this.deps.db
      .update(coupons)
      .set({ isActive: active })
      .where(eq(coupons.id, couponId))
    return { success: true, message: active ? 'کوپن فعال شد' : 'کوپن غیرفعال شد' }
  }

  // ══ داخلی ══

  /** رارد ۴۸ — نسخه‌ی دسته‌ای conditionsOf برای لیست‌ها (یک کوئری، گروه‌بندی در Map) */
  private async conditionsOfMany(couponIds: Array<CampaignId>) {
    const map = new Map<string, Array<{ id: string; type: ConditionType; params: Record<string, unknown> }>>()
    if (couponIds.length === 0) return map
    const rows = await this.deps.db
      .select()
      .from(couponConditions)
      .where(inArray(couponConditions.couponId, couponIds))
    for (const r of rows) {
      const list = map.get(r.couponId as string) ?? []
      list.push({
        id: r.id,
        type: r.type as ConditionType,
        params: (r.params ?? {}) as Record<string, unknown>,
      })
      map.set(r.couponId as string, list)
    }
    return map
  }

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