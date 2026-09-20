//src/domain/device/device.service.ts
import { and, desc, eq, gte, ilike, inArray, ne, or, sql, type SQL } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
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
import { asDeviceId, asUserId, type DeviceId } from '#/domain/shared/brand'
import {
  compositeFingerprintHash,
  computeRiskScore,
  signalSimilarity,
  type DeviceSignals,
} from './device-signals'

const CLUSTER_CAP = 50
const SIMILARITY_CANDIDATE_CAP = 500

export interface DeviceResolution {
  device: DeviceRow
  created: boolean
  linkedTo: { deviceId: string; similarity: number }[]
  clusterPhoneCount: number
  isNewPhoneForDevice: boolean
  referralBlocked: boolean
  riskScore: number
  riskFlags: string[]
}

export class DeviceService {
  constructor(private readonly deps: { db: Db; config: AppConfig }) {}

  /**
   * حل کردن دستگاه از سیگنال‌ها — ترتیب:
   *  ۱) clientId (لایه ۱ — قوی‌ترین)
   *  ۲) هش مرکب exact
   *  ۳) شباهت با دستگاه‌های اخیر → new + link
   * بعد: امتیاز ریسک، autoblock، تصمیم REFERRAL_BLOCK.
   */
  async resolve(
    signals: DeviceSignals,
    phone: string,
    ip?: string | null,
  ): Promise<DeviceResolution> {
    const { db, config } = this.deps
    const composite = compositeFingerprintHash(signals, signals.userAgent ?? null)

    let device: DeviceRow | undefined
    let created = false
    let canvasDrift = false
    const linkedTo: { deviceId: string; similarity: number }[] = []

    // ── ۱) لایه ۱ — clientId ──
    if (signals.clientId) {
      device = await db.query.devices.findFirst({
        where: eq(devices.clientId, signals.clientId),
      })
      if (device) {
        // دفاع ضد canvas-spoofing: canvas عوض شده ولی GPU-signals ثابت
        canvasDrift =
          device.canvasHash !== signals.canvasHash &&
          device.webglHash === signals.webglHash &&
          device.audioHash === signals.audioHash
      }
    }

    // ── ۲) هش مرکب exact ──
    if (!device) {
      device = await db.query.devices.findFirst({
        where: eq(devices.fingerprintHash, composite),
      })
    }

    if (device) {
      // دستگاه شناخته‌شده — سیگنال‌های تازه را به‌روز کن (browser update / drift)
      const [updated] = await db
        .update(devices)
        .set({
          clientId: signals.clientId ?? device.clientId,
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
          lastSeenAt: new Date(),
        })
        .where(eq(devices.id, device.id))
        .returning()
      device = updated ?? device
    } else {
      // ── ۳) شباهت با پنجره‌ی اخیر → new + link ──
      const since = new Date(Date.now() - config.device.similarityWindowDays * 86_400_000)
      const candidates = await db
        .select()
        .from(devices)
        .where(gte(devices.lastSeenAt, since))
        .limit(SIMILARITY_CANDIDATE_CAP)

      const scored = candidates
        .map((c) => ({ c, sim: signalSimilarity(c, signals) }))
        .filter((x) => x.sim >= config.device.linkThreshold)
        .sort((a, b) => b.sim - a.sim)

      const [inserted] = await db
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
        })
        .returning()
      if (!inserted) throw Err.internal('ذخیره‌سازی دستگاه ناموفق بود.')
      device = inserted
      created = true

