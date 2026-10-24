import assert from 'node:assert/strict'
import { SQL } from 'bun'
import { Elysia } from 'elysia'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { Database } from '../src/infra/db/client'
import { localPrintAgents, localPrintDiscards, localPrintJobs, orders, users } from '../src/infra/db/schema'
import { LocalPrintService, validateLocalPrintRaster } from '../src/domain/print/local-print.service'
import { LiveService } from '../src/domain/live/live.service'
import { Admin2Service, ALL_ADMIN2_PERMISSIONS } from '../src/domain/admin2/admin2.service'
import { localPrintRoutes, type LocalPrintRoutesDeps } from '../src/http/routes/local-print.routes'
import { AppError, Err } from '../src/domain/shared/errors'
import type { LocalPrintDiscardResult, LocalPrintEnqueueInput, LocalPrintJobDto, LocalPrintTarget } from '@sinshin/shared'

const source = new URL(process.env.DATABASE_URL?.startsWith('postgres') ? process.env.DATABASE_URL : 'postgres://sinshin:sinshin_local@127.0.0.1:5432/sinshin')
assert(['localhost', '127.0.0.1', '[::1]'].includes(source.hostname), 'Only local PostgreSQL is permitted')
const scratch = `sinshin_local_print_${process.pid}_${crypto.randomUUID().slice(0, 8)}`
const adminUrl = new URL(source); adminUrl.pathname = '/postgres'
const adminDb = new SQL(adminUrl.toString(), { max: 1 })
const scratchUrl = new URL(source); scratchUrl.pathname = `/${scratch}`
let database: Database | undefined
const isStatus = (status: number) => (error: unknown) => error instanceof AppError && error.status === status
const bitmap = Buffer.alloc(72).toString('base64')
let checks = 0
function passed() { checks++ }

