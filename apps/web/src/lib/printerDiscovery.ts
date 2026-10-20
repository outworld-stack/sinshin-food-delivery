import type { PrinterDiscoveryDto, PrinterDto } from '@sinshin/shared'
import { addAdminPrinter, getAdminPrinters } from '#/server/admin'

export const PRINTER_DISCOVERY_KEY = ['admin-printer-discovery'] as const

export const discoveryValue = (printer: PrinterDiscoveryDto): string =>
	`discovered:${printer.host}:${printer.port}`

/** Selecting a discovery registers only that device; a scan never changes defaults. */
export async function registerDiscoveredPrinter(
	printer: PrinterDiscoveryDto,
	registered: PrinterDto[],
): Promise<PrinterDto> {
	const existing = registered.find(
		(item) => item.host === printer.host && item.port === printer.port,
	)
	if (existing) return existing
	try {
		return await addAdminPrinter({
			name: `چاپگر ${printer.host}`,
			host: printer.host,
			port: printer.port,
			widthDots: 576,
			autoCut: true,
		})
	} catch (error) {
		// Another station may have selected the same device during our scan.
		if ((error as { status?: number } | null)?.status === 409) {
			const current = await getAdminPrinters()
			const duplicate = current.find(
				(item) => item.host === printer.host && item.port === printer.port,
			)
			if (duplicate) return duplicate
		}
		throw error
	}
}
