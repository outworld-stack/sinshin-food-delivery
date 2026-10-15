// ═══════════════════════════════════════════════════════════════
// stage-66 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/domain/coupon/coupon.service.ts
// وضعیت: جایگزینی کامل فایل موجود
// تغییر (راند ترمیم کوپن — تلفیق اسکن کارفرما + اسکن ما):
//   ① قرارداد ساخت/ویرایش: عمومی ⇔ بدون شرط / خصوصی ⇔ حداقل یک شرط
//     (قبلاً کوپن خصوصی بی‌شرط و کوپن عمومیِ همراه‌شرط از روت عبور می‌کرد)
//   ② findUsableCoupon: عمومی دیگر «کور» برنمی‌گردد + سقف مصرف
//     به‌ازای کاربر (maxPerUser — سیاست ۱ کارفرما) + خروجی دلیل‌دار
//   ③ grantIfEligible: ظرفیت (maxUses) چک می‌شود — اعطای کوپنِ پُرشده
//     دیگر رخ نمی‌دهد
//   ④ findNudgeCandidates: شرطِ ناقصِ «واقعی» و قطعی (اولین ناراضی) +
//     فاصله‌ی واقعی (remaining) + سقف ۲ یادآور به‌ازای کاربر-کوپن
//     (سیاست‌های ۲ و ۳) + ORDER BY قطعی
//   ⑤ releaseNudgeClaim: شکست ارسال یادآور → claim آزاد برای retry
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// stage-55 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/domain/coupon/coupon.service.ts
// وضعیت: جایگزینی کامل فایل موجود
// تغییر: create/update اتمیک در تراکنش + مدیریت رقابت روی کد یکتا
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// phase-2 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/domain/coupon/coupon.service.ts
// وضعیت: جایگزینی کامل فایل موجود (پایه: نسخه‌ی فاز-۱ با M9)
// تغییر فاز-۲: grantedRecently — جزئیات کوپن‌های تازه‌اعطا برای نوتیف
// ═══════════════════════════════════════════════════════════════

//src/domain/coupon/coupon.service.ts
import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'

import type { Db, DbOrTx } from '#/infra/db/client'
import {
  couponConditions,
  couponGrants,
  couponNudges,
  couponRedemptions,
  coupons,
  orders,
  users,
} from '#/infra/db/schema'
import { asCampaignId, type CampaignId } from '#/domain/shared/brand'
import { Err } from '#/domain/shared/errors'
import { isUniqueViolation } from '#/domain/shared/pg'
import {
  buildUserCondition,
  conditionThreshold,
  evaluateCondition,
  type ConditionType,
} from './coupon-evaluators'
import { UUID_RE } from '#/domain/shared/ids'

/**
 * stage-66 (سیاست ۳ کارفرما) — حداکثر تعداد یادآور برای هر (کوپن، کاربر).
 * سقف با شمارش ردیف‌های «ارسال‌شده» (smsSentAt != null) اعمال می‌شود؛
 * ردیف‌های اسکن‌شده ولی هرگز ارسال‌نشده به سهم کاربر حساب نمی‌شوند.
 */
export const MAX_NUDGES_PER_USER = 2

/**
 * stage-66 — خروجی دلیل‌دارِ findUsableCoupon: تمایذ پیام «نامعتبر برای
 * شما» و «سهم شما از این کد تمام شد» برای چک‌اوت/پیش‌نمایش (قبلاً null
 * خالی همه‌جا یکسان بود).
 */
