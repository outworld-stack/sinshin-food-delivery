//src/domain/auth/registration-permit.service.ts
import { and, desc, eq, gt, sql } from 'drizzle-orm'

import type { Db, DbOrTx } from '#/infra/db/client'
import { registrationPermits, users, type RegistrationPermitRow } from '#/infra/db/schema'
import { Err } from '#/domain/shared/errors'
import { isUniqueViolation } from '#/domain/shared/pg'
import { normalizePhone } from '#/domain/shared/phone'

/**
 * stage-79 — مجوز ثبت‌نام ویژه.
 *
 * دسترسیِ ویژه‌ی ادمینِ اصلی: با وارد کردن یک شماره در تنظیمات، همان
 * شماره می‌تواند ثبت‌نام کند — حتی از دستگاهِ سوخته/مسدود — و بعد از
 * ثبت‌نامِ موفق، دستگاهش مسدود می‌شود (سوختنِ سخت، دلیلِ permit-burn).
 *
 * اصولِ طراحی (خروجیِ تحقیقِ عمیقِ stage-79):
 *  ۱) تک‌مصرفیِ اتمیک — claim با UPDATE شرطی (status='pending' و
 *     expires_at > now()) «داخل تراکنشِ ثبت‌نام»؛ پنجره‌ی TOCTOU وجود
 *     ندارد (CWE-367). rollback تراکنش، claim را هم برمی‌گرداند.
 *  ۲) قواعد دست‌نخورده — غیابِ مجوز یعنی رفتارِ قبلیِ سیستم بایت‌به‌بایت
 *     همان است؛ مجوز یک «استثنای قابل‌ممیزی» است نه تغییرِ رول.
 *  ۳) فقط ثبت‌نام — مجوز هرگز روی ورودِ کاربرِ موجود اثری ندارد.
 *
 * وضعیتِ expired «تنبل» است: ردیفِ pendingِ گذشته در consume رد می‌شود
 * و در list به‌صورت محاسبه‌ای نمایش داده می‌شود — بدون job پاک‌سازی.
 */

/** سقف اعتبار مجوز (ساعت) — ورودی ادمین از ۱ تا این سقف */
export const PERMIT_MAX_TTL_HOURS = 72
/** اعتبار پیش‌فرض (ساعت) */
export const PERMIT_DEFAULT_TTL_HOURS = 24

/** وضعیتِ مؤثر برای نمایش/تصمیم (expired = pendingِ گذشته) */
export type PermitEffectiveStatus = 'pending' | 'used' | 'revoked' | 'expired'

export interface PermitView {
  id: string
  phone: string
  status: PermitEffectiveStatus
  note: string | null
  createdBy: string
  createdAt: Date
  expiresAt: Date
  usedAt: Date | null
  usedDeviceId: string | null
  revokedAt: Date | null
}

function toView(row: RegistrationPermitRow): PermitView {
  const status: PermitEffectiveStatus =
    row.status === 'pending' && row.expiresAt.getTime() <= Date.now()
      ? 'expired'
      : (row.status as PermitEffectiveStatus)
  return {
    id: row.id,
    phone: row.phone,
    status,
    note: row.note,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
    usedDeviceId: row.usedDeviceId,
    revokedAt: row.revokedAt,
  }
}

export class RegistrationPermitService {
  constructor(private readonly deps: { db: Db }) {}

