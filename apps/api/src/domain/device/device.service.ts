// ═══════════════════════════════════════════════════════════════
// stage-70 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/domain/device/device.service.ts
// وضعیت: جایگزینی کامل فایل موجود
// تغییر: تفکیک peek (فقط-خواندنی) از finalize (اثر دائمی، داخل تراکنش
//        ثبت‌نام) + سقف سخت روی ردیفِ دقیقِ دستگاه + claim اتمیک مالکیت +
//        یکتایی clientId + گارد سیگنال‌های missing در شباهت
// ═══════════════════════════════════════════════════════════════

//src/domain/device/device.service.ts
import { and, desc, eq, gte, ilike, inArray, ne, or, sql, type SQL } from 'drizzle-orm'

import type { Db, DbOrTx } from '#/infra/db/client'
import {
  deviceEvents,
  deviceIdentities,
  deviceLinks,
  devices,
  sessions,
  type DeviceRow,
} from '#/infra/db/schema'
import type { AppConfig } from '#/infra/config/env'
import { Err } from '#/domain/shared/errors'
import { isUniqueViolation, likePattern } from '#/domain/shared/pg'
import { asDeviceId, asUserId, type DeviceId } from '#/domain/shared/brand'
import {
  compositeFingerprintHash,
  computeRiskScore,
  isMissingHash,
  MIN_REAL_HASH_SIGNALS,
  realSignalCount,
  signalSimilarity,
  type DeviceSignals,
} from './device-signals'

const CLUSTER_CAP = 50
const SIMILARITY_CANDIDATE_CAP = 500

/**
 * stage-70 — گاردِ لینک شباهت: علاوه بر آستانه‌ی score، لینک فقط وقتی
 * ساخته می‌شود که تعداد/وزنِ سیگنال‌های «واقعاً قابل مقایسه» کافی باشد.
 * سیگنال missing هرگز امتیاز نمی‌دهد (P1-۱).
 */
const MIN_LINK_COMPARABLE_WEIGHT = 0.5
const MIN_LINK_COMPARABLE_COUNT = 2

/**
 * نتیجه‌ی «پیش‌بینی» فقط-خواندنی دستگاه — بدون هیچ اثر دائمی:
 * نه insert، نه لینک، نه امتیازِ ذخیره‌شده، نه مسدودسازی، نه ابطال سشن.
 * سرویس احراز هویت با این نتیجه تصمیم می‌گیرد؛ فقط در صورت موفقیتِ
 * ثبت‌نام/ورود، finalize() اثر دائمی را در همان تراکنش ثبت می‌کند.
 */
export interface DevicePeek {
  /** ردیف موجود یا null اگر دستگاه تازه است */
  device: DeviceRow | null
  /** لایه‌ای که دستگاه را پیدا کرد */
  matchedBy: 'client-id' | 'fingerprint' | 'none'
  /** شماره‌های متمایزِ خوشه (بدون شماره‌ی فعلی) — فقط سیگنال ریسک/معرف */
  clusterPhoneCount: number
  isNewPhoneForDevice: boolean
  referralBlocked: boolean
  /** امتیاز ریسکِ محاسبه‌شده (هنوز ذخیره نشده) */
  riskScore: number
  riskFlags: string[]
  /** composite هش محاسبه‌شده — finalize دوباره محاسبه نمی‌کند */
  fingerprintHash: string
}

export interface DeviceFinalizeInput {
  signals: DeviceSignals
  phone: string
  ip?: string | null
  peek: DevicePeek
  /** REGISTER = ثبت‌نام موفق (claim مالکیت)؛ LOGIN = ورود کاربر موجود */
  event: 'REGISTER' | 'LOGIN'
  /**
   * stage-79 — مسیرِ استثنای مجوز ثبت‌نام:
   *  - claim مالکیت بی‌قیدوشرط اعمال می‌شود (بدون شرطِ «owner IS NULL»)،
   *  - و پس از ثبت‌نام، دستگاه مسدود می‌شود (دلیل permit-burn).
   * فقط وقتی مجوزی «اتمیک مصرف شده» باشد true می‌آید — peek به‌تنهایی
   * کافی نیست (کاهش پنجره‌ی TOCTOU به صفر).
   */
  permitOverride?: boolean
  /** شناسه‌ی مجوزِ مصرف‌شده — فقط برای رکوردِ ممیزی */
  permitId?: string | null
}

export interface DeviceFinalizeResult {
  device: DeviceRow
  linkedTo: { deviceId: string; similarity: number }[]
}

