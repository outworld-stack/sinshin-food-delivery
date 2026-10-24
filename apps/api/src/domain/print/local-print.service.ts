import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { and, asc, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm'
import type {
	LocalPrintAgentDto,
	LocalPrintAssignment,
	LocalPrintClaim,
	LocalPrintDiscardInput,
	LocalPrintDiscardResult,
	LocalPrintEnqueueInput,
	LocalPrintJobDto,
	LocalPrinterDto,
	LocalPrintResultInput,
} from '@sinshin/shared'
import type { Db, DbOrTx, Tx } from '#/infra/db/client'
import {
	localPrintAgents as agents,
	localPrintAssignments as assignments,
	localPrintDiscards as discards,
	localPrintJobs as jobs,
} from '#/infra/db/schema'
import type { LiveService } from '#/domain/live/live.service'
import { Err } from '#/domain/shared/errors'

type AgentRow = typeof agents.$inferSelect
type JobRow = typeof jobs.$inferSelect
type Viewer = { id: string; role: string }
const ACTIVE = ['queued', 'claimed'] as const
const STALE_CLAIM_MS = 5 * 60_000
const ONLINE_MS = 45_000
const MAX_QUEUE_PER_AGENT = 500
const MAX_QUEUE_TOTAL = 2000
const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const digest = (value: string) =>
	createHash('sha256').update(value).digest('hex')
const sameHash = (left: string, right: string) =>
	timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))

export function validateLocalPrintRaster(input: LocalPrintEnqueueInput): void {
	if (
		![384, 420, 576].includes(input.widthPx) ||
		!Number.isInteger(input.heightPx) ||
		input.heightPx < 1 ||
		input.heightPx > 4000
	) {
		throw Err.validation('ابعاد رسید معتبر نیست.')
	}
	const stride = Math.ceil(input.widthPx / 8)
	const bytes = stride * input.heightPx
	if (
		typeof input.rows !== 'string' ||
		input.rows.length !== 4 * Math.ceil(bytes / 3) ||
		!/^[A-Za-z0-9+/]*={0,2}$/.test(input.rows)
	) {
		throw Err.validation('دادهٔ تصویر رسید معتبر نیست.')
	}
	const decoded = Buffer.from(input.rows, 'base64')
	if (decoded.length !== bytes || decoded.toString('base64') !== input.rows)
		throw Err.validation('دادهٔ تصویر رسید معتبر نیست.')
	const paddingMask = (1 << ((8 - (input.widthPx % 8)) % 8)) - 1
	for (let row = 0; paddingMask && row < input.heightPx; row++) {
		if ((decoded[(row + 1) * stride - 1]! & paddingMask) !== 0)
			throw Err.validation('بیت‌های خارج از عرض تصویر رسید باید سفید باشند.')
	}
}

function printerName(value: string): string {
	if (
		typeof value !== 'string' ||
		!value.trim() ||
		value.length > 256 ||
		/[\x00-\x1f\x7f-\x9f]/.test(value)
	)
		throw Err.validation('نام چاپگر معتبر نیست.')
	return value.trim()
}

export class LocalPrintService {
	constructor(
		private readonly deps: {
			db: Db
			live: Pick<LiveService, 'assertOrderViewable'>
		},
	) {}

	private agentDto(row: AgentRow): LocalPrintAgentDto {
		return {
			id: row.id,
			name: row.name,
			printers: row.printers,
			lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
			online:
				!row.revokedAt &&
				!!row.lastSeenAt &&
				Date.now() - row.lastSeenAt.getTime() < ONLINE_MS,
		}
	}

	private jobDto(row: JobRow): LocalPrintJobDto {
		return {
			id: row.id,
			agentId: row.agentId,
			printerName: row.printerName,
			orderId: row.orderDisplayId,
			kind: row.kind,
			status: row.status,
			error: row.error,
			createdAt: row.createdAt.toISOString(),
			updatedAt: row.updatedAt.toISOString(),
		}
	}