try {
  await adminDb.unsafe(`create database "${scratch}"`)
  database = new Database(scratchUrl.toString(), { max: 12 })
  const db = database.db
  await migrate(db, { migrationsFolder: import.meta.dir + '/../drizzle' })
  const principals = new Map<string, { id: string; role: string }>()
  for (const [index, name] of ['owner', 'manager', 'reader', 'noDetails', 'outsider', 'customer'].entries()) {
    const [row] = await db.insert(users).values({ phone: `0912000000${index}`, role: name === 'owner' ? 'admin' : name === 'customer' ? 'user' : 'admin2' }).returning()
    assert(row); principals.set(name, { id: row.id, role: row.role })
  }
  const admin2 = new Admin2Service({} as ConstructorParameters<typeof Admin2Service>[0])
  admin2.permissionsOf = async (userId) => ({ ...ALL_ADMIN2_PERMISSIONS,
    printingManage: userId !== principals.get('reader')!.id,
    orderDetailsRead: userId !== principals.get('noDetails')!.id,
  })
  admin2.scopeOf = async () => ({ hall: true, takeaway: true })
  const live = new LiveService({ db, admin2 } as ConstructorParameters<typeof LiveService>[0])
  const service = new LocalPrintService({ db, live })
  const secondService = new LocalPrintService({ db, live })
  const owner = principals.get('owner')!
  const manager = principals.get('manager')!
  const [order] = await db.insert(orders).values({ displayId: 'ord-print001', userId: owner.id as any, confirmedBy: manager.id, status: 'CONFIRMED', deliveryType: 'DINE_IN', totalAmount: 1000, breakdown: {} as any }).returning()
  assert(order)

  const pair = await service.createAgent('Restaurant POS')
  assert.equal(await service.authenticate(`Bearer ${pair.token}`), pair.agent.id)
  await assert.rejects(() => service.authenticate(`Bearer ${pair.token.slice(0, -1)}!`), isStatus(401))
  const [storedAgent] = await db.select().from(localPrintAgents).where(eq(localPrintAgents.id, pair.agent.id))
  assert.equal(storedAgent?.tokenHash.length, 64)
  assert.notEqual(storedAgent?.tokenHash, pair.token)
  assert(!JSON.stringify(await service.listAgents()).includes(pair.token))
  passed()
  await service.heartbeat(pair.agent.id, [{ name: 'Windows Printer', isDefault: true }])
  await assert.rejects(() => service.heartbeat(pair.agent.id, [{ name: 'Printer\u0085Name', isDefault: true }]), isStatus(422), 'C1 controls match Windows printer-name validation')
  assert.equal((await service.listAgents())[0]?.online, true)
  const target: LocalPrintTarget = { agentId: pair.agent.id, printerName: 'Windows Printer', widthDots: 576, mode: 'driver', cut: false }
  await service.setAssignment({ sales: target, kitchen: target })
  await service.setAssignment({ sales: { ...target, agentId: target.agentId.toUpperCase() }, kitchen: target })
  assert.equal((await service.assignment()).sales?.agentId, pair.agent.id, 'assignment stores the canonical agent UUID for revocation cleanup')
  await assert.rejects(() => service.setAssignment({ sales: { ...target, printerName: 'Missing printer' }, kitchen: null }), isStatus(422))
  assert.deepEqual(await service.assignment(), { sales: target, kitchen: target }, 'failed assignment updates are atomic')
  passed()
  const input: LocalPrintEnqueueInput = { jobId: crypto.randomUUID(), orderId: order.displayId, kind: 'sales', widthPx: 576, heightPx: 1, rows: bitmap }
  assert.throws(() => validateLocalPrintRaster({ ...input, rows: bitmap.slice(1) }), isStatus(422))
  assert.throws(() => validateLocalPrintRaster({ ...input, heightPx: 4001 }), isStatus(422))
  assert.throws(() => validateLocalPrintRaster({ ...input, rows: 'data:text/html,<script>print()</script>' }), isStatus(422))
  const narrowRaster = Buffer.alloc(106, 255)
  narrowRaster[52] = 0xf0; narrowRaster[105] = 0xf0
  validateLocalPrintRaster({ ...input, widthPx: 420, heightPx: 2, rows: narrowRaster.toString('base64') })
  narrowRaster[105] = 0xf1
  assert.throws(() => validateLocalPrintRaster({ ...input, widthPx: 420, heightPx: 2, rows: narrowRaster.toString('base64') }), isStatus(422), '420px padding must be white in every row, including the second row')
  const replay = await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? service : secondService).enqueue(manager, input)))
  assert(replay.every((job) => job.id === input.jobId && job.status === 'queued'))
  assert.equal((await db.select().from(localPrintJobs)).length, 1, 'concurrent submission/retries persist one job')
  await assert.rejects(() => service.enqueue(manager, { ...input, rows: Buffer.alloc(72, 255).toString('base64') }), isStatus(409))
  await assert.rejects(() => service.enqueue(manager, { ...input, jobId: crypto.randomUUID() }), isStatus(409))
  await assert.rejects(() => service.getJob(principals.get('outsider')!, input.jobId), isStatus(403))
  passed()
  const claims = await Promise.all(Array.from({ length: 8 }, () => service.claim(pair.agent.id)))
  const claim = claims.find((item) => item !== null)
  assert(claim)
  assert.equal(claims.filter(Boolean).length, 1, 'one paired station receives a single exclusive claim')
  assert.equal(claim.rows, bitmap)
  assert.equal(claim.copies, 1)
  assert.equal(claim.mode, 'driver')
  assert.equal(await service.claim(pair.agent.id), null, 'lost claim responses never cause automatic redelivery')
  await assert.rejects(() => service.cancelJob(manager, input.jobId), isStatus(409))
  await assert.rejects(() => service.acknowledge(pair.agent.id, claim.id, { claimToken: 'x'.repeat(43), status: 'spooled' }), isStatus(403))
  const ack = { claimToken: claim.claimToken, status: 'spooled' as const }
  assert.equal((await service.acknowledge(pair.agent.id, claim.id, ack)).status, 'spooled')
  assert.deepEqual(await service.acknowledge(pair.agent.id, claim.id, ack), await service.getJob(manager, claim.id))
  await assert.rejects(() => service.acknowledge(pair.agent.id, claim.id, { ...ack, status: 'failed' }), isStatus(409))
  assert.equal((await db.select().from(localPrintJobs).where(eq(localPrintJobs.id, claim.id)))[0]?.rows, null, 'terminal jobs discard receipt pixels while retaining idempotency metadata')
  passed()
  const cancelled = await service.enqueue(manager, { ...input, jobId: crypto.randomUUID() })
  assert.equal((await service.cancelJob(manager, cancelled.id)).status, 'cancelled')
  assert.equal((await service.cancelJob(manager, cancelled.id)).status, 'cancelled')
  assert.equal(await service.claim(pair.agent.id), null, 'cancelled queued work never reaches the agent')
  const stale = await service.enqueue(manager, { ...input, jobId: crypto.randomUUID() })
  const staleClaim = await service.claim(pair.agent.id); assert(staleClaim)
  await db.update(localPrintJobs).set({ claimedAt: new Date(Date.now() - 6 * 60_000) }).where(eq(localPrintJobs.id, stale.id))
  assert.equal((await service.getJob(manager, stale.id)).status, 'uncertain')
  assert.equal(await service.claim(pair.agent.id), null, 'stale claimed work is never auto-requeued')
  assert.equal((await service.acknowledge(pair.agent.id, stale.id, { claimToken: staleClaim.claimToken, status: 'spooled' })).status, 'spooled', 'the original claimant may acknowledge a completed spool after reconnect')
  passed()

  const racingJob = await service.enqueue(manager, { ...input, jobId: crypto.randomUUID() })
  const [cancellation, raceClaim] = await Promise.allSettled([service.cancelJob(manager, racingJob.id), service.claim(pair.agent.id)])
  assert.equal(raceClaim.status, 'fulfilled')
  if (raceClaim.status === 'fulfilled' && raceClaim.value) {
    assert.equal(cancellation.status, 'rejected', 'a received job cannot be cancelled for a browser fallback')
    await service.acknowledge(pair.agent.id, racingJob.id, { claimToken: raceClaim.value.claimToken, status: 'spooled' })
  } else {
    assert.equal(cancellation.status, 'fulfilled', 'cancel wins before claim, so the agent receives no receipt')
    assert.equal((await service.getJob(manager, racingJob.id)).status, 'cancelled')
  }
  passed()

  // A missing job is not proof that a slow original enqueue will never arrive.
  // Discard is durable and serialized with enqueue, including across instances.
  const discardedId = crypto.randomUUID()
  const discardInput = { jobId: discardedId, orderId: order.displayId }
  const discardedResults = await Promise.all(Array.from({ length: 8 }, (_, index) => (index % 2 ? service : secondService).discardPending(manager, discardInput)))
  assert(discardedResults.every((result) => result.discarded && result.job === null))
  assert.equal((await db.select().from(localPrintDiscards).where(eq(localPrintDiscards.jobId, discardedId))).length, 1)
  await service.setAssignment({ sales: { ...target, widthDots: 384 }, kitchen: target })
  await assert.rejects(() => service.enqueue(manager, { ...input, jobId: discardedId }), isStatus(409), 'delayed enqueue is blocked even after printer configuration changes')
  await service.setAssignment({ sales: target, kitchen: target })
  for (let index = 0; index < 8; index++) {
    const jobId = crypto.randomUUID()
    const [enqueue, discard]: [PromiseSettledResult<LocalPrintJobDto>, PromiseSettledResult<LocalPrintDiscardResult>] = await Promise.allSettled([
      service.enqueue(manager, { ...input, jobId }),
      secondService.discardPending(manager, { jobId, orderId: order.displayId }),
    ])
    assert.equal(discard.status, 'fulfilled')
    if (enqueue.status === 'fulfilled') {
      assert.equal((await service.getJob(manager, jobId)).status, 'cancelled', 'enqueue wins the lock, then discard cancels its queued row')
      assert.equal((await service.enqueue(manager, { ...input, jobId })).status, 'cancelled', 'late retries return a cancelled job without printing')
    } else {
      assert(isStatus(409)(enqueue.reason), 'discard wins the lock and rejects late enqueue')
      await assert.rejects(() => service.enqueue(manager, { ...input, jobId }), isStatus(409))
    }
    assert.equal(await service.claim(pair.agent.id), null, 'successful discard can never leave an agent-printable job')
  }
  passed()

  const uncertainDiscard = await service.enqueue(manager, { ...input, jobId: crypto.randomUUID() })
  const uncertainDiscardClaim = await service.claim(pair.agent.id); assert(uncertainDiscardClaim)
  const uncertainDiscardInput = { jobId: uncertainDiscard.id, orderId: order.displayId }
  await assert.rejects(() => service.discardPending(manager, uncertainDiscardInput), isStatus(409), 'claimed jobs cannot be discarded')
  await db.update(localPrintJobs).set({ claimedAt: new Date(Date.now() - 6 * 60_000) }).where(eq(localPrintJobs.id, uncertainDiscard.id))
  assert.equal((await service.getJob(manager, uncertainDiscard.id)).status, 'uncertain')
  await assert.rejects(() => service.discardPending(manager, uncertainDiscardInput), isStatus(409), 'uncertain jobs cannot be discarded')
  await service.acknowledge(pair.agent.id, uncertainDiscard.id, { claimToken: uncertainDiscardClaim.claimToken, status: 'failed' })
  assert.equal((await service.discardPending(manager, uncertainDiscardInput)).job?.status, 'failed', 'definitive failure is safe to discard')
  await assert.rejects(() => service.discardPending(manager, { jobId: input.jobId, orderId: order.displayId }), isStatus(409), 'spooled jobs cannot be discarded')

  const discardClaimRace = await service.enqueue(manager, { ...input, jobId: crypto.randomUUID() })
  const [discardRaceResult, discardRaceClaim] = await Promise.allSettled([
    service.discardPending(manager, { jobId: discardClaimRace.id, orderId: order.displayId }),
    secondService.claim(pair.agent.id),
  ])
  assert.equal(discardRaceClaim.status, 'fulfilled')
  if (discardRaceClaim.status === 'fulfilled' && discardRaceClaim.value) {
    assert(discardRaceResult.status === 'rejected' && isStatus(409)(discardRaceResult.reason), 'agent claim wins; discard must fail')
    await service.acknowledge(pair.agent.id, discardClaimRace.id, { claimToken: discardRaceClaim.value.claimToken, status: 'spooled' })
  } else {
    assert.equal(discardRaceResult.status, 'fulfilled', 'discard wins; agent must receive no job')
    assert.equal((await service.discardPending(manager, { jobId: discardClaimRace.id, orderId: order.displayId })).job?.status, 'cancelled')
  }
  passed()

  const app = new Elysia().onError(({ error, set }) => {
    if (error instanceof AppError) { set.status = error.status; return error.toJSON() }
  }).use(localPrintRoutes({ sessions: { authenticate: async (token: string) => {
    const user = principals.get(token); if (!user) throw Err.unauthorized(); return { user, ctx: {} }
  } } as unknown as LocalPrintRoutesDeps['sessions'], admin2, localPrint: service, audit: { log: async () => {} } as unknown as LocalPrintRoutesDeps['audit'] })).compile()
  const request = (path: string, token: string | null, method = 'GET', body?: unknown) => app.handle(new Request(`http://localhost${path}`, {
    method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }))
  assert.equal((await request('/admin/print/agents', 'reader')).status, 200)
  assert.equal((await request('/admin/print/agents', 'customer')).status, 403)
  assert.equal((await request('/admin/print/agents', null)).status, 401)
  assert.equal((await request('/admin/print/agents', 'reader', 'POST', { name: 'Denied' })).status, 403)
  assert.equal((await request(`/admin/print/local-jobs?orderId=${order.displayId}`, 'noDetails')).status, 403)
  assert.equal((await request(`/admin/print/local-jobs?orderId=${order.displayId}`, 'outsider')).status, 403)
  assert.equal((await request(`/admin/print/local-jobs?orderId=${order.displayId}`, 'manager')).status, 200)
  assert.equal((await request('/admin/print/local-jobs', 'noDetails', 'POST', { ...input, jobId: crypto.randomUUID() })).status, 403)
  assert.equal((await request('/print-agent/claim', 'owner', 'POST')).status, 401, 'staff sessions cannot impersonate paired agents')
  assert.equal((await request('/print-agent/heartbeat', pair.token, 'POST', { printers: [{ name: target.printerName, isDefault: true }] })).status, 200)
  assert.equal((await request('/admin/print/agents', pair.token)).status, 401, 'agent tokens grant no administrator access')
  const discardPath = '/admin/print/local-jobs/discard-pending'
  const unauthorizedDiscard = { jobId: crypto.randomUUID(), orderId: order.displayId }
  for (const principal of ['reader', 'noDetails', 'outsider', 'customer'])
    assert.equal((await request(discardPath, principal, 'POST', unauthorizedDiscard)).status, 403, `${principal} cannot discard pending jobs`)
  assert.equal((await request(discardPath, null, 'POST', unauthorizedDiscard)).status, 401)
  assert.equal((await request(discardPath, pair.token, 'POST', unauthorizedDiscard)).status, 401)
  assert.equal((await request(discardPath, 'manager', 'POST', { ...unauthorizedDiscard, jobId: 'invalid' })).status, 422)
  assert.equal((await db.select().from(localPrintDiscards).where(eq(localPrintDiscards.jobId, unauthorizedDiscard.jobId))).length, 0, 'failed authorization cannot reserve or cancel a job ID')
  const discardResponse = await request(discardPath, 'manager', 'POST', unauthorizedDiscard)
  assert.equal(discardResponse.status, 200)
  assert.deepEqual(await discardResponse.json(), { discarded: true, job: null })
  assert.equal((await request(discardPath, 'owner', 'POST', unauthorizedDiscard)).status, 200, 'owner and authorized secondary admin share the discard route')
  const [otherOrder] = await db.insert(orders).values({ displayId: 'ord-print002', userId: owner.id as any, confirmedBy: manager.id, status: 'CONFIRMED', deliveryType: 'DINE_IN', totalAmount: 1000, breakdown: {} as any }).returning()
  assert(otherOrder)
  assert.equal((await request(discardPath, 'manager', 'POST', { jobId: discardedId, orderId: otherOrder.displayId })).status, 409, 'a tombstone cannot be reassigned to a different order')
  assert.equal((await request(discardPath, 'manager', 'POST', { jobId: input.jobId, orderId: otherOrder.displayId })).status, 409, 'a job cannot be cancelled through another order')
  passed()

  const revokeClaimed = await service.enqueue(manager, { ...input, jobId: crypto.randomUUID() })
  assert(await service.claim(pair.agent.id))
  const revokeQueued = await service.enqueue(manager, { ...input, jobId: crypto.randomUUID(), kind: 'kitchen' })
  await service.revokeAgent(pair.agent.id)
  assert.deepEqual(await service.assignment(), { sales: null, kitchen: null })
  assert.equal((await service.getJob(manager, revokeQueued.id)).status, 'cancelled')
  assert.equal((await service.getJob(manager, revokeClaimed.id)).status, 'uncertain')
  await assert.rejects(() => service.authenticate(`Bearer ${pair.token}`), isStatus(401))
  await assert.rejects(() => service.claim(pair.agent.id), isStatus(401))
  passed()

  // Fill a station to one slot below its limit, then race two different orders.
  // The quota and insert must share a transaction lock across API instances.
  const quotaPair = await service.createAgent('Quota station')
  await service.heartbeat(quotaPair.agent.id, [{ name: target.printerName, isDefault: true }])
  await service.setAssignment({ sales: { ...target, agentId: quotaPair.agent.id }, kitchen: null })
  const quotaOrders = await db.insert(orders).values(Array.from({ length: 501 }, (_, index) => ({
    displayId: `ord-q${String(index).padStart(7, '0')}`, userId: owner.id as any,
    confirmedBy: manager.id, status: 'CONFIRMED' as const, deliveryType: 'DINE_IN' as const, totalAmount: 1000, breakdown: {} as any,
  }))).returning()
  await db.insert(localPrintJobs).values(quotaOrders.slice(0, 499).map((entry) => ({
    id: crypto.randomUUID(), agentId: quotaPair.agent.id, orderId: entry.id, orderDisplayId: entry.displayId,
    createdBy: manager.id, kind: 'sales' as const, printerName: target.printerName, mode: 'driver' as const,
    widthPx: 576, heightPx: 1, rows: bitmap, payloadHash: '0'.repeat(64),
  })))
  const quotaResults = await Promise.allSettled(quotaOrders.slice(499).map((entry) => service.enqueue(manager, { ...input, jobId: crypto.randomUUID(), orderId: entry.displayId })))
  assert.equal(quotaResults.filter((entry) => entry.status === 'fulfilled').length, 1)
  const quotaFailure = quotaResults.find((entry) => entry.status === 'rejected')
  assert(quotaFailure?.status === 'rejected' && isStatus(429)(quotaFailure.reason), 'the competing enqueue receives a bounded queue error')
  passed()
  console.log(`Local print queue passed ${checks} groups: migrations, pairing, raster validation, concurrent idempotency/claims/discard, authorization, cancellation, stale claims, ACK recovery and revocation.`)
} finally {
  await database?.close()
  await adminDb.unsafe(`drop database if exists "${scratch}" with (force)`)
  await adminDb.close()
}