export class DeviceService {
  constructor(private readonly deps: { db: Db; config: AppConfig }) {}

  /**
   * stage-70 — پیش‌بینی فقط-خواندنی (جایگزین resolveِ قدیمی).
   * ترتیب شناسایی:
   *  ۱) clientId (لایه ۱ — قوی‌ترین)
   *  ۲) هش مرکبِ دقیق (لایه ۲ — با scope ویژه برای کیفیت پایین)
   * سپس: خوشه (فقط خواندنی) + امتیاز ریسک (بدون ذخیره).
   *
   * تفاوت با resolve قدیمی (P1-۳/P2-۴): هیچ write ای انجام نمی‌شود —
   * تلاشِ ردشده‌ی ثبت‌نام دیگر گراف دستگاه را آلوده نمی‌کند.
   */
  async peek(signals: DeviceSignals, phone: string): Promise<DevicePeek> {
    const { db } = this.deps
    const composite = compositeFingerprintHash(signals, signals.userAgent ?? null, phone)

    let device: DeviceRow | undefined
    let matchedBy: DevicePeek['matchedBy'] = 'none'

    // ── ۱) لایه ۱ — clientId ──
    if (signals.clientId) {
      device = await db.query.devices.findFirst({
        where: eq(devices.clientId, signals.clientId),
      })
      if (device) matchedBy = 'client-id'
    }

    // ── ۲) هش مرکبِ دقیق ──
    if (!device) {
      device = await db.query.devices.findFirst({
        where: eq(devices.fingerprintHash, composite),
      })
      if (device) matchedBy = 'fingerprint'
    }

    // امتیاز ریسک — فقط محاسبه (ذخیره در finalize)
    const clusterIds = device ? await this.clusterDeviceIds(device.id) : []
    const clusterPhones = device
      ? await db
          .selectDistinct({ phone: deviceIdentities.phone })
          .from(deviceIdentities)
          .where(
            and(inArray(deviceIdentities.deviceId, clusterIds), ne(deviceIdentities.phone, phone)),
          )
      : []

    const { score, flags } = device
      ? computeRiskScore({
          signals,
          userAgent: signals.userAgent ?? null,
          clusterPhoneCount: clusterPhones.length + 1,
          canvasDrift: DeviceService.driftDetected(device, signals),
        })
      : { score: 0, flags: [] as string[] }

    const isNewPhone = !device
      ? true
      : !(await db.query.deviceIdentities.findFirst({
          where: and(eq(deviceIdentities.deviceId, device.id), eq(deviceIdentities.phone, phone)),
        }))

    return {
      device: device ?? null,
      matchedBy,
      clusterPhoneCount: clusterPhones.length,
      isNewPhoneForDevice: isNewPhone,
      referralBlocked: isNewPhone && clusterPhones.length >= this.deps.config.device.referralBlockAfter,
      riskScore: score,
      riskFlags: flags,
      fingerprintHash: composite,
    }
  }

