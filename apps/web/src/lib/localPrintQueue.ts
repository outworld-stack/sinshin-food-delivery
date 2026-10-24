import type {
	LocalPrintAgentDto,
	LocalPrintAssignment,
	LocalPrintDiscardInput,
	LocalPrintDiscardResult,
	LocalPrintEnqueueInput,
	LocalPrintJobDto,
} from '@sinshin/shared'
import { authJson } from '#/lib/api-fetch'

const BASE = '/admin/print'

export async function getLocalPrintAgents(): Promise<LocalPrintAgentDto[]> {
	const result = await authJson<{ agents: LocalPrintAgentDto[] }>(
		`${BASE}/agents`,
		'GET',
	)
	return result.agents
}

/** The pairing token is returned only at creation; never store it in the PWA. */
export function pairLocalPrintAgent(
	name: string,
): Promise<{ agent: LocalPrintAgentDto; token: string }> {
	return authJson(`${BASE}/agents`, 'POST', { name })
}

export async function revokeLocalPrintAgent(id: string): Promise<void> {
	await authJson(`${BASE}/agents/${encodeURIComponent(id)}`, 'DELETE')
}

export function getLocalPrintAssignment(): Promise<LocalPrintAssignment> {
	return authJson(`${BASE}/local-assignment`, 'GET')
}

export function saveLocalPrintAssignment(
	assignment: LocalPrintAssignment,
): Promise<LocalPrintAssignment> {
	return authJson(`${BASE}/local-assignment`, 'POST', assignment)
}

export async function getLocalPrintJobs(
	orderId: string,
): Promise<LocalPrintJobDto[]> {
	const result = await authJson<{ jobs: LocalPrintJobDto[] }>(
		`${BASE}/local-jobs?orderId=${encodeURIComponent(orderId)}`,
		'GET',
	)
	return result.jobs
}

export function getLocalPrintJob(id: string): Promise<LocalPrintJobDto> {
	return authJson(`${BASE}/local-jobs/${encodeURIComponent(id)}`, 'GET')
}

/** Only queued jobs can be cancelled; the server rejects later states. */
export function cancelLocalPrintJob(id: string): Promise<LocalPrintJobDto> {
	return authJson(
		`${BASE}/local-jobs/${encodeURIComponent(id)}/cancel`,
		'POST',
		{},
	)
}

/** Atomically cancels an unclaimed request and prevents a late POST from printing it. */
export function discardPendingLocalPrintJob(
	input: LocalPrintDiscardInput,
): Promise<LocalPrintDiscardResult> {
	return authJson(`${BASE}/local-jobs/discard-pending`, 'POST', { ...input })
}

/**
 * The caller persists this exact payload before POST and retains it on failure.
 * A lost response does not prove that the job was not queued: query jobId or
 * explicitly retry this same payload. Never generate another ID, retry with a
 * changed bitmap, or open browser printing in response to a transport error.
 */
export function enqueueLocalPrintJob(
	input: LocalPrintEnqueueInput,
): Promise<LocalPrintJobDto> {
	// Snapshot the primitive payload fields before auth/language awaits. Caller
	// state changes cannot alter the request between its initial send and a 401 retry.
	return authJson(`${BASE}/local-jobs`, 'POST', { ...input })
}
