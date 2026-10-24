import { Elysia, t } from 'elysia'
import type { SessionService } from '#/domain/auth/session.service'
import type { Admin2Service } from '#/domain/admin2/admin2.service'
import type { AuditService } from '#/domain/audit/audit.service'
import type { LocalPrintService } from '#/domain/print/local-print.service'
import {
	requireAdmin2,
	requireAdmin2Permission,
} from '#/http/hooks/require-admin2'
import { Err } from '#/domain/shared/errors'

export interface LocalPrintRoutesDeps {
	sessions: SessionService
	admin2: Admin2Service
	localPrint: LocalPrintService
	audit: AuditService
}
const uuid = t.String({ format: 'uuid' })
const idParams = t.Object({ id: uuid })
const width = t.Union([t.Literal(384), t.Literal(420), t.Literal(576)])
const kind = t.Union([t.Literal('sales'), t.Literal('kitchen')])
const target = t.Nullable(
	t.Object({
		agentId: uuid,
		printerName: t.String({ minLength: 1, maxLength: 256 }),
		widthDots: width,
		mode: t.Union([t.Literal('driver'), t.Literal('escpos')]),
		cut: t.Boolean(),
	}),
)
const canReadOrder = (permissions: { orderDetailsRead: boolean } | null) => {
	if (permissions && !permissions.orderDetailsRead)
		throw Err.forbidden('اجازهٔ مشاهدهٔ سفارش را ندارید.')
}

export const localPrintRoutes = (deps: LocalPrintRoutesDeps): Elysia => {
	const guards = { sessions: deps.sessions, admin2: deps.admin2 }
	const read = new Elysia({
		prefix: '/admin/print',
		tags: ['Admin / Local Print'],
	})
		.use(requireAdmin2(guards))
		.get('/agents', async () => ({
			agents: await deps.localPrint.listAgents(),
		}))
		.get('/local-assignment', () => deps.localPrint.assignment())
		.get(
			'/local-jobs',
			async ({ query, user, admin2 }) => {
				canReadOrder(admin2)
				return { jobs: await deps.localPrint.listJobs(user, query.orderId) }
			},
			{
				query: t.Object({ orderId: t.String({ minLength: 1, maxLength: 40 }) }),
			},
		)
		.get(
			'/local-jobs/:id',
			({ params, user, admin2 }) => {
				canReadOrder(admin2)
				return deps.localPrint.getJob(user, params.id)
			},
			{ params: idParams },
		)

	const manage = new Elysia({
		prefix: '/admin/print',
		tags: ['Admin / Local Print'],
	})
		.use(requireAdmin2Permission(guards, 'printingManage'))
		.post(
			'/agents',
			async ({ body, user, set }) => {
				const paired = await deps.localPrint.createAgent(body.name)
				set.headers['cache-control'] = 'no-store'
				await deps.audit.log({
					actorId: user.id,
					action: 'LOCAL_PRINT_AGENT_ADD',
					entity: 'local_print_agent',
					entityId: paired.agent.id,
				})
				return paired
			},
			{ body: t.Object({ name: t.String({ minLength: 1, maxLength: 80 }) }) },
		)
		.delete(
			'/agents/:id',
			async ({ params, user }) => {
				await deps.localPrint.revokeAgent(params.id)
				await deps.audit.log({
					actorId: user.id,
					action: 'LOCAL_PRINT_AGENT_REVOKE',
					entity: 'local_print_agent',
					entityId: params.id,
				})
				return { success: true }
			},
			{ params: idParams },
		)
		.post(
			'/local-assignment',
			async ({ body, user }) => {
				const assignment = await deps.localPrint.setAssignment(body)
				await deps.audit.log({
					actorId: user.id,
					action: 'LOCAL_PRINT_ASSIGNMENT',
					entity: 'local_print_assignment',
				})
				return assignment
			},
			{ body: t.Object({ sales: target, kitchen: target }) },
		)
		.post(
			'/local-jobs',
			async ({ body, user, admin2 }) => {
				canReadOrder(admin2)
				return deps.localPrint.enqueue(user, body)
			},
			{
				bodyLimit: 512 * 1024,
				body: t.Object({
					jobId: uuid,
					orderId: t.String({ minLength: 1, maxLength: 40 }),
					kind,
					widthPx: width,
					heightPx: t.Integer({ minimum: 1, maximum: 4000 }),
					rows: t.String({ minLength: 4, maxLength: 384_000 }),
				}),
			},
		)
		.post(
			'/local-jobs/discard-pending',
			({ body, user, admin2 }) => {
				canReadOrder(admin2)
				return deps.localPrint.discardPending(user, body)
			},
			{
				body: t.Object({
					jobId: uuid,
					orderId: t.String({ minLength: 1, maxLength: 40 }),
				}),
			},
		)
		.post(
			'/local-jobs/:id/cancel',
			({ params, user, admin2 }) => {
				canReadOrder(admin2)
				return deps.localPrint.cancelJob(user, params.id)
			},
			{ params: idParams },
		)

	// Tokens are independent of staff sessions. Only the paired outbound agent
	// can claim jobs or report outcomes; it cannot create jobs or change routing.
	const agent = new Elysia({
		prefix: '/print-agent',
		tags: ['Local Print Agent'],
	})
		.resolve({ as: 'scoped' }, async ({ request, set }) => {
			set.headers['cache-control'] = 'no-store'
			return {
				printAgentId: await deps.localPrint.authenticate(
					request.headers.get('authorization'),
				),
			}
		})
		.post(
			'/heartbeat',
			({ body, printAgentId }) =>
				deps.localPrint.heartbeat(printAgentId, body.printers),
			{
				body: t.Object({
					printers: t.Array(
						t.Object({
							name: t.String({ minLength: 1, maxLength: 256 }),
							isDefault: t.Boolean(),
						}),
						{ maxItems: 100 },
					),
				}),
			},
		)
		.post('/claim', async ({ printAgentId }) => ({
			job: await deps.localPrint.claim(printAgentId),
		}))
		.post(
			'/jobs/:id/result',
			async ({ params, body, printAgentId }) => ({
				job: await deps.localPrint.acknowledge(printAgentId, params.id, body),
			}),
			{
				params: idParams,
				body: t.Object({
					claimToken: t.String({
						minLength: 43,
						maxLength: 43,
						pattern: '^[A-Za-z0-9_-]+$',
					}),
					status: t.Union([
						t.Literal('spooled'),
						t.Literal('failed'),
						t.Literal('uncertain'),
					]),
					error: t.Optional(t.String({ maxLength: 500 })),
				}),
			},
		)
	// The browser and C# client consume explicit shared DTOs. Keep these routes
	// out of Eden's already-large inferred application type.
	return new Elysia().use(read).use(manage).use(agent) as unknown as Elysia
}
