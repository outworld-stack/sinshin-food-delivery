import { sql } from 'drizzle-orm'
import {
	check,
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
import type {
	LocalPrinterDto,
	LocalPrintKind,
	LocalPrintMode,
	LocalPrintStatus,
	LocalPrintTarget,
} from '@sinshin/shared'
import { orders } from './orders'
import { users } from './users'

export const localPrintAgents = pgTable(
	'local_print_agents',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		name: varchar('name', { length: 80 }).notNull(),
		tokenHash: varchar('token_hash', { length: 64 }).notNull(),
		printers: jsonb('printers')
			.$type<LocalPrinterDto[]>()
			.notNull()
			.default([]),
		lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
		revokedAt: timestamp('revoked_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [uniqueIndex('local_print_agents_token_key').on(t.tokenHash)],
)

export const localPrintAssignments = pgTable(
	'local_print_assignments',
	{
		kind: varchar('kind', { length: 8 }).primaryKey().$type<LocalPrintKind>(),
		target: jsonb('target').$type<LocalPrintTarget>(),
		updatedAt: timestamp('updated_at', { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		check(
			'local_print_assignment_kind_check',
			sql`${t.kind} in ('sales','kitchen')`,
		),
	],
)

// Retained permanently: a delayed request must never enqueue an ID that a
// browser already discarded before starting its replacement print.
export const localPrintDiscards = pgTable('local_print_discards', {
	jobId: uuid('job_id').primaryKey(),
	orderId: uuid('order_id')
		.notNull()
		.references(() => orders.id),
	createdBy: uuid('created_by')
		.notNull()
		.references(() => users.id),
	createdAt: timestamp('created_at', { withTimezone: true })
		.notNull()
		.defaultNow(),
})

export const localPrintJobs = pgTable(
	'local_print_jobs',
	{
		id: uuid('id').primaryKey(),
		agentId: uuid('agent_id')
			.notNull()
			.references(() => localPrintAgents.id),
		orderId: uuid('order_id')
			.notNull()
			.references(() => orders.id),
		orderDisplayId: varchar('order_display_id', { length: 20 }).notNull(),
		createdBy: uuid('created_by')
			.notNull()
			.references(() => users.id),
		kind: varchar('kind', { length: 8 }).notNull().$type<LocalPrintKind>(),
		printerName: varchar('printer_name', { length: 256 }).notNull(),
		mode: varchar('mode', { length: 8 }).notNull().$type<LocalPrintMode>(),
		cut: integer('cut').notNull().default(1),
		widthPx: integer('width_px').notNull(),
		heightPx: integer('height_px').notNull(),
		rows: text('rows'),
		payloadHash: varchar('payload_hash', { length: 64 }).notNull(),
		status: varchar('status', { length: 12 })
			.notNull()
			.default('queued')
			.$type<LocalPrintStatus>(),
		claimTokenHash: varchar('claim_token_hash', { length: 64 }),
		claimedAt: timestamp('claimed_at', { withTimezone: true }),
		error: varchar('error', { length: 500 }),
		createdAt: timestamp('created_at', { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		index('local_print_jobs_agent_queue_idx').on(
			t.agentId,
			t.status,
			t.createdAt,
		),
		index('local_print_jobs_order_idx').on(t.orderId, t.createdAt),
		index('local_print_jobs_stale_idx')
			.on(t.claimedAt)
			.where(sql`${t.status} = 'claimed'`),
		uniqueIndex('local_print_jobs_active_order_kind_key')
			.on(t.orderId, t.kind)
			.where(sql`${t.status} in ('queued','claimed')`),
		check(
			'local_print_jobs_status_check',
			sql`${t.status} in ('queued','claimed','spooled','failed','uncertain','cancelled')`,
		),
		check('local_print_jobs_kind_check', sql`${t.kind} in ('sales','kitchen')`),
		check('local_print_jobs_mode_check', sql`${t.mode} in ('driver','escpos')`),
		check(
			'local_print_jobs_size_check',
			sql`${t.widthPx} in (384,420,576) and ${t.heightPx} between 1 and 4000`,
		),
	],
)
