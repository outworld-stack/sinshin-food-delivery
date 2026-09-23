//src/infra/db/schema/devices.ts
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import type { DeviceId } from '#/domain/shared/brand'

/**
 * دستگاه فیزیکی — موجودیت جهانی (بدون user).
 * لایه ۱: client_id (uuid کوکی کلاینت — قوی‌ترین شناسه)
 * لایه ۲: هش‌های جزئی (canvas/webgl/audio/fonts) + سیگنال‌های خام
 * fingerprint_hash = sha256(ترکیب مرتب‌شده) — سمت سرور ساخته می‌شود.
 */
export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<DeviceId>(),
    clientId: varchar('client_id', { length: 64 }),
    fingerprintHash: varchar('fingerprint_hash', { length: 64 }).notNull(),
    canvasHash: varchar('canvas_hash', { length: 64 }).notNull(),
    webglHash: varchar('webgl_hash', { length: 64 }).notNull(),
    audioHash: varchar('audio_hash', { length: 64 }).notNull(),
    fontsHash: varchar('fonts_hash', { length: 64 }).notNull(),
    screen: varchar('screen', { length: 40 }),
    platform: varchar('platform', { length: 60 }),
    timezone: varchar('timezone', { length: 60 }),
    language: varchar('language', { length: 20 }),
    hardwareConcurrency: integer('hardware_concurrency'),
    deviceMemory: integer('device_memory'),
    touch: boolean('touch').notNull().default(false),
    networkType: varchar('network_type', { length: 20 }),
    userAgent: text('user_agent'),
    label: varchar('label', { length: 100 }),
    riskScore: integer('risk_score').notNull().default(0),
    riskFlags: jsonb('risk_flags').$type<string[]>().notNull().default([]),
    isBlocked: boolean('is_blocked').notNull().default(false),
    blockedAt: timestamp('blocked_at', { withTimezone: true }),
    blockedReason: varchar('blocked_reason', { length: 120 }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('devices_fingerprint_hash_key').on(t.fingerprintHash),
    index('devices_client_id_idx').on(t.clientId),
    index('devices_last_seen_idx').on(t.lastSeenAt),
    index('devices_blocked_idx').on(t.isBlocked),
    index('devices_risk_idx').on(t.riskScore),
  ],
)

/** دستگاه ↔ شماره‌ها — چند-به-چند */
export const deviceIdentities = pgTable(
  'device_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deviceId: uuid('device_id')
      .notNull()
      .$type<DeviceId>()
      .references(() => devices.id, { onDelete: 'cascade' }),
    phone: varchar('phone', { length: 11 }).notNull(),
    relation: varchar('relation', { length: 20 }).notNull().default('SECONDARY'),
    firstLoginAt: timestamp('first_login_at', { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('device_identities_key').on(t.deviceId, t.phone),
    index('device_identities_phone_idx').on(t.phone),
  ],
)

/** رویدادهای دستگاه — append-only audit */
export const deviceEvents = pgTable(
  'device_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deviceId: uuid('device_id')
      .notNull()
      .$type<DeviceId>()
      .references(() => devices.id, { onDelete: 'cascade' }),
    phone: varchar('phone', { length: 11 }),
    event: varchar('event', { length: 30 }).notNull(),
    ip: varchar('ip', { length: 45 }),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('device_events_device_idx').on(t.deviceId, t.createdAt),
    index('device_events_event_idx').on(t.event),
    /** round-16 — لاگ‌های کاربر در پنل ادمین: where phone=… order by created_at desc — قبلاً seq scan + sort */
    index('device_events_phone_created_idx').on(t.phone, t.createdAt),
  ],
)

/** گراف شباهت — جفت مرتب‌شده (a < b) */
export const deviceLinks = pgTable(
  'device_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deviceA: uuid('device_a')
      .notNull()
      .$type<DeviceId>()
      .references(() => devices.id, { onDelete: 'cascade' }),
    deviceB: uuid('device_b')
      .notNull()
      .$type<DeviceId>()
      .references(() => devices.id, { onDelete: 'cascade' }),
    similarity: doublePrecision('similarity').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('device_links_pair_key').on(t.deviceA, t.deviceB),
    index('device_links_a_idx').on(t.deviceA),
    index('device_links_b_idx').on(t.deviceB),
  ],
)

export type DeviceRow = typeof devices.$inferSelect
export type NewDeviceRow = typeof devices.$inferInsert
export type DeviceIdentityRow = typeof deviceIdentities.$inferSelect
export type DeviceEventRow = typeof deviceEvents.$inferSelect
export type DeviceLinkRow = typeof deviceLinks.$inferSelect