	private async configLock(tx: Tx) {
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtextextended('local-print:config', 0))`,
		)
	}

	private async activeAgent(
		tx: Tx,
		id: string,
		authenticatedAgent = true,
	): Promise<AgentRow> {
		const [row] = await tx
			.select()
			.from(agents)
			.where(eq(agents.id, id))
			.for('update')
		if (!row || row.revokedAt) {
			if (authenticatedAgent)
				throw Err.unauthorized('اتصال عامل چاپ لغو شده است.')
			throw Err.conflict('ایستگاه چاپ فعال نیست؛ ایستگاه دیگری انتخاب کنید.')
		}
		return row
	}

	private async expireClaims(db: DbOrTx = this.deps.db, agentId?: string) {
		await db
			.update(jobs)
			.set({
				status: 'uncertain',
				rows: null,
				error:
					'پاسخ عامل چاپ دریافت نشد؛ قبل از چاپ مجدد، خروجی چاپگر را بررسی کنید.',
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(jobs.status, 'claimed'),
					lt(jobs.claimedAt, new Date(Date.now() - STALE_CLAIM_MS)),
					agentId ? eq(jobs.agentId, agentId) : undefined,
				),
			)
	}

	async listAgents(): Promise<LocalPrintAgentDto[]> {
		const rows = await this.deps.db
			.select()
			.from(agents)
			.where(isNull(agents.revokedAt))
			.orderBy(asc(agents.createdAt))
			.limit(100)
		return rows.map((row) => this.agentDto(row))
	}

	async createAgent(
		name: string,
	): Promise<{ agent: LocalPrintAgentDto; token: string }> {
		const clean = name.trim()
		if (!clean || clean.length > 80 || /[\x00-\x1f]/.test(clean))
			throw Err.validation('نام ایستگاه چاپ معتبر نیست.')
		return this.deps.db.transaction(async (tx) => {
			await this.configLock(tx)
			const [countRow] = await tx
				.select({ count: sql<number>`count(*)::int` })
				.from(agents)
				.where(isNull(agents.revokedAt))
			if ((countRow?.count ?? 0) >= 100)
				throw Err.rateLimited('حداکثر تعداد ایستگاه‌های چاپ ثبت شده است.')
			const id = crypto.randomUUID()
			const token = `${id}.${randomBytes(32).toString('base64url')}`
			const [row] = await tx
				.insert(agents)
				.values({ id, name: clean, tokenHash: digest(token) })
				.returning()
			if (!row) throw Err.internal('ثبت عامل چاپ انجام نشد.')
			return { agent: this.agentDto(row), token }
		})
	}

	async authenticate(authorization: string | null): Promise<string> {
		const token = authorization?.startsWith('Bearer ')
			? authorization.slice(7)
			: ''
		const parts = token.split('.')
		const [agentId, secret] = parts
		if (
			parts.length !== 2 ||
			!agentId ||
			!secret ||
			!UUID.test(agentId) ||
			!/^[A-Za-z0-9_-]{43}$/.test(secret)
		)
			throw Err.unauthorized('کلید عامل چاپ معتبر نیست.')
		const [row] = await this.deps.db
			.select()
			.from(agents)
			.where(eq(agents.id, agentId))
		const expected = row?.tokenHash ?? '0'.repeat(64)
		if (!sameHash(expected, digest(token)) || !row || row.revokedAt)
			throw Err.unauthorized('کلید عامل چاپ معتبر نیست.')
		return row.id
	}

	async revokeAgent(id: string): Promise<void> {
		await this.deps.db.transaction(async (tx) => {
			await this.configLock(tx)
			const [row] = await tx
				.select()
				.from(agents)
				.where(eq(agents.id, id))
				.for('update')
			if (!row) throw Err.notFound('ایستگاه چاپ یافت نشد.')
			if (row.revokedAt) return
			const now = new Date()
			await tx.update(agents).set({ revokedAt: now }).where(eq(agents.id, id))
			await tx
				.update(assignments)
				.set({ target: null, updatedAt: now })
				.where(sql`${assignments.target}->>'agentId' = ${id}`)
			await tx
				.update(jobs)
				.set({
					status: 'cancelled',
					rows: null,
					error: 'اتصال ایستگاه چاپ لغو شد.',
					updatedAt: now,
				})
				.where(and(eq(jobs.agentId, id), eq(jobs.status, 'queued')))
			await tx
				.update(jobs)
				.set({
					status: 'uncertain',
					rows: null,
					error: 'اتصال عامل هنگام پردازش لغو شد؛ خروجی چاپگر را بررسی کنید.',
					updatedAt: now,
				})
				.where(and(eq(jobs.agentId, id), eq(jobs.status, 'claimed')))
		})
	}

	async assignment(db: DbOrTx = this.deps.db): Promise<LocalPrintAssignment> {
		const rows = await db.select().from(assignments)
		const result: LocalPrintAssignment = { sales: null, kitchen: null }
		for (const row of rows) result[row.kind] = row.target
		return result
	}

	async setAssignment(
		input: LocalPrintAssignment,
	): Promise<LocalPrintAssignment> {
		return this.deps.db.transaction(async (tx) => {
			await this.configLock(tx)
			for (const kind of ['sales', 'kitchen'] as const) {
				let target = input[kind]
				if (target) {
					const agent = await this.activeAgent(tx, target.agentId, false)
					const name = printerName(target.printerName)
					if (!agent.printers.some((printer) => printer.name === name))
						throw Err.validation('چاپگر انتخاب‌شده در ایستگاه گزارش نشده است.')
					if (
						![384, 420, 576].includes(target.widthDots) ||
						!['driver', 'escpos'].includes(target.mode)
					)
						throw Err.validation('تنظیم چاپگر معتبر نیست.')
					target = {
						agentId: agent.id,
						printerName: name,
						widthDots: target.widthDots,
						mode: target.mode,
						cut: target.cut,
					}
				}
				await tx
					.insert(assignments)
					.values({ kind, target, updatedAt: new Date() })
					.onConflictDoUpdate({
						target: assignments.kind,
						set: { target, updatedAt: new Date() },
					})
			}
			return this.assignment(tx)
		})
	}

	async heartbeat(
		agentId: string,
		printers: LocalPrinterDto[],
	): Promise<{ agentId: string }> {
		if (printers.length > 100)
			throw Err.validation('تعداد چاپگرها بیش از حد مجاز است.')
		const names = new Set<string>()
		const normalized = printers.map((printer) => {
			const name = printerName(printer.name)
			if (names.has(name)) throw Err.validation('نام چاپگر تکراری است.')
			names.add(name)
			return { name, isDefault: printer.isDefault === true }
		})
		await this.deps.db.transaction(async (tx) => {
			await this.activeAgent(tx, agentId)
			await tx
				.update(agents)
				.set({ printers: normalized, lastSeenAt: new Date() })
				.where(eq(agents.id, agentId))
		})
		return { agentId }
	}

	async enqueue(
		viewer: Viewer,
		input: LocalPrintEnqueueInput,
	): Promise<LocalPrintJobDto> {
		validateLocalPrintRaster(input)
		const order = await this.deps.live.assertOrderViewable(
			viewer.id,
			viewer.role,
			input.orderId,
		)
		const payloadHash = digest(
			JSON.stringify([
				order.displayId,
				input.kind,
				input.widthPx,
				input.heightPx,
				input.rows,
			]),
		)
		await this.expireClaims()
		return this.deps.db.transaction(async (tx) => {
			await this.configLock(tx)
			const [discarded] = await tx
				.select({ jobId: discards.jobId })
				.from(discards)
				.where(eq(discards.jobId, input.jobId))
			if (discarded)
				throw Err.conflict('این درخواست چاپ کنار گذاشته شده است؛ درخواست تازه‌ای ایجاد کنید.')
			const [existing] = await tx
				.select()
				.from(jobs)
				.where(eq(jobs.id, input.jobId))
			if (existing) {
				if (
					existing.orderId !== order.id ||
					!sameHash(existing.payloadHash, payloadHash)
				)
					throw Err.conflict('شناسهٔ چاپ با محتوای متفاوت تکرار شده است.')
				return this.jobDto(existing)
			}
			const target = (await this.assignment(tx))[input.kind]
			if (!target)
				throw Err.validation('برای این نوع فاکتور چاپگر محلی انتخاب نشده است.')
			await this.activeAgent(tx, target.agentId, false)
			if (target.widthDots !== input.widthPx)
				throw Err.conflict(
					'عرض چاپگر تغییر کرده است؛ پیش‌نمایش را دوباره آماده کنید.',
				)
			const [active] = await tx
				.select({ id: jobs.id })
				.from(jobs)
				.where(
					and(
						eq(jobs.orderId, order.id),
						eq(jobs.kind, input.kind),
						inArray(jobs.status, [...ACTIVE]),
					),
				)
				.limit(1)
			if (active)
				throw Err.conflict(
					'این فاکتور از قبل در صف چاپ است؛ ابتدا وضعیت آن را بررسی کنید.',
				)
			const [counts] = await tx
				.select({
					total: sql<number>`count(*)::int`,
					station: sql<number>`count(*) filter (where ${jobs.agentId} = ${target.agentId})::int`,
				})
				.from(jobs)
				.where(inArray(jobs.status, [...ACTIVE]))
			if (
				(counts?.total ?? 0) >= MAX_QUEUE_TOTAL ||
				(counts?.station ?? 0) >= MAX_QUEUE_PER_AGENT
			)
				throw Err.rateLimited('صف چاپ پر است؛ اتصال ایستگاه را بررسی کنید.')
			const [row] = await tx
				.insert(jobs)
				.values({
					id: input.jobId,
					agentId: target.agentId,
					printerName: target.printerName,
					orderId: order.id,
					orderDisplayId: order.displayId,
					createdBy: viewer.id,
					kind: input.kind,
					widthPx: input.widthPx,
					heightPx: input.heightPx,
					rows: input.rows,
					payloadHash,
					mode: target.mode,
					cut: target.cut ? 1 : 0,
				})
				.returning()
			if (!row) throw Err.internal('ثبت کار چاپ انجام نشد.')
			return this.jobDto(row)
		})
	}

	async listJobs(viewer: Viewer, orderId: string): Promise<LocalPrintJobDto[]> {
		const order = await this.deps.live.assertOrderViewable(
			viewer.id,
			viewer.role,
			orderId,
		)
		await this.expireClaims()
		return (
			await this.deps.db
				.select()
				.from(jobs)
				.where(eq(jobs.orderId, order.id))
				.orderBy(
					sql`case when ${jobs.status} in ('queued','claimed') then 0 else 1 end`,
					desc(jobs.createdAt),
					desc(jobs.id),
				)
				.limit(20)
		).map((row) => this.jobDto(row))
	}

	async getJob(viewer: Viewer, id: string): Promise<LocalPrintJobDto> {
		await this.expireClaims()
		const [row] = await this.deps.db.select().from(jobs).where(eq(jobs.id, id))
		if (!row) throw Err.notFound('کار چاپ یافت نشد.')
		await this.deps.live.assertOrderViewable(
			viewer.id,
			viewer.role,
			row.orderDisplayId,
		)
		return this.jobDto(row)
	}

	async cancelJob(viewer: Viewer, id: string): Promise<LocalPrintJobDto> {
		await this.getJob(viewer, id)
		const [cancelled] = await this.deps.db
			.update(jobs)
			.set({ status: 'cancelled', rows: null, updatedAt: new Date() })
			.where(and(eq(jobs.id, id), eq(jobs.status, 'queued')))
			.returning()
		if (cancelled) return this.jobDto(cancelled)
		const current = await this.getJob(viewer, id)
		if (current.status === 'cancelled') return current
		throw Err.conflict(
			'عامل چاپ این کار را دریافت کرده است؛ لغو یا چاپ جایگزین خودکار مجاز نیست.',
		)
	}

	async discardPending(
		viewer: Viewer,
		input: LocalPrintDiscardInput,
	): Promise<LocalPrintDiscardResult> {
		const order = await this.deps.live.assertOrderViewable(
			viewer.id,
			viewer.role,
			input.orderId,
		)
		return this.deps.db.transaction(async (tx) => {
			// A GET 404 is insufficient: the original enqueue may still arrive.
			// Share its lock so either we cancel its row or block its ID forever.
			await this.configLock(tx)
			const [existing] = await tx
				.select()
				.from(jobs)
				.where(eq(jobs.id, input.jobId))
				.for('update')
			if (existing) {
				if (existing.orderId !== order.id)
					throw Err.conflict('شناسهٔ چاپ متعلق به این سفارش نیست.')
				if (existing.status === 'queued') {
					const [cancelled] = await tx
						.update(jobs)
						.set({ status: 'cancelled', rows: null, updatedAt: new Date() })
						.where(eq(jobs.id, existing.id))
						.returning()
					if (!cancelled) throw Err.internal('لغو درخواست چاپ انجام نشد.')
					return { discarded: true, job: this.jobDto(cancelled) }
				}
				if (existing.status === 'cancelled' || existing.status === 'failed')
					return { discarded: true, job: this.jobDto(existing) }
				throw Err.conflict(
					'این درخواست ممکن است چاپ شده باشد؛ پیش از چاپ مجدد، وضعیت درخواست و خروجی چاپگر را بررسی کنید.',
				)
			}
			const [discarded] = await tx
				.select()
				.from(discards)
				.where(eq(discards.jobId, input.jobId))
			if (discarded && discarded.orderId !== order.id)
				throw Err.conflict('شناسهٔ چاپ متعلق به این سفارش نیست.')
			if (!discarded)
				await tx.insert(discards).values({
					jobId: input.jobId,
					orderId: order.id,
					createdBy: viewer.id,
				})
			return { discarded: true, job: null }
		})
	}

	async claim(agentId: string): Promise<LocalPrintClaim | null> {
		await this.expireClaims(this.deps.db, agentId)
		return this.deps.db.transaction(async (tx) => {
			await this.activeAgent(tx, agentId)
			await tx
				.update(agents)
				.set({ lastSeenAt: new Date() })
				.where(eq(agents.id, agentId))
			const [pending] = await tx
				.select({ id: jobs.id })
				.from(jobs)
				.where(and(eq(jobs.agentId, agentId), eq(jobs.status, 'claimed')))
				.limit(1)
			if (pending) return null
			const [row] = await tx
				.select()
				.from(jobs)
				.where(and(eq(jobs.agentId, agentId), eq(jobs.status, 'queued')))
				.orderBy(asc(jobs.createdAt), asc(jobs.id))
				.limit(1)
				.for('update', { skipLocked: true })
			if (!row) return null
			if (!row.rows) throw Err.internal('تصویر رسید در صف موجود نیست.')
			const claimToken = randomBytes(32).toString('base64url')
			const now = new Date()
			await tx
				.update(jobs)
				.set({
					status: 'claimed',
					claimTokenHash: digest(claimToken),
					claimedAt: now,
					updatedAt: now,
				})
				.where(eq(jobs.id, row.id))
			return {
				id: row.id,
				claimToken,
				printerName: row.printerName,
				widthPx: row.widthPx as LocalPrintClaim['widthPx'],
				heightPx: row.heightPx,
				rows: row.rows,
				copies: 1,
				cut: row.cut === 1,
				mode: row.mode,
				jobName: `Sinshin ${row.orderDisplayId} ${row.kind}`,
			}
		})
	}

	async acknowledge(
		agentId: string,
		id: string,
		input: LocalPrintResultInput,
	): Promise<LocalPrintJobDto> {
		return this.deps.db.transaction(async (tx) => {
			await this.activeAgent(tx, agentId)
			const [row] = await tx
				.select()
				.from(jobs)
				.where(and(eq(jobs.id, id), eq(jobs.agentId, agentId)))
				.for('update')
			if (!row) throw Err.notFound('کار چاپ یافت نشد.')
			if (
				!row.claimTokenHash ||
				!sameHash(row.claimTokenHash, digest(input.claimToken))
			)
				throw Err.forbidden('شناسهٔ دریافت کار چاپ معتبر نیست.')
			// A lost ACK may be retried after reconnect. Never change an already
			// definitive result or resend the receipt as part of acknowledgment.
			if (row.status === input.status) return this.jobDto(row)
			if (row.status !== 'claimed' && row.status !== 'uncertain')
				throw Err.conflict('نتیجهٔ نهایی کار چاپ قبلاً ثبت شده است.')
			const [updated] = await tx
				.update(jobs)
				.set({
					status: input.status,
					rows: null,
					error:
						input.status === 'spooled'
							? null
							: input.error?.trim().slice(0, 500) ||
								'عامل چاپ نتیجهٔ قطعی موفق گزارش نکرد.',
					updatedAt: new Date(),
				})
				.where(eq(jobs.id, id))
				.returning()
			if (!updated) throw Err.internal('ثبت نتیجهٔ چاپ انجام نشد.')
			return this.jobDto(updated)
		})
	}
}