      for (const { c, sim } of scored.slice(0, 5)) {
        // جفت مرتب‌شده — بدون destructuring (noUncheckedIndexedAccess)
        const a = device.id < c.id ? device.id : c.id
        const b = device.id < c.id ? c.id : device.id
        await db
          .insert(deviceLinks)
          .values({ deviceA: a, deviceB: b, similarity: sim })
          .onConflictDoNothing()
        linkedTo.push({ deviceId: c.id, similarity: sim })
        await this.logEvent(device.id, phone, 'LINK_CREATED', ip, signals.userAgent, {
          otherDeviceId: c.id,
          similarity: sim,
        })
      }
    }

    // ── خوشه: BFS روی گراف لینک‌ها (مرورگر عوض‌شده را هم می‌گیرد) ──
    const clusterIds = await this.clusterDeviceIds(device.id)
    const clusterPhones = await db
      .selectDistinct({ phone: deviceIdentities.phone })
      .from(deviceIdentities)
      .where(
        and(inArray(deviceIdentities.deviceId, clusterIds), ne(deviceIdentities.phone, phone)),
      )

    // ── امتیاز ریسک ──
    const { score, flags } = computeRiskScore({
      signals,
      userAgent: signals.userAgent ?? null,
      clusterPhoneCount: clusterPhones.length + 1,
      canvasDrift,
    })
    if (score !== device.riskScore || JSON.stringify(flags) !== JSON.stringify(device.riskFlags)) {
      const [updated] = await db
        .update(devices)
        .set({ riskScore: score, riskFlags: flags })
        .where(eq(devices.id, device.id))
        .returning()
      device = updated ?? device
      if (flags.length > 0) {
        await this.logEvent(device.id, phone, 'RISK_FLAGGED', ip, signals.userAgent, {
          score,
          flags,
        })
      }
    }

    // ── autoblock: امولاتور/فارم ──
    if (score >= config.device.autoblockScore && !device.isBlocked) {
      const [blocked] = await db
        .update(devices)
        .set({
          isBlocked: true,
          blockedAt: new Date(),
          blockedReason: `auto: ${flags.join(',')}`,
        })
        .where(eq(devices.id, device.id))
        .returning()
      device = blocked ?? device
      await this.logEvent(device.id, phone, 'AUTO_BLOCK', ip, signals.userAgent, {
        score,
        flags,
      })
      await this.revokeDeviceSessions(device.id, 'auto-block')
    }

    const isNewPhone = !(await db.query.deviceIdentities.findFirst({
      where: and(eq(deviceIdentities.deviceId, device.id), eq(deviceIdentities.phone, phone)),
    }))

    return {
      device,
      created,
      linkedTo,
      clusterPhoneCount: clusterPhones.length,
      isNewPhoneForDevice: isNewPhone,
      referralBlocked: isNewPhone && clusterPhones.length >= config.device.referralBlockAfter,
      riskScore: score,
      riskFlags: flags,
    }
  }

  /** سهمیه: دستگاهِ جدید برای این شماره وقتی سقف پر است → خطا (ادمین معاف) */
  async assertQuota(phone: string, role: string, currentDeviceId: string): Promise<void> {
    const { db, config } = this.deps
    if (!config.deviceEnforcement) return
    if (role === 'admin') return

    const current = asDeviceId(currentDeviceId)
    const others = await db
      .selectDistinct({ deviceId: deviceIdentities.deviceId })
      .from(deviceIdentities)
      .where(and(eq(deviceIdentities.phone, phone), ne(deviceIdentities.deviceId, current)))

    if (others.length >= config.maxDevicesPerUser) {
      throw Err.deviceLimit(config.maxDevicesPerUser)
    }
  }

  /** ثبت/به‌روزرسانی هویت + رویداد LOGIN یا REGISTER */
  async attachIdentity(
    deviceId: string,
    phone: string,
    event: 'LOGIN' | 'REGISTER',
    ip?: string | null,
    userAgent?: string | null,
  ): Promise<void> {
    const { db, config } = this.deps
    const id = asDeviceId(deviceId)

    const existing = await db.query.deviceIdentities.findFirst({
      where: and(eq(deviceIdentities.deviceId, id), eq(deviceIdentities.phone, phone)),
    })

    if (!existing) {
      const first = !(await db.query.deviceIdentities.findFirst({
        where: eq(deviceIdentities.deviceId, id),
      }))
      const crowded =
        (await this.countDevicePhones(id)) >= config.device.referralBlockAfter
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

    await this.logEvent(deviceId, phone, event, ip, userAgent, {})
  }

  /** حذف دستگاه کاربر — هویت + سشن‌های همان دستگاه */
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

  /** رویداد عمومی — از AuthService برای REFERRAL_BLOCKED هم صدا زده می‌شود */
  async logEvent(
    deviceId: string,
    phone: string | null,
    event: string,
    ip?: string | null,
    userAgent?: string | null,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.deps.db.insert(deviceEvents).values({
      deviceId: asDeviceId(deviceId),
      phone,
      event,
      ip: ip ?? null,
      userAgent: userAgent ?? null,
      metadata,
    })
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
        const ids = await db
          .selectDistinct({ deviceId: deviceIdentities.deviceId })
          .from(deviceIdentities)
          .where(ilike(deviceIdentities.phone, `%${filters.search}%`))
        conditions.push(
          ids.length > 0 ? inArray(devices.id, ids.map((x) => x.deviceId)) : sql`false`,
        )
      } else {
        const q = `%${filters.search}%`
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

  // ── داخلی ──

  private async clusterDeviceIds(root: DeviceId): Promise<DeviceId[]> {
    const visited = new Set<DeviceId>([root])
    const queue: DeviceId[] = [root]
    while (queue.length > 0 && visited.size < CLUSTER_CAP) {
      const cur = queue.shift()!
      const rows = await this.deps.db
        .select()
        .from(deviceLinks)
        .where(or(eq(deviceLinks.deviceA, cur), eq(deviceLinks.deviceB, cur))!)
      for (const r of rows) {
        const other = r.deviceA === cur ? r.deviceB : r.deviceA
        if (!visited.has(other)) {
          visited.add(other)
          queue.push(other)
        }
      }
    }
    return [...visited]
  }

  private async countDevicePhones(deviceId: DeviceId): Promise<number> {
    return this.deps.db
      .select({ count: sql<number>`count(*)::int` })
      .from(deviceIdentities)
      .where(eq(deviceIdentities.deviceId, deviceId))
      .then((rows) => rows[0]?.count ?? 0)
  }

  private async revokeDeviceSessions(deviceId: string, reason: string): Promise<void> {
    await this.deps.db
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(sessions.deviceId, asDeviceId(deviceId)), sql`${sessions.revokedAt} is null`))
  }
}