  /**
   * صدور/تازه‌سازی مجوز برای یک شماره.
   *  - شماره باید کاربرِ «نداشته» باشد (ثبت‌نام فقط برای کاربر تازه معنا دارد)
   *  - مجوزِ pendingِ موجود برای همان شماره تازه می‌شود (انقضای جدید +
   *    یادداشت جدید) — صدور دوباره همان ردیف است، نه ردیف دوم
   *    (ایندکس یکتای جزئی هم همین را تضمین می‌کند)
   */
  async issue(input: {
    rawPhone: string
    note?: string | null
    ttlHours?: number
    adminId: string
  }): Promise<PermitView> {
    const { db } = this.deps
    const phone = normalizePhone(input.rawPhone)
    if (!phone) {
      throw Err.validation('شماره موبایل معتبر نیست — الگوی درست: ۰۹۱۲۳۴۵۶۷۸۹')
    }

    const existingUser = await db.query.users.findFirst({ where: eq(users.phone, phone) })
    if (existingUser) {
      throw Err.conflict(
        'این شماره قبلاً ثبت‌نام کرده است — مجوز ثبت‌نام فقط برای شماره‌های تازه معنا دارد.',
      )
    }

    const ttl = Math.min(
      Math.max(Math.trunc(input.ttlHours ?? PERMIT_DEFAULT_TTL_HOURS), 1),
      PERMIT_MAX_TTL_HOURS,
    )
    const expiresAt = new Date(Date.now() + ttl * 3_600_000)
    const note = input.note?.trim() ? input.note.trim().slice(0, 500) : null

    // تازه‌سازیِ pending موجود (اتمیک — رقابتِ صدورِ هم‌زمان یک برنده دارد
    // و رندیشنِ pending expired هم همین‌جا به ردیفِ زنده تبدیل می‌شود)
    const refreshed = await db
      .update(registrationPermits)
      .set({ note, expiresAt, createdBy: input.adminId, createdAt: new Date() })
      .where(and(eq(registrationPermits.phone, phone), eq(registrationPermits.status, 'pending')))
      .returning()
    if (refreshed[0]) return toView(refreshed[0])

    try {
      const [created] = await db
        .insert(registrationPermits)
        .values({ phone, note, createdBy: input.adminId, expiresAt })
        .returning()
      if (!created) throw Err.internal('صدور مجوز ناموفق بود؛ دوباره تلاش کنید.')
      return toView(created)
    } catch (error) {
      // رقابتِ صدورِ هم‌زمان: ردیفِ pending در فاصله‌ی update→insert ساخته
      // شد — همان ردیف را تازه کن (ایندکس یکتای جزئی برنده را تعیین کرد)
      if (!isUniqueViolation(error)) throw error
      const [created] = await db
        .update(registrationPermits)
        .set({ note, expiresAt, createdBy: input.adminId, createdAt: new Date() })
        .where(and(eq(registrationPermits.phone, phone), eq(registrationPermits.status, 'pending')))
        .returning()
      if (!created) throw Err.conflict('صدور مجوز برای این شماره همین لحظه انجام شد؛ دوباره تلاش کنید.')
      return toView(created)
    }
  }

  /** لغو مجوزِ در انتظار — اتمیک؛ ردیفِ غیر-pending قابل لغو نیست. */
  async revoke(input: { permitId: string; adminId: string }): Promise<void> {
    const { db } = this.deps
    const revoked = await db
      .update(registrationPermits)
      .set({ status: 'revoked', revokedAt: new Date(), revokedBy: input.adminId })
      .where(
        and(eq(registrationPermits.id, input.permitId), eq(registrationPermits.status, 'pending')),
      )
      .returning()
    if (!revoked[0]) {
      throw Err.conflict('این مجوز قابل لغو نیست — استفاده شده، لغو شده یا منقضی است.')
    }
  }

  /** فهرستِ مجوزهای اخیر — ۱۰۰ ردیف آخر (نمایش تنظیمات) */
  async list(): Promise<PermitView[]> {
    const rows = await this.deps.db
      .select()
      .from(registrationPermits)
      .orderBy(desc(registrationPermits.createdAt))
      .limit(100)
    return rows.map(toView)
  }

  /**
   * مجوزِ فعالِ این شماره؟ — فقط-خواندنی، برای تصمیمِ پیش از تراکنش در
   * AuthService (نمایش/لاگ). مصرفِ واقعی فقط از طریق consumeForRegistration.
   */
  async peekActivePermit(phone: string): Promise<PermitView | null> {
    const row = await this.deps.db.query.registrationPermits.findFirst({
      where: activePermitCondition(phone),
    })
    return row ? toView(row) : null
  }

  /**
   * claim اتمیک — فقط داخل تراکنشِ ثبت‌نام (auth.service):
   * UPDATE شرطی تک‌عبارتی؛ ردیف برگشته یعنی مجوز همین‌جا مصرف شد.
   * null یعنی «مجوزی نبود/مست погло شد/منقضی شد» — فراخوان باید به
   * مسیرِ سختِ عادی برگردد (رفتارِ پیش از stage-79).
   *
   * اثرِ این UPDATE داخل همان tx است: rollback ثبت‌نام، مجوز را هم
   * «نخورده» برمی‌گرداند — ثبت‌نامِ شکست‌خورده مجوز را هدر نمی‌دهد.
   */
  async consumeForRegistration(
    db: DbOrTx,
    phone: string,
    deviceId: string | null,
  ): Promise<RegistrationPermitRow | null> {
    const claimed = await db
      .update(registrationPermits)
      .set({ status: 'used', usedAt: new Date(), usedDeviceId: deviceId })
      .where(activePermitCondition(phone))
      .returning()
    return claimed[0] ?? null
  }

  /** تکمیل رکوردِ ممیزی بعد از finalize (ردیف دستگاهِ نهایی معلوم شد) */
  async recordUsedDevice(db: DbOrTx, permitId: string, deviceId: string): Promise<void> {
    await db
      .update(registrationPermits)
      .set({ usedDeviceId: deviceId })
      .where(eq(registrationPermits.id, permitId))
  }
}

/** شرطِ «pending و زنده» — یک منبع برای peek و consume */
function activePermitCondition(phone: string) {
  return and(
    eq(registrationPermits.phone, phone),
    eq(registrationPermits.status, 'pending'),
    gt(registrationPermits.expiresAt, sql`now()`),
  )
}