  /**
   * stage-70 — نهایی‌سازیِ اثر دائمی دستگاه: فقط بعد از موفقیتِ ثبت‌نام
   * یا ورود، و داخل تراکنشِ سرویس احراز هویت (یا هیچ).
   *
   * کارها (به‌ترتیب):
   *  ۱) ردیف موجود را FOR UPDATE قفل و سیگنال‌ها/ریسک را به‌روز کن؛
   *     ردیف تازه را race-safe درج کن (ON CONFLICT → پیدا-مجدد).
   *  ۲) فقط برای ردیفِ تازه: جست‌وجوی شباهت (با گارد missing) + لینک‌ها.
   *  ۳) REGISTER: claim اتمیک مالکیت — UPDATE ... WHERE owner IS NULL.
   *  ۴) ثبت/به‌روزرسانی هویت + رویداد REGISTER/LOGIN.
   *  ۵) REGISTER + deviceEnforcement + آستانه: مسدودسازی خودکار
   *     (سیاست جدید: هرگز قبل از ثبت‌نام موفق — P1-۳).
   */
  async finalize(db: DbOrTx, input: DeviceFinalizeInput): Promise<DeviceFinalizeResult> {
    const { config } = this.deps
    const { signals, phone, ip, peek, event } = input
    const composite = peek.fingerprintHash
    const linkedTo: { deviceId: string; similarity: number }[] = []

    // ── ۱) ردیف دستگاه: به‌روزرسانیِ قفل‌شده یا درجِ race-safe ──
    let device: DeviceRow | undefined

    if (peek.device) {
      // قفل ردیف — رقابتِ هم‌زمان روی همین دستگاه اینجا سریال می‌شود
      const rows = await db
        .select()
        .from(devices)
        .where(eq(devices.id, peek.device.id))
        .for('update')
      device = rows[0]
    }

    if (device) {
      // drift دو-مرحله‌ای: prev = canvasِ ذخیره‌شده‌ی فعلی، سپس به‌روزرسانی
      const drift = DeviceService.driftDetected(device, signals)
      const { score, flags } = computeRiskScore({
        signals,
        userAgent: signals.userAgent ?? null,
        clusterPhoneCount: peek.clusterPhoneCount + 1,
        canvasDrift: drift,
      })

      // stage-72 (P2-۱۰) — بازنویسیِ نهاییِ دستگاه با تابِ خطای یکتایی:
      // در رِیسِ نادر (دو تب/دو ردیف، بین peek و finalize) ممکن است clientId
      // یا fingerprintHash لحظه‌ای به ردیف دیگری تعلق گرفته باشد → 23505 خام.
      // مسیر INSERT از قبل retry دارد؛ UPDATE نداشت. تابِ سه‌مرحله‌ای:
      // کامل → بدون clientId → بدون clientId و fingerprintHash (هویتِ ردیف
      // دست‌نخورده می‌ماند؛ اتصالِ کلاینت در ورود بعدی از همان کلیدِ موجود
      // برقرار می‌شود). هر تنزل با رویداد UNIQUE_RETRY ثبت می‌شود.
      const patch: Partial<typeof devices.$inferInsert> = {
        // clientId فقط وقتی خالی است پر می‌شود — بازنویسی ممنوع (D6)؛
        // با ایندکس یکتا، بازنویسیِ هم‌زمان two-row خطای خام می‌داد.
        clientId: device.clientId ?? signals.clientId ?? null,
        fingerprintHash: composite,
        canvasHash: signals.canvasHash,
        webglHash: signals.webglHash,
        audioHash: signals.audioHash,
        fontsHash: signals.fontsHash,
        screen: signals.screen ?? device.screen,
        platform: signals.platform ?? device.platform,
        timezone: signals.timezone ?? device.timezone,
        language: signals.language ?? device.language,
        hardwareConcurrency: signals.hardwareConcurrency ?? device.hardwareConcurrency,
        deviceMemory: signals.deviceMemory ?? device.deviceMemory,
        touch: signals.touch ?? device.touch,
        networkType: signals.networkType ?? device.networkType,
        userAgent: signals.userAgent ?? device.userAgent,
        label: signals.label ?? device.label,
        deviceType: signals.deviceType ?? device.deviceType,
        deviceBrand: signals.deviceBrand ?? device.deviceBrand,
        deviceModel: signals.deviceModel ?? device.deviceModel,
        prevCanvasHash: device.canvasHash,
        riskScore: score,
        riskFlags: flags,
        lastSeenAt: new Date(),
      }
      let updated: DeviceRow | undefined
      // قفل مقدار برای closure — TS و رِیسِ مقدار
      const target: DeviceRow = device
      const runUpdate = async (p: Partial<typeof devices.$inferInsert>) =>
        (await db.update(devices).set(p).where(eq(devices.id, target.id)).returning())[0]
      try {
        updated = await runUpdate(patch)
      } catch (error) {
        if (!isUniqueViolation(error)) throw error
        console.log(`[device] unique-retry #1 (device=${device.id}) — clientId dropped`)
        await this.logEventOn(db, device.id, phone, 'UNIQUE_RETRY', ip, signals.userAgent, {
          dropped: ['clientId'],
        })
        try {
          const { clientId: _drop, ...patchNoClientId } = patch
          updated = await runUpdate(patchNoClientId)
        } catch (error2) {
          if (!isUniqueViolation(error2)) throw error2
          console.log(`[device] unique-retry #2 (device=${device.id}) — fingerprintHash kept`)
          await this.logEventOn(db, device.id, phone, 'UNIQUE_RETRY', ip, signals.userAgent, {
            dropped: ['clientId', 'fingerprintHash'],
          })
          const { clientId: _c, fingerprintHash: _f, ...patchMinimal } = patch
          updated = await runUpdate(patchMinimal)
        }
      }
      device = updated ?? device

      if (flags.length > 0 && (score !== peek.riskScore || flags.length !== peek.riskFlags.length)) {
        await this.logEventOn(db, device.id, phone, 'RISK_FLAGGED', ip, signals.userAgent, {
          score,
          flags,
        })
      }
    } else {
      // درج race-safe (D5/P2-۷): ON CONFLICT DO NOTHING → اگر رقابت برنده
      // بود، ردیفِ موجود دوباره پیدا می‌شود — خطای خام دیتابیس به کاربر نمی‌رسد.
      const inserted = await db
        .insert(devices)
        .values({
          clientId: signals.clientId ?? null,
          fingerprintHash: composite,
          canvasHash: signals.canvasHash,
          webglHash: signals.webglHash,
          audioHash: signals.audioHash,
          fontsHash: signals.fontsHash,
          screen: signals.screen ?? null,
          platform: signals.platform ?? null,
          timezone: signals.timezone ?? null,
          language: signals.language ?? null,
          hardwareConcurrency: signals.hardwareConcurrency ?? null,
          deviceMemory: signals.deviceMemory ?? null,
          touch: signals.touch ?? false,
          networkType: signals.networkType ?? null,
          userAgent: signals.userAgent ?? null,
          label: signals.label ?? null,
          deviceType: signals.deviceType ?? null,
          deviceBrand: signals.deviceBrand ?? null,
          deviceModel: signals.deviceModel ?? null,
        })
        .onConflictDoNothing()
        .returning()

      device = inserted[0]
      if (!device) {
        device =
          (await db.query.devices.findFirst({ where: eq(devices.fingerprintHash, composite) })) ??
          (signals.clientId
            ? await db.query.devices.findFirst({ where: eq(devices.clientId, signals.clientId) })
            : undefined)
      }
      if (!device) throw Err.internal('ذخیره‌سازی دستگاه ناموفق بود.')

      // ── ۲) شباهت + لینک — فقط کیفیت کافی (P1-۱) و مرتب‌سازی صریح (P2-۶) ──
      // دقت: خودِ ردیفِ تازه از کاندیدها حذف می‌شود — درج + جست‌وجوی بعدی،
      // خودش را با شباهت ۱.۰ «لینک به خود» می‌ساخت (کشف E2E استیج ۷۰).
      if (realSignalCount(signals) >= MIN_REAL_HASH_SIGNALS) {
        const since = new Date(Date.now() - config.device.similarityWindowDays * 86_400_000)
        const candidates = await db
          .select()
          .from(devices)
          .where(and(gte(devices.lastSeenAt, since), ne(devices.id, device.id)))
          .orderBy(desc(devices.lastSeenAt))
          .limit(SIMILARITY_CANDIDATE_CAP)

        const scored = candidates
          .map((c) => ({ c, sim: signalSimilarity(c, signals) }))
          .filter(
            (x) =>
              x.sim.score >= config.device.linkThreshold &&
              x.sim.comparableWeight >= MIN_LINK_COMPARABLE_WEIGHT &&
              x.sim.comparableCount >= MIN_LINK_COMPARABLE_COUNT,
          )
          .sort((a, b) => b.sim.score - a.sim.score)

        for (const { c, sim } of scored.slice(0, 5)) {
          // جفت مرتب‌شده — بدون destructuring (noUncheckedIndexedAccess)
          const a = device.id < c.id ? device.id : c.id
          const b = device.id < c.id ? c.id : device.id
          await db
            .insert(deviceLinks)
            .values({ deviceA: a, deviceB: b, similarity: sim.score })
            .onConflictDoNothing()
          linkedTo.push({ deviceId: c.id, similarity: sim.score })
          await this.logEventOn(db, device.id, phone, 'LINK_CREATED', ip, signals.userAgent, {
            otherDeviceId: c.id,
            similarity: sim.score,
          })
        }
      }

      // امتیاز ریسک تازه‌وارد را هم ذخیره کن (برای پنل ادمین)
      const { score, flags } = computeRiskScore({
        signals,
        userAgent: signals.userAgent ?? null,
        clusterPhoneCount: peek.clusterPhoneCount + 1,
        canvasDrift: false,
      })
      if (score > 0) {
        const [withRisk] = await db
          .update(devices)
          .set({ riskScore: score, riskFlags: flags })
          .where(eq(devices.id, device.id))
          .returning()
        device = withRisk ?? device
        if (flags.length > 0) {
          await this.logEventOn(db, device.id, phone, 'RISK_FLAGGED', ip, signals.userAgent, {
            score,
            flags,
          })
        }
      }
    }

    // ── ۳) claim اتمیک مالکیت (فقط REGISTER) — P2-۵ ──
    // سقف سختِ «هر دستگاه یک ثبت‌نام» روی همین ردیف اعمال می‌شود؛
    // کل خوشه فقط سیگنال ریسک/معرف است (P1-۲).
    // stage-79 — permitOverride (مجوزِ مصرف‌شده در همان tx): claim
    // بی‌قیدوشرط — مالکِ قبلی بازنویسی می‌شود؛ این «استثنای ممیزی‌شده‌ی
    // ادمین» است نه تغییرِ سیاست. تضمینِ پس از آن: گام ۵ (مسدودسازی).
    if (event === 'REGISTER' && config.deviceEnforcement && config.device.maxPhonesPerDevice > 0) {
      const [claimed] = await db
        .update(devices)
        .set({ registeredOwnerPhone: phone })
        .where(
          input.permitOverride
            ? eq(devices.id, device.id)
            : and(
                eq(devices.id, device.id),
                sql`(${devices.registeredOwnerPhone} is null or ${devices.registeredOwnerPhone} = ${phone})`,
              ),
        )
        .returning()
      if (claimed) {
        device = claimed
      } else {
        // بین peek و تراکنش، دستگاهِ دیگری claimش کرده — رد تمیز دامنه‌ای.
        // stage-72 (P2-۱۰): رویداد PHONE_LIMIT_BLOCKED اینجا داخل tx لاگ
        // نمی‌شود — throw کل tx را رولبک می‌کرد و رویداد ممیزی گم می‌شد؛
        // auth.service بعد از rollback (بیرون tx) آن را ثبت می‌کند.
        throw Err.devicePhoneLimit(config.device.maxPhonesPerDevice)
      }
    }

    // ── ۴) هویت + رویداد REGISTER/LOGIN ──
    await this.attachIdentityOn(db, device.id, phone, event, ip, signals.userAgent ?? null)

    // ── ۵) مسدودسازی خودکار — فقط بعد از ثبت‌نام موفق + پشت flag (P1-۳) ──
    if (
      event === 'REGISTER' &&
      config.deviceEnforcement &&
      device.riskScore >= config.device.autoblockScore &&
      !device.isBlocked
    ) {
      const [blocked] = await db
        .update(devices)
        .set({
          isBlocked: true,
          blockedAt: new Date(),
          blockedReason: `auto: ${device.riskFlags.join(',')}`,
        })
        .where(eq(devices.id, device.id))
        .returning()
      device = blocked ?? device
      await this.logEventOn(db, device.id, phone, 'AUTO_BLOCK', ip, signals.userAgent, {
        score: device.riskScore,
        flags: device.riskFlags,
      })
      await this.revokeDeviceSessionsOn(db, device.id, 'auto-block')
    }

    // ── ۵-b) stage-79 — سوختنِ سختِ مسیرِ مجوز ──
    // درخواستِ صریحِ صاحب محصول: «بعد ثبت‌نام بلاک بشه دستگاهش». این
    // تضمینِ دفاع-در-عمقِ استثناست: دستگاهی که از مسیرِ مجوز ثبت‌نام دیده،
    // برای همیشه بسته می‌ماند — حتی اگر بعداً maxPhones بالا برود یا
    // owner claim جایی جا بماند. دلیل عمداً خارج از خانواده‌ی auto:%
    // است تا هیچ جارویِ آزادسازیِ خودکاری دستش را بگیرد (بک‌فیل ۷۳
    // فقط auto:% را آزاد می‌کند و یک‌بارِ نسخه‌دار است — این دوتایی
    // دفاع-در-عمق است، نه وابستگی). دستگاهِ از-قبل-مسدود فقط رویداد
    // PERMIT_BURN می‌گیرد ( دلیل/زمانِ مسدودیِ اصلی دست‌نخورده می‌ماند).
    if (event === 'REGISTER' && input.permitOverride) {
      if (!device.isBlocked) {
        const [burned] = await db
          .update(devices)
          .set({
            isBlocked: true,
            blockedAt: new Date(),
            blockedReason: 'permit-burn',
          })
          .where(eq(devices.id, device.id))
          .returning()
        device = burned ?? device
        await this.revokeDeviceSessionsOn(db, device.id, 'permit-burn')
      }
      await this.logEventOn(db, device.id, phone, 'PERMIT_BURN', ip, signals.userAgent, {
        permitId: input.permitId ?? null,
        reason: 'permit-burn',
      })
    }

    return { device, linkedTo }
  }

  /** سهمیه: دستگاهِ جدید برای این شماره وقتی سقف پر است → خطا (ادمین معاف) */
  async assertQuota(phone: string, role: string, currentDeviceId?: string | null): Promise<void> {
    await this.assertQuotaOn(this.deps.db, phone, role, currentDeviceId)
  }

  /**
   * stage-72 (P2-۹) — نسخه‌ی tx-آگاهِ همان چک: auth.service آن را «داخلِ
   * تراکنش و بعد از قفلِ advisory شماره» صدا می‌زند. قبلاً سهمیه فقط بیرونِ
   * tx چک می‌شد؛ دو ورودِ هم‌زمانِ یک شماره (TOCTOU) می‌توانست هر دو را
   * از فیلترِ سقفِ maxDevicesPerUser رد کند و سقف رد شود.
   */
  async assertQuotaOn(
    db: DbOrTx,
    phone: string,
    role: string,
    currentDeviceId?: string | null,
  ): Promise<void> {
    const { config } = this.deps
    if (!config.deviceEnforcement) return
    if (role === 'admin') return

    const current = currentDeviceId ? asDeviceId(currentDeviceId) : null
    const others = await db
      .selectDistinct({ deviceId: deviceIdentities.deviceId })
      .from(deviceIdentities)
      .where(
        current
          ? and(eq(deviceIdentities.phone, phone), ne(deviceIdentities.deviceId, current))
          : eq(deviceIdentities.phone, phone),
      )

    if (others.length >= config.maxDevicesPerUser) {
      throw Err.deviceLimit(config.maxDevicesPerUser)
    }
  }