export type UsableCouponOutcome =
  | { ok: true; coupon: typeof coupons.$inferSelect }
  | { ok: false; reason: 'invalid' | 'inactive' | 'not_granted' | 'per_user_exhausted' }


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
          // stage-66 (③) — کوپنِ ظرفیت‌پُر دیگر اعطا نمی‌شود: قبلاً گرنت برای
          // کوپنی می‌شد که هرگز قابل استفاده نبود (UX گمراه‌کننده).
          sql`(${coupons.maxUses} = 0 or ${coupons.usedCount} < ${coupons.maxUses})`,
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

  /**
   * فاز-۲ — جزئیات «آخرین N گرنت» یک کاربر (برای نوتیفیکیشن پوش).
   * نوتیف بعد از grant ساخته می‌شود؛ این کوئری فقط خواندنی است و
   * اگر خالی برگردد (مثلاً حذف سریع کوپن) نوتیف عمومی می‌شود — خطا نه.
   */
  async grantedRecently(
    userId: string,
    count: number,
  ): Promise<Array<{ code: string; title: string | null; discountPercentage: number }>> {
    const rows = await this.deps.db
      .select({
        code: coupons.code,
        title: coupons.title,
        discountPercentage: coupons.discountPercentage,
      })
      .from(couponGrants)
      .innerJoin(coupons, eq(coupons.id, couponGrants.couponId))
      .where(eq(couponGrants.userId, userId))
      .orderBy(desc(couponGrants.grantedAt))
      .limit(Math.min(Math.max(1, count), 10))
    return rows
  }

  // ══ اعتبار در چک‌اوت ══

  /**
   * stage-66 — شمارش مصرف فعالِ کاربر از یک کوپن عمومی:
   * redemptionهای تسویه‌شده (بازپرداخت → redemption حذف → سهم آزاد)
   * + سفارش‌های PENDING_PAYMENT با همین کوپن (رزروِ در جریان — دقیقاً
   * همان چیزی که usedCount رزرو می‌کند). دو کوئری ایندکس‌دار.
   */
  private async perUserUsage(tx: DbOrTx, couponId: CampaignId, userId: string): Promise<number> {
    const [settled, pending] = await Promise.all([
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(couponRedemptions)
        .where(and(eq(couponRedemptions.couponId, couponId), eq(couponRedemptions.userId, userId))),
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(orders)
        .where(
          and(
            eq(orders.couponId, couponId),
            eq(orders.userId, userId),
            eq(orders.status, 'PENDING_PAYMENT'),
          ),
        ),
    ])
    return (settled[0]?.count ?? 0) + (pending[0]?.count ?? 0)
  }

  async findUsableCoupon(
    tx: DbOrTx,
    userId: string,
    code: string,
  ): Promise<UsableCouponOutcome> {
    const clean = code.trim().toUpperCase().slice(0, 32)
    const coupon = (await tx.select().from(coupons).where(eq(coupons.code, clean)))[0]
    if (!coupon) return { ok: false, reason: 'invalid' }

    const now = Date.now()
    if (!coupon.isActive) return { ok: false, reason: 'inactive' }
    if (coupon.startsAt.getTime() > now) return { ok: false, reason: 'inactive' }
    if (coupon.endsAt !== null && coupon.endsAt.getTime() <= now) return { ok: false, reason: 'inactive' }

    if (coupon.isPublic) {
      // stage-66 (② عمق دفاعی) — قرارداد: کوپن عمومی شرط ندارد. اگر داده‌ی
      // قدیمی/معیوب شرط داشته باشد، «برای همه» رفتار نمی‌کنیم (قبلاً شرط‌ها
      // بی‌صدا نادیده گرفته می‌شدند) — مثل غیرفعال رد؛ ادمین ویرایش/حذف می‌کند.
      const [condCount] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(couponConditions)
        .where(eq(couponConditions.couponId, coupon.id))
      if ((condCount?.count ?? 0) > 0) return { ok: false, reason: 'inactive' }

      // stage-66 (سیاست ۱) — سقف مصرف به‌ازای کاربر؛ ۰ = نامحدود (رفتار
      // قبلی). شمارش = تسویه‌شده‌ها + رزروهای در جریان (perUserUsage).
      // پنجره‌ی رقابت دو چک‌اوت هم‌زمانِ یک کاربر می‌ماند — محدودیت بازاریابی
      // است نه قید پولی؛ ظرفیت کلی همچنان اتمیک است (UPDATE رزرو چک‌اوت).
      if (coupon.maxPerUser > 0) {
        const usage = await this.perUserUsage(tx, coupon.id, userId)
        if (usage >= coupon.maxPerUser) return { ok: false, reason: 'per_user_exhausted' }
      }

      return { ok: true, coupon }
    }

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
    return grant ? { ok: true, coupon } : { ok: false, reason: 'not_granted' }
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

  /**
   * stage-66 — نامزدهای یادآور با «شرط ناقص واقعی» و «فاصله‌ی واقعی».
   *
   * مخاطب: هم‌چنان همه-به‌جز-یکی (برای تک‌شرطی‌ها یعنی همه‌ی واجدنشانده) —
   * اسپم‌بودنش با دو سیاست کارفرما مهار می‌شود: پیامِ فاصله‌ی واقعی
   * (سیاست ۲) + سقف ۲ یادآور به‌ازای کاربر-کوپن (سیاست ۳).
   *
   * برای هر نامزد، «اولین شرطِ ناراضی» به‌ترتیبِ ثبتِ شرط‌ها قطعی انتخاب
   * می‌شود (قبلاً ایندکس دلبخواهی از missingCount بود — N4) و
   * remainingCount = سقف شرط − مقدار فعلی کاربر (بالا‌گرد) محاسبه و
   * در ردیف nudge ذخیره می‌شود تا جابِ ارسال بدون محاسبه‌ی مجدد، پیام
   * «۳ سفارش تا کوپن» بسازد.
   *
   * ORDER BY قطعی (N5): نزدیک‌ترین‌ها به شرایط اول؛ سقف ۵۰۰۰ نامزد.
   */
  async findNudgeCandidates(couponId: CampaignId): Promise<
    Array<{
      userId: string
      phone: string
      missingConditionId: string
      missingCount: number
      remainingCount: number
    }>
  > {
    const conds = await this.deps.db
      .select()
      .from(couponConditions)
      .where(eq(couponConditions.couponId, couponId))
    if (conds.length === 0) return []

    const ctx = { db: this.deps.db, userId: '', now: new Date() }
    const toInput = (c: (typeof conds)[number]) => ({
      type: c.type as ConditionType,
      params: (c.params ?? {}) as Record<string, unknown>,
    })
    const built = buildUserCondition(ctx, conds.map(toInput))
    const evaluators = conds.map((c) => {
      const input = toInput(c)
      return evaluateCondition(ctx, input.type, input.params)
    })

    // ستون‌های پویا: sat_i/cur_i به‌ازای هر شرط — مقادیر فقط برای ردیف‌های
    // عبورکرده از WHERE محاسبه می‌شوند (ساب‌کوئری‌های WHERE همان‌قدر
    // سنگین‌اند که نسخه‌ی قبلی — بدون رگرسیون، فقط ستون‌های بیشتر).
    const shape: Record<string, SQL> = {
      userId: sql<string>`u.id`,
      phone: sql<string>`u.phone`,
      satisfiedCount: sql<number>`(${built.satisfiedCount})::int`,
    }
    for (const [i, ev] of evaluators.entries()) {
      shape[`sat_${i}`] = sql<boolean>`${ev.satisfied}`
      shape[`cur_${i}`] = sql<number>`${ev.current}`
    }

    const rows = (await this.deps.db
      .select(shape)
      .from(sql`users u`)
      .where(
        sql`${built.allButOne}
           and not ${built.allSatisfied}
           and u.banned_at is null
           and not exists (
             select 1 from coupon_grants g
             where g.coupon_id = ${couponId}::uuid and g.user_id = u.id
           )
           and (
             select count(*) from coupon_nudges n
             where n.coupon_id = ${couponId}::uuid
               and n.user_id = u.id
               and n.sms_sent_at is not null
           ) < ${MAX_NUDGES_PER_USER}`,
      )
      // N5 — قطعی و معنادار: نزدیک‌ترین‌ها به شرایط اول. با «عبارت» مرتب
      // می‌کنیم نه alias (خروجی sql خام در select نام‌گذاری نمی‌شود —
      // ORDER BY "satisfiedCount" در PG خطای «ستون وجود ندارد» می‌دهد).
      .orderBy(desc(sql`(${built.satisfiedCount})::int`), sql`u.id asc`)
      .limit(5000)) as Array<Record<string, unknown>>

    const candidates: Array<{
      userId: string
      phone: string
      missingConditionId: string
      missingCount: number
      remainingCount: number
    }> = []
    for (const row of rows) {
      const total = conds.length
      const satisfiedCount = Number(row.satisfiedCount ?? 0)
      // اولین شرطِ ناراضی به‌ترتیب ثبت — قطعی و قابل‌تکرار (N4)
      let missingIdx = -1
      for (let i = 0; i < total; i++) {
        if (row[`sat_${i}`] !== true) {
          missingIdx = i
          break
        }
      }
      // دفاعی: مخاطب شرطاً «همه به‌جز یکی» دارد؛ نباید بدون ناقص بیاید
      if (missingIdx < 0) continue
      const cond = conds[missingIdx]
      if (!cond) continue
      const threshold = conditionThreshold(cond.type as ConditionType, (cond.params ?? {}) as Record<string, unknown>)
      // bigint از pg به‌صورت رشته می‌آید — Number() هر دو را می‌پوشاند
      const current = Number(row[`cur_${missingIdx}`] ?? 0)
      candidates.push({
        userId: String(row.userId),
        phone: String(row.phone),
        missingConditionId: cond.id as string,
        missingCount: Math.max(1, total - satisfiedCount),
        remainingCount: Math.max(1, Math.ceil(threshold - current)),
      })
    }
    return candidates
  }

  /**
   * stage-66 (⑤) — آزادسازی claim یادآور: جابِ ارسال، ردیف را قبل از
   * notifyUser تصرف می‌کند؛ اگر notifyUser شکست بخورد (id=null — درج
   * صندوق/پوش هرگز throw نمی‌کند)، claim آزاد می‌شود تا اجرای مجدد/دستی
   * همان روز دوباره تلاش کند. ردیف‌های آزادشده سهمِ سقف ۲ را نمی‌سوزانند.
   */
  async releaseNudgeClaim(nudgeId: string): Promise<void> {
    if (!UUID_RE.test(nudgeId)) return
    await this.deps.db
      .update(couponNudges)
      .set({ smsSentAt: null })
      .where(eq(couponNudges.id, nudgeId))
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
    /** stage-66 (سیاست ۱) — سقف مصرف به‌ازای کاربر برای کوپن عمومی؛ ۰ = نامحدود (پیش‌فرض) */
    maxPerUser?: number
    isPublic: boolean
    expiryDate: string | null
    rules: Array<{ type: string; params: Record<string, unknown> }>
    /** stage-48 — عضویت در فرآیند کرون‌جاب کوپن‌ها (پیش‌فرض خاموش) */
    cronEnabled?: boolean
    /** stage-65 — ممنوعیت اعلان انتشار ساخت (پیش‌فرض خاموش = اعلان می‌رود) */
    announceSuppressed?: boolean
  }): Promise<{ success: boolean; id?: string }> {
    // stage-66 (①/②) — قرارداد ساخت، در سرویس (نه فقط روت — هر فراخوان‌کننده‌ای):
    // عمومی ⇔ بدون شرط / خصوصی ⇔ حداقل یک شرط. قبلاً کوپن خصوصیِ بی‌شرط
    // (هیچ موتوری اعطایش نمی‌کرد — کوپن مرده) و کوپن عمومیِ همراه‌شرط
    // (findUsable شرط‌ها را بی‌صدا نادیده می‌گرفت) از همین‌جا عبور می‌کردند.
    if (input.isPublic && input.rules.length > 0) {
      throw Err.validation(
        'کوپن عمومی شرط ندارد — قوانین فقط برای کوپن خصوصی (هدف‌یابی) معنا دارند؛ کوپن را خصوصی کنید یا شرط‌ها را حذف کنید',
      )
    }
    if (!input.isPublic && input.rules.length === 0) {
      throw Err.validation(
        'کوپن خصوصی بدون شرط به هیچ کاربری اعطا نمی‌شود — حداقل یک شرط اضافه کنید یا کوپن را عمومی کنید',
      )
    }
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
    try {
      return await this.deps.db.transaction(async (tx) => {
        // stage-55 — کل فرایند اتمی: قبلاً بین insert کوپن و insert شرط‌ها
        // پنجره‌ای بود که کوپنِ بی‌شرط (کمپین عمومی!) قابل استفاده می‌شد.
        // onConflictDoNothing روی کد یکتا → مسیر race-safe بدون 500.
        const [created] = await tx
          .insert(coupons)
          .values({
            code,
            title: input.title ?? null,
            discountPercentage: input.discountPercentage,
            maxUses: input.maxUses,
            // stage-66 (سیاست ۱) — سقف per-user (۰ = نامحدود؛ فقط مسیر عمومی می‌خواندش)
            maxPerUser: input.maxPerUser ?? 0,
            isPublic: input.isPublic,
            // stage-48 — ورود به فرآیند بررسی کرون (سوییچ فرم؛ پیش‌فرض خاموش)
            cronEnabled: input.cronEnabled ?? false,
            // stage-65 — سوییچ «کوپن بی‌صدا» (پیش‌فرض خاموش = اعلان ساخت می‌رود)
            announceSuppressed: input.announceSuppressed ?? false,
            ...(input.expiryDate ? { endsAt: new Date(input.expiryDate) } : {}),
          })
          .onConflictDoNothing({ target: coupons.code })
          .returning()
        if (!created) throw Err.conflict('این کد قبلاً ثبت شده است')

        if (input.rules.length > 0) {
          await tx.insert(couponConditions).values(
            input.rules.map((rule) => ({
              couponId: created.id,
              type: rule.type as never,
              params: rule.params,
            })),
          )
        }

        return { success: true, id: created.id }
      })
    } catch (e) {
      // stage-55 — رقابت هم‌زمان روی کدِ یکتا → پیام دوستانه نه 500
      if (isUniqueViolation(e)) throw Err.conflict('این کد قبلاً ثبت شده است')
      throw e
    }
  }

  /** phase-5: ویرایش — کوپن + جایگزینی شرط‌ها (حذف+اینسرت؛ nudges با cascade می‌روند) */
  async update(
    id: string,
    input: {
      code: string
      title?: string | null
      discountPercentage: number
      maxUses: number
      /** stage-66 (سیاست ۱) — سقف per-user (undefined = دست‌نخورده در ویرایش) */
      maxPerUser?: number
      isPublic: boolean
      expiryDate: string | null
      rules: Array<{ type: string; params: Record<string, unknown> }>
      /** stage-48 — عضویت در فرآیند کرون‌جاب کوپن‌ها (undefined = دست‌نخورده) */
      cronEnabled?: boolean
      /** stage-65 — ممنوعیت اعلان انتشار (undefined = دست‌نخورده؛ فقط لحظه‌ی ساخت معنا دارد) */
      announceSuppressed?: boolean
    },
  ): Promise<{ success: boolean }> {
    // stage-66 (①/②) — همان قرارداد create؛ ویرایش هم نمی‌تواند کوپن معیوب بسازد.
    // «عمومی‌کردنِ کوپنِ شرط‌دار» باید با rules خالی بیاید (فرم همین کار را
    // می‌کند) — وگرنه ۴۲۲ روشن می‌گیرد، نه رفتارِ کورِ قبلی.
    if (input.isPublic && input.rules.length > 0) {
      throw Err.validation(
        'کوپن عمومی شرط ندارد — شرط‌ها را حذف کنید یا کوپن را خصوصی نگه دارید',
      )
    }
    if (!input.isPublic && input.rules.length === 0) {
      throw Err.validation(
        'کوپن خصوصی بدون شرط به هیچ کاربری اعطا نمی‌شود — حداقل یک شرط اضافه کنید یا کوپن را عمومی کنید',
      )
    }
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
    // stage-55 — پنجره‌ی delete-then-reinsert بسته شد؛ کرشِ وسط کار دیگر
    // کوپنِ بی‌شرط نمی‌سازد (کل ویرایش + جایگزینی شرط‌ها یکجا اتمیک است).
    try {
      return await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(coupons)
          .set({
            code,
            title: input.title ?? null,
            discountPercentage: input.discountPercentage,
            maxUses: input.maxUses,
            // stage-66 (سیاست ۱) — سقف per-user (نیامد = دست‌نخورده)
            ...(input.maxPerUser !== undefined ? { maxPerUser: input.maxPerUser } : {}),
            isPublic: input.isPublic,
            // stage-48 — سوییچ کرون (نیامد = دست‌نخورده)
            ...(input.cronEnabled !== undefined ? { cronEnabled: input.cronEnabled } : {}),
            // stage-65 — سوییچ «کوپن بی‌صدا» (نیامد = دست‌نخورده)
            ...(input.announceSuppressed !== undefined ? { announceSuppressed: input.announceSuppressed } : {}),
            ...(input.expiryDate ? { endsAt: new Date(input.expiryDate) } : { endsAt: null }),
          })
          .where(eq(coupons.id, cid))
          .returning()
        if (!updated) throw Err.notFound('کوپن پیدا نشد')

        await tx.delete(couponConditions).where(eq(couponConditions.couponId, cid))
        if (input.rules.length > 0) {
          await tx.insert(couponConditions).values(
            input.rules.map((rule) => ({
              couponId: cid,
              type: rule.type as never,
              params: rule.params,
            })),
          )
        }
        return { success: true }
      })
    } catch (e) {
      // stage-55 — رقابت هم‌زمان روی کدِ یکتا → پیام دوستانه نه 500
      if (isUniqueViolation(e)) throw Err.conflict('این کد قبلاً ثبت شده است')
      throw e
    }
  }

  /**
   * stage-65 — حذف واقعی (hard delete) به خواسته‌ی صریح کارفرما:
   * «هر کوپن باید توسط ادمین اصلی قابل حذم شدن باشد؛ بعد از حذف،
   * تاریخچه‌ی مصرف‌کنندگان هم از UI هم دیتابیس پاک شود».
   *
   *  • conditions / grants / redemptions / nudges با FK cascade حذف
   *    می‌شوند (= پاک شدن تاریخچه‌ی مصرف از دیتابیس).
   *  • orders.coupon_id از فاز-۵ FK ندارد — برای پاک‌سازی کامل مرجع،
   *    در همان tx روی سفارش‌ها null می‌شود؛ ردیف سفارش و breakdown
   *    (دفتر پول) دست‌نخورده می‌ماند.
   *  • سفارش‌های PENDING_PAYMENTِ در جریان گیر نمی‌کنند: مسیرهای
   *    settle/fail/refund همه «کوپن نبود» را دفاعی هندل می‌کنند —
   *    settle فقط warn می‌زند و redemption نمی‌سازد (کد موجود)،
   *    fail/refund روی کوپنِ حذف‌شده no-op اند.
   *  • غیرفعال‌سازی نرم (عقب‌گرد‌پذیر) همچنان از PATCH /:id/status
   *    موجود است — این دو مسیر عمداً جدا ماندند.
   */
  async remove(id: string): Promise<{ success: boolean; message: string }> {
    if (!UUID_RE.test(id)) throw Err.validation('شناسه معتبر نیست')
    const couponId = asCampaignId(id)
    return this.deps.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: coupons.id })
        .from(coupons)
        .where(eq(coupons.id, couponId))
      if (!existing) throw Err.notFound('کوپن پیدا نشد')

      // ۱) قطع پیوند سفارش‌ها — پول و breakdown می‌مانند، مرجع آویزان نه
      await tx.update(orders).set({ couponId: null }).where(eq(orders.couponId, couponId))
      // ۲) حذف ردیف — بقیه‌ی تاریخچه با cascade می‌روند
      await tx.delete(coupons).where(eq(coupons.id, couponId))
      return { success: true, message: 'کوپن و تاریخچه‌ی مصرف آن حذف شد' }
    })
  }

  /**
   * stage-65 — مصرف‌کنندگان واقعی کوپن (ردیف‌های coupon_redemptions) برای
   * صفحه‌ی اختصاصی ادمین. صفحه‌بندی سروری + شمارش کل؛ جدیدترین مصرف اول.
   * عمومی و خصوصی هر دو (redemption برای هر دو ثبت می‌شود).
   */
  async consumers(
    id: string,
    page: number,
    limit: number,
  ): Promise<{
    total: number
    page: number
    limit: number
    rows: Array<{
      userId: string
      name: string | null
      phone: string
      orderDisplayId: string | null
      usedAt: Date
    }>
  }> {
    if (!UUID_RE.test(id)) throw Err.validation('شناسه‌ی کوپن معتبر نیست')
    const couponId = asCampaignId(id)
    const [row] = await this.deps.db
      .select({ id: coupons.id })
      .from(coupons)
      .where(eq(coupons.id, couponId))
    if (!row) throw Err.notFound('کوپن پیدا نشد')

    const [agg] = await this.deps.db
      .select({ count: sql<number>`count(*)::int` })
      .from(couponRedemptions)
      .where(eq(couponRedemptions.couponId, couponId))

    const rows = await this.deps.db
      .select({
        userId: couponRedemptions.userId,
        name: users.name,
        phone: users.phone,
        orderDisplayId: orders.displayId,
        usedAt: couponRedemptions.usedAt,
      })
      .from(couponRedemptions)
      .innerJoin(users, eq(users.id, couponRedemptions.userId))
      .leftJoin(orders, eq(orders.id, couponRedemptions.orderId))
      .where(eq(couponRedemptions.couponId, couponId))
      .orderBy(desc(couponRedemptions.usedAt))
      .limit(limit)
      .offset((page - 1) * limit)

    return { total: agg?.count ?? 0, page, limit, rows }
  }

  /**
   * stage-10: فعال‌سازی مجدد — رفع باگ «غیرفعال کردم دیگر برنمی‌گردد».
   * غیرفعال‌سازی نرم از PATCH /:id/status انجام می‌شود (stage-65: حذف
   * سخت از DELETE جداست) و این مسیر همان برگرداندن آن است.
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