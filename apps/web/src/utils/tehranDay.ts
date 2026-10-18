/** Gregorian Tehran date, independent of browser/server timezone and locale layout. */
export function tehranDay(date = new Date()): string {
	const parts = new Intl.DateTimeFormat('en', {
		timeZone: 'Asia/Tehran', calendar: 'gregory', numberingSystem: 'latn',
		year: 'numeric', month: '2-digit', day: '2-digit',
	}).formatToParts(date)
	const value = (type: string) => parts.find(part => part.type === type)?.value
	return `${value('year')}-${value('month')}-${value('day')}`
}

export function nextTehranDayDelay(day: string, now = Date.now()): number {
	return Math.max(1, Date.parse(`${day}T00:00:00+03:30`) + 86_400_000 - now + 100)
}