  /**
   * حذف دستگاه کاربر — هویت + سشن‌های همان دستگاه
   * (stage-75 P3-32 — attachIdentity عمومیِ بی‌فراخوان حذف شد: مسیر واقعی
   *  attachIdentityOn را مستقیم صدا می‌زند؛ این پوشش بی‌استفاده فقط API
   *  مرده بود.)
   */
  async revokeIdentity(userId: string, phone: string, deviceId: string): Promise<boolean> {
    const { db } = this.deps
    const id = asDeviceId(deviceId)

    const removed = await db
      .delete(deviceIdentities)
      .where(and(eq(deviceIdentities.deviceId, id), eq(deviceIdentities.phone, phone)))
      .returning({ id: deviceIdentities.id })
    if (removed.length === 0) return false

    await db
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: 'device-revoked' })
      .where(and(eq(sessions.deviceId, id), eq(sessions.userId, asUserId(userId))))
    await this.logEvent(deviceId, phone, 'IDENTITY_REMOVED', null, null, {})
    return true
  }

  /** رویداد عمومی — از AuthService برای PHONE_LIMIT_BLOCKED هم صدا زده می‌شود */
  async logEvent(
    deviceId: string,
    phone: string | null,
    event: string,
    ip?: string | null,
    userAgent?: string | null,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.logEventOn(this.deps.db, deviceId, phone, event, ip, userAgent, metadata)
  }

  // ── ادمین ──

  async listDevices(filters: {
    page: number
    limit: number
    search?: string
    blocked?: boolean
    minRisk?: number
  }): Promise<{ devices: Array<DeviceRow & { phonesCount: number }>; total: number }> {
    const { db } = this.deps
    const conditions: SQL[] = []

    if (filters.blocked !== undefined) conditions.push(eq(devices.isBlocked, filters.blocked))
    if (filters.minRisk !== undefined && filters.minRisk > 0) {
      conditions.push(gte(devices.riskScore, filters.minRisk))
    }
    if (filters.search) {
      const digits = filters.search.replace(/\D/g, '')
      if (digits.startsWith('09')) {
        // جستجوی شماره → دستگاه‌های دارای آن هویت
        // stage-55 — escape wildcard (٪ و _ و \) تا «%» کل جدول را اسکن نکند
        const ids = await db
          .selectDistinct({ deviceId: deviceIdentities.deviceId })
          .from(deviceIdentities)
          .where(ilike(deviceIdentities.phone, likePattern(filters.search)))
        conditions.push(
          ids.length > 0 ? inArray(devices.id, ids.map((x) => x.deviceId)) : sql`false`,
        )
      } else {
        // stage-55 — الگوی امنِ «شامل» با escape کاراکترهای خاصِ LIKE
        const q = likePattern(filters.search)
        const clause = or(
          ilike(devices.platform, q),
          ilike(devices.label, q),
          ilike(devices.screen, q),
          ilike(devices.clientId, q),
        )
        if (clause) conditions.push(clause)
      }
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined

    const total = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(devices)
      .where(where)
      .then((rows) => rows[0]?.count ?? 0)

    const rows = await db
      .select()
      .from(devices)
      .where(where)
      .orderBy(desc(devices.lastSeenAt))
      .limit(filters.limit)
      .offset((filters.page - 1) * filters.limit)

    const ids = rows.map((r) => r.id)
    const counts = ids.length
      ? await db
          .select({ deviceId: deviceIdentities.deviceId, count: sql<number>`count(*)::int` })
          .from(deviceIdentities)
          .where(inArray(deviceIdentities.deviceId, ids))
          .groupBy(deviceIdentities.deviceId)
      : []
    const countMap = new Map(counts.map((c) => [c.deviceId, c.count]))

    return {
      devices: rows.map((r) => ({ ...r, phonesCount: countMap.get(r.id) ?? 0 })),
      total,
    }
  }

  async getDeviceDetail(rawId: string) {
    const { db } = this.deps
    const id = asDeviceId(rawId)

    const device = await db.query.devices.findFirst({ where: eq(devices.id, id) })
    if (!device) throw Err.notFound('دستگاهی پیدا نشد.')

    const identities = await db
      .select()
      .from(deviceIdentities)
      .where(eq(deviceIdentities.deviceId, id))
      .orderBy(desc(deviceIdentities.lastLoginAt))

    const events = await db
      .select()
      .from(deviceEvents)
      .where(eq(deviceEvents.deviceId, id))
      .orderBy(desc(deviceEvents.createdAt))
      .limit(200)

    const links = await db
      .select()
      .from(deviceLinks)
      .where(or(eq(deviceLinks.deviceA, id), eq(deviceLinks.deviceB, id))!)

    const otherIds = links.map((l) => (l.deviceA === id ? l.deviceB : l.deviceA))
    const others = otherIds.length
      ? await db
          .select({
            id: devices.id,
            platform: devices.platform,
            label: devices.label,
            riskScore: devices.riskScore,
            isBlocked: devices.isBlocked,
          })
          .from(devices)
          .where(inArray(devices.id, otherIds))
      : []
    const otherMap = new Map(others.map((o) => [o.id, o]))

    return {
      device,
      identities,
      events,
      links: links.map((l) => {
        const otherId = l.deviceA === id ? l.deviceB : l.deviceA
        return {
          similarity: l.similarity,
          createdAt: l.createdAt,
          other: otherMap.get(otherId) ?? { id: otherId },
        }
      }),
    }
  }

  /** مسدود/رفع مسدود — همراه با قطع سشن‌های دستگاه */
  async setBlocked(
    rawId: string,
    blocked: boolean,
    reason: string | null,
    actorPhone: string | null,
  ): Promise<DeviceRow> {
    const { db } = this.deps
    const id = asDeviceId(rawId)

    const [updated] = await db
      .update(devices)
      .set({
        isBlocked: blocked,
        blockedAt: blocked ? new Date() : null,
        blockedReason: blocked ? (reason ?? 'admin') : null,
      })
      .where(eq(devices.id, id))
      .returning()
    if (!updated) throw Err.notFound('دستگاهی پیدا نشد.')

    await this.logEvent(rawId, null, blocked ? 'BLOCK' : 'UNBLOCK', null, null, {
      reason,
      actor: actorPhone,
    })
    if (blocked) await this.revokeDeviceSessions(rawId, 'device-blocked')
    return updated
  }

  /**
   * round-12 — چک REFERRAL_BLOCK برای دستگاهِ مشخص (پیوند معرف پس از ثبت‌نام).
   * همان قاعدهٔ signup: اگر خوشهٔ این دستگاه به تعداد زیادی شمارهٔ متفاول
   * وصل شده، معرفیِ شمارهٔ تازه فقط از همین خوشه پاداش نمی‌گیرد (ضد فارم).
   */
  async referralBlockedForDevice(deviceId: string, phone: string): Promise<number> {
    const clusterIds = await this.clusterDeviceIds(asDeviceId(deviceId))
    const rows = await this.deps.db
      .selectDistinct({ phone: deviceIdentities.phone })
      .from(deviceIdentities)
      .where(
        and(inArray(deviceIdentities.deviceId, clusterIds), ne(deviceIdentities.phone, phone)),
      )
    return rows.length
  }

  // ── داخلی ──

  /**
   * drift دو-مرحله‌ای (D3): canvas باید «دو بار پشت‌سرهم» عوض شده باشد و
   * سیگنال‌های GPU (webgl/audio) هر دو واقعی و ثابت بمانند. تغییرِ
   * تک‌رویداد (آپدیت مرورگر/درایور) دیگر پرچم نمی‌زند.
   */
  private static driftDetected(device: DeviceRow, signals: DeviceSignals): boolean {
    if (
      isMissingHash(signals.canvasHash) ||
      isMissingHash(signals.webglHash) ||
      isMissingHash(signals.audioHash) ||
      isMissingHash(device.canvasHash)
    ) {
      return false
    }
    const changedNow =
      device.canvasHash !== signals.canvasHash &&
      device.webglHash === signals.webglHash &&
      device.audioHash === signals.audioHash
    if (!changedNow) return false
    return device.prevCanvasHash !== null && device.prevCanvasHash !== device.canvasHash
  }

  private async attachIdentityOn(
    db: DbOrTx,
    deviceId: string,
    phone: string,
    event: 'LOGIN' | 'REGISTER',
    ip?: string | null,
    userAgent?: string | null,
  ): Promise<void> {
    const { config } = this.deps
    const id = asDeviceId(deviceId)

    const existing = await db.query.deviceIdentities.findFirst({
      where: and(eq(deviceIdentities.deviceId, id), eq(deviceIdentities.phone, phone)),
    })

    if (!existing) {
      const first = !(await db.query.deviceIdentities.findFirst({
        where: eq(deviceIdentities.deviceId, id),
      }))
      const crowded = (await this.countDevicePhonesOn(db, id)) >= config.device.referralBlockAfter
      await db
        .insert(deviceIdentities)
        .values({
          deviceId: id,
          phone,
          relation: first ? 'OWNER' : crowded ? 'SUSPICIOUS' : 'SECONDARY',
        })
        .onConflictDoNothing()
    } else {
      await db
        .update(deviceIdentities)
        .set({ lastLoginAt: new Date() })
        .where(eq(deviceIdentities.id, existing.id))
    }

    await this.logEventOn(db, deviceId, phone, event, ip, userAgent, {})
  }

  private async clusterDeviceIds(root: DeviceId): Promise<DeviceId[]> {
    // رارد M4 — قبلاً یک کوئری به‌ازای هر دستگاه (خوشه‌ی ۵۰تایی = تا ۵۰
    // کوئری متوالی). حالا هر «سطح» از BFS با یک inArray خوانده می‌شود —
    // عمق معمول ۲-۳ یعنی ~۳ کوئری با همان نتیجه‌ی دقیق و همان سقف.
    const visited = new Set<DeviceId>([root])
    let frontier: DeviceId[] = [root]
    while (frontier.length > 0 && visited.size < CLUSTER_CAP) {
      const rows = await this.deps.db
        .select()
        .from(deviceLinks)
        .where(
          or(
            inArray(deviceLinks.deviceA, frontier),
            inArray(deviceLinks.deviceB, frontier),
          )!,
        )
      const next: DeviceId[] = []
      for (const r of rows) {
        for (const other of [r.deviceA, r.deviceB]) {
          if (!visited.has(other)) {
            visited.add(other)
            next.push(other)
          }
        }
      }
      frontier = next
    }
    return [...visited]
  }

  private async countDevicePhonesOn(db: DbOrTx, deviceId: DeviceId): Promise<number> {
    return db
      .select({ count: sql<number>`count(*)::int` })
      .from(deviceIdentities)
      .where(eq(deviceIdentities.deviceId, deviceId))
      .then((rows) => rows[0]?.count ?? 0)
  }

  private async logEventOn(
    db: DbOrTx,
    deviceId: string,
    phone: string | null,
    event: string,
    ip?: string | null,
    userAgent?: string | null,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await db.insert(deviceEvents).values({
      deviceId: asDeviceId(deviceId),
      phone,
      event,
      ip: ip ?? null,
      userAgent: userAgent ?? null,
      metadata,
    })
  }

  private async revokeDeviceSessionsOn(db: DbOrTx, deviceId: string, reason: string): Promise<void> {
    await db
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(sessions.deviceId, asDeviceId(deviceId)), sql`${sessions.revokedAt} is null`))
  }

  private async revokeDeviceSessions(deviceId: string, reason: string): Promise<void> {
    await this.revokeDeviceSessionsOn(this.deps.db, deviceId, reason)
  }
}
