/** Durable server queue consumed by the Windows agent over outbound HTTPS. */
export type LocalPrintKind = 'sales' | 'kitchen'
export type LocalPrintMode = 'driver' | 'escpos'
export type LocalPrintWidth = 384 | 420 | 576
export type LocalPrintStatus =
	| 'queued'
	| 'claimed'
	| 'spooled'
	| 'failed'
	| 'uncertain'
	| 'cancelled'

export interface LocalPrinterDto {
	name: string
	isDefault: boolean
}
export interface LocalPrintAgentDto {
	id: string
	name: string
	printers: LocalPrinterDto[]
	lastSeenAt: string | null
	online: boolean
}
export interface LocalPrintTarget {
	agentId: string
	printerName: string
	widthDots: LocalPrintWidth
	mode: LocalPrintMode
	cut: boolean
}
export interface LocalPrintAssignment {
	sales: LocalPrintTarget | null
	kitchen: LocalPrintTarget | null
}
export interface LocalPrintJobDto {
	id: string
	agentId: string
	printerName: string
	orderId: string
	kind: LocalPrintKind
	status: LocalPrintStatus
	error: string | null
	createdAt: string
	updatedAt: string
}
export interface LocalPrintEnqueueInput {
	jobId: string
	orderId: string
	kind: LocalPrintKind
	widthPx: LocalPrintWidth
	heightPx: number
	/** Base64 1bpp, MSB-first rows, each row padded to ceil(widthPx / 8). */
	rows: string
}
export interface LocalPrintDiscardInput {
	jobId: string
	orderId: string
}
export interface LocalPrintDiscardResult {
	discarded: true
	job: LocalPrintJobDto | null
}
export interface LocalPrintClaim {
	id: string
	claimToken: string
	printerName: string
	widthPx: LocalPrintWidth
	heightPx: number
	rows: string
	copies: 1
	cut: boolean
	mode: LocalPrintMode
	jobName: string
}
export interface LocalPrintResultInput {
	claimToken: string
	status: 'spooled' | 'failed' | 'uncertain'
	error?: string
}
