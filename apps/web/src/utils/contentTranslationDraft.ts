import type { ContentCollectionIdentity, ContentFieldPath } from '@sinshin/shared'

export const CONTENT_RELOAD_MESSAGE = 'نسخه ذخیره‌شده محتوا تغییر کرده یا در دسترس نیست. صفحه را تازه کنید و تغییرات خود را دوباره بررسی کنید؛ پیش‌نویس شما حفظ شده است.'

/** Updates must use the saved snapshot, never a token derived from edited text. */
export function requireContentSourceRevision(revision: string | undefined): string {
	if (!revision) throw Object.assign(new Error(CONTENT_RELOAD_MESSAGE), { status: 409, code: 'CONTENT_SOURCE_CONFLICT' })
	return revision
}
export function requireContentSourceRevisions(revisions: Record<string, string> | undefined): Record<string, string> {
	if (!revisions || !Object.keys(revisions).length) requireContentSourceRevision(undefined)
	for (const revision of Object.values(revisions ?? {})) requireContentSourceRevision(revision)
	return revisions ?? {}
}
export function contentRevisionMap(rows: { id: string; sourceRevision?: string }[]): Record<string, string> {
	return Object.fromEntries(rows.map(row => [row.id, requireContentSourceRevision(row.sourceRevision)]))
}

const samePath = (left: ContentFieldPath, right: ContentFieldPath) => JSON.stringify(left) === JSON.stringify(right)
export function collectionIds(identities: ContentCollectionIdentity[], path: ContentFieldPath): string[] {
	return identities.find(entry => samePath(entry.collectionPath, path))?.itemIds ?? []
}
export function setCollectionIds(identities: ContentCollectionIdentity[], path: ContentFieldPath, itemIds: string[]): ContentCollectionIdentity[] {
	return [...identities.filter(entry => !samePath(entry.collectionPath, path)), { collectionPath: [...path], itemIds: [...itemIds] }]
}
export function appendCollectionIdentity(identities: ContentCollectionIdentity[], path: ContentFieldPath): ContentCollectionIdentity[] {
	const prefix = path.length === 1 ? String(path[0]) : `${collectionIds(identities, [path[0] as string])[Number(path[1])]}:items`
	return setCollectionIds(identities, path, [...collectionIds(identities, path), `${prefix}:${crypto.randomUUID()}`])
}
export function removeCollectionIdentity(identities: ContentCollectionIdentity[], path: ContentFieldPath, index: number): ContentCollectionIdentity[] {
	const removed = setCollectionIds(identities, path, collectionIds(identities, path).filter((_, at) => at !== index))
	if (path.length !== 1) return removed
	return removed.flatMap(entry => {
		if (entry.collectionPath[0] !== path[0] || entry.collectionPath.length === 1) return [entry]
		const at = Number(entry.collectionPath[1])
		if (at === index) return []
		return [{ ...entry, collectionPath: [path[0] as string, at > index ? at - 1 : at, ...entry.collectionPath.slice(2)] }]
	})
}
export function moveCollectionItem<T>(items: T[], from: number, to: number): T[] {
	if (from < 0 || to < 0 || from >= items.length || to >= items.length) return items
	const next = [...items]
	const moved = next.splice(from, 1)
	next.splice(to, 0, ...moved)
	return next
}
export function moveCollectionIdentity(identities: ContentCollectionIdentity[], path: ContentFieldPath, from: number, to: number): ContentCollectionIdentity[] {
	const ids = collectionIds(identities, path)
	if (from < 0 || to < 0 || from >= ids.length || to >= ids.length) return identities
	const moved = setCollectionIds(identities, path, moveCollectionItem(ids, from, to))
	if (path.length !== 1) return moved
	const oldIndices = moveCollectionItem(ids.map((_, index) => index), from, to)
	return moved.map(entry => entry.collectionPath[0] === path[0] && entry.collectionPath.length > 1
		? { ...entry, collectionPath: [path[0] as string, oldIndices.indexOf(Number(entry.collectionPath[1])), ...entry.collectionPath.slice(2)] } : entry)
}
