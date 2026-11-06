import {
	articleBlockTextPathForIdentity,
	getArticleBlockItemId,
	createArticleBlockTranslationStatusReader,
	getArticleBlockTranslationStatus,
	getChangedArticleBlockTextFields,
	getArticleBlockTextFields,
	normalizeArticleBlocksTranslation,
	readArticleBlockText,
	reconcileArticleBlocksTranslation,
	setArticleBlockTexts,
	setArticleBlockTranslations,
	type ArticleBlocksDoc,
	type ArticleBlockTextPath,
	type ArticleBlockTextUpdate,
	type ArticleBlockType,
} from '@sinshin/shared'
import { useRef, useState } from 'react'
import {
	translateArticleBlockField,
	translateArticleBlocksPreview,
} from '#/server/translation'

/** Keep source revisions and manual edits local; suggestions require explicit actions. */
export function useArabicBlockTranslations({
	doc,
	docAr,
	onChange,
	mounted,
	showToast,
	translationEntityType,
	translationEntityId,
	initialDoc,
	initialDocAr,
}: {
	doc: { current: ArticleBlocksDoc }
	docAr?: ArticleBlocksDoc | null
	onChange?: (doc: ArticleBlocksDoc) => void
	mounted: { current: boolean }
	showToast: (message: string, type?: 'error' | 'success') => void
	translationEntityType?: 'article' | 'about'
	translationEntityId?: string
	initialDoc?: ArticleBlocksDoc | null
	initialDocAr?: ArticleBlocksDoc | null
}) {
	const seenSource = useRef(doc.current)
	const initialSource = useRef(initialDoc ?? doc.current)
	const initialArabic = useRef(initialDocAr ?? docAr)
	const manuallyCleared = useRef(false)
	const draftRef = useRef(docAr)
	const seenArabic = useRef(docAr)
	const onChangeRef = useRef(onChange)
	onChangeRef.current = onChange
	const revisions = useRef(new Map<string, number>())
	const activeFields = useRef(new Set<string>())
	const failures = useRef(new Map<string, string>())
	const [, refreshFields] = useState(0)
	const draftForReconciliation = (draft: ArticleBlocksDoc | null | undefined) => draft?.translation ? {
		...draft, translation: { ...draft.translation,
			// Undo restores an unsaved logical item. Only persisted tombstones prohibit ID reuse.
			retiredItemIds: initialDocAr?.translation?.retiredItemIds ?? initialArabic.current?.translation?.retiredItemIds ?? [],
		},
	} : draft
	const keyFor = (
		id: string,
		type: ArticleBlockType,
		path: ArticleBlockTextPath,
		itemId?: string,
		identitySource: ArticleBlocksDoc = doc.current,
	) => {
		const block = identitySource.blocks.find(block => block.id === id && block.type === type)
		return JSON.stringify([id, type, itemId ?? (block && getArticleBlockItemId(block, path)) ?? path])
	}
	const readMatching = (block: ArticleBlocksDoc['blocks'][number] | undefined, path: ArticleBlockTextPath, itemId?: string) => {
		const matched = articleBlockTextPathForIdentity(block, path, itemId)
		return matched ? readArticleBlockText(block, matched) : ''
	}
	const refresh = () => { if (mounted.current) refreshFields(value => value + 1) }
	const protectedFields = (translation: ArticleBlocksDoc | null | undefined) => new Set(
		(translation?.translation?.fields ?? []).filter(field => field.origin === 'manual' || field.origin === 'legacy')
			.map(field => keyFor(field.blockId, field.blockType, field.fieldPath, field.itemId, translation ?? doc.current)),
	)
	const countSourceChanges = (
		before: ArticleBlocksDoc,
		after: ArticleBlocksDoc,
	) => {
		for (const change of getChangedArticleBlockTextFields(before, after)) {
			const key = keyFor(change.blockId, change.blockType, change.fieldPath, change.itemId, after)
			revisions.current.set(key, (revisions.current.get(key) ?? 0) + 1)
			failures.current.delete(key)
		}
	}
	countSourceChanges(seenSource.current, doc.current)
	draftRef.current = reconcileArticleBlocksTranslation(
		seenSource.current,
		doc.current,
		draftForReconciliation(docAr === seenArabic.current ? draftRef.current : docAr),
	)
	if (docAr === null && seenArabic.current) {
		manuallyCleared.current = true
		draftRef.current = setArticleBlockTranslations(doc.current, null, doc.current.blocks.flatMap(block =>
			getArticleBlockTextFields(block).map(field => ({ blockId: block.id, path: field.path, text: '' }))), 'manual')
		for (const proof of draftRef.current?.translation?.fields ?? []) {
			const saved = (initialDocAr ?? initialArabic.current)?.translation?.fields.find(field => keyFor(field.blockId, field.blockType, field.fieldPath, field.itemId, initialDoc ?? initialSource.current) === keyFor(proof.blockId, proof.blockType, proof.fieldPath, proof.itemId))
			const before = (initialDoc ?? initialSource.current).blocks.find(block => block.id === proof.blockId && block.type === proof.blockType)
			proof.revision = (saved?.revision ?? 0) + 1 + (before && readMatching(before, proof.fieldPath, proof.itemId) !== proof.sourceText ? 1 : 0)
		}
	}
	if (!manuallyCleared.current && initialDocAr !== initialArabic.current && initialDocAr) {
		const latest = normalizeArticleBlocksTranslation(doc.current, initialDocAr)
		const baseline = normalizeArticleBlocksTranslation(initialSource.current, initialArabic.current)
		const current = normalizeArticleBlocksTranslation(doc.current, draftRef.current)
		if (latest && baseline && current) {
			const states = new Map((current.translation?.fields ?? []).map(field => [keyFor(field.blockId, field.blockType, field.fieldPath), field]))
			for (const block of doc.current.blocks) {
				const before = initialSource.current.blocks.find(item => item.id === block.id && item.type === block.type)
				const oldArabic = baseline.blocks.find(item => item.id === block.id && item.type === block.type)
				const target = current.blocks.find(item => item.id === block.id && item.type === block.type)
				const incoming = latest.blocks.find(item => item.id === block.id && item.type === block.type)
				if (!before || !target || !incoming) continue
				for (const field of getArticleBlockTextFields(block)) {
					const key = keyFor(block.id, block.type, field.path)
					const proof = latest.translation?.fields.find(state => keyFor(state.blockId, state.blockType, state.fieldPath) === key)
					if (revisions.current.has(key) || readMatching(before, field.path, field.itemId) !== field.text
						|| readArticleBlockText(target, field.path) !== readMatching(oldArabic, field.path, field.itemId)
						|| !proof || proof.sourceText !== field.text) continue
					const updated = setArticleBlockTexts({ version: 1, blocks: [target] }, [{ blockId: block.id, path: field.path, text: readArticleBlockText(incoming, field.path) }])
					Object.assign(target, updated.blocks[0])
					states.set(key, proof)
				}
			}
			current.translation = { ...current.translation, fields: [...states.values()] }
			draftRef.current = current
		}
	}
	seenArabic.current = docAr
	seenSource.current = doc.current
	const busyRef = useRef(false)
	const [busy, setBusy] = useState(false)
	const publish = (next: ArticleBlocksDoc | null, source = doc.current) => {
		if (!mounted.current || !next) return
		// Keystrokes have separate local race counters. A save proof represents one
		// review against the saved source, regardless of how many draft edits occurred.
		const savedSource = initialDoc ?? initialSource.current
		const savedArabic = initialDocAr ?? initialArabic.current
		for (const proof of next.translation?.fields ?? []) {
			const block = source.blocks.find(item => item.id === proof.blockId && item.type === proof.blockType)
			if (!block) continue
			const before = savedSource.blocks.find(item => item.id === block.id && item.type === block.type)
			const saved = savedArabic?.translation?.fields.find(field => keyFor(field.blockId, field.blockType, field.fieldPath, field.itemId, savedSource) === keyFor(proof.blockId, proof.blockType, proof.fieldPath, proof.itemId, source))
			const sourceText = readArticleBlockText(block, proof.fieldPath)
			const invalidatedRevision = (saved?.revision ?? 0) + (before && readMatching(before, proof.fieldPath, proof.itemId) !== sourceText ? 1 : 0)
			const reviewed = proof.sourceText === sourceText && (proof.revision ?? 0) > invalidatedRevision
			proof.revision = invalidatedRevision + (reviewed ? 1 : 0)
			if (reviewed && proof.origin === 'manual') proof.status = readArticleBlockText(next.blocks.find(item => item.id === block.id && item.type === block.type), proof.fieldPath).trim() ? 'translated' : 'missing'
		}
		draftRef.current = next
		onChangeRef.current?.(next)
	}
	// Commit-time tracking also catches A -> B -> A before the next render.
	const sourceChanged = (next: ArticleBlocksDoc) => {
		countSourceChanges(seenSource.current, next)
		const previous = seenSource.current
		seenSource.current = next
		publish(reconcileArticleBlocksTranslation(previous, next, draftForReconciliation(draftRef.current)), next)
	}
	const edit = (blockId: string, path: ArticleBlockTextPath, text: string, itemId?: string) => {
		const block = doc.current.blocks.find((item) => item.id === blockId)
		const currentPath = articleBlockTextPathForIdentity(block, path, itemId)
		if (!block || !currentPath) return
		const key = keyFor(block.id, block.type, currentPath, itemId)
		revisions.current.set(key, (revisions.current.get(key) ?? 0) + 1)
		failures.current.delete(key)
		publish(
			setArticleBlockTranslations(doc.current, draftRef.current, [
				{ blockId, path: currentPath, text },
			]),
		)
	}
	const ready = () =>
		showToast('ترجمه عربی آماده بازبینی است؛ پس از ویرایش مقاله را ذخیره کنید')
	const run = async (action: () => Promise<void>) => {
		if (busyRef.current || !onChangeRef.current) return
		busyRef.current = true
		setBusy(true)
		try {
			await action()
			if (mounted.current) ready()
		} catch (error) {
			if (mounted.current)
				showToast(
					error instanceof Error ? error.message : 'ترجمه عربی ناموفق بود',
					'error',
				)
		} finally {
			busyRef.current = false
			if (mounted.current) setBusy(false)
		}
	}
	const translateField = async (
		source: ArticleBlocksDoc,
		blockId: string,
		path: ArticleBlockTextPath,
		before: Map<string, number>,
		allowManual = true,
	) => {
		const block = source.blocks.find((item) => item.id === blockId)
		const field =
			block &&
			getArticleBlockTextFields(block).find(
				(item) => JSON.stringify(item.path) === JSON.stringify(path),
			)
		if (!block || !field?.text.trim()) return
		const key = keyFor(block.id, block.type, path, field.itemId, source)
		const currentBlock = doc.current.blocks.find(
			(item) => item.id === block.id && item.type === block.type,
		)
		const currentPath = articleBlockTextPathForIdentity(currentBlock, path, field.itemId)
		if (
			!currentBlock ||
			!currentPath ||
			readMatching(currentBlock, path, field.itemId) !== field.text ||
			revisions.current.get(key) !== before.get(key) ||
			!allowManual && protectedFields(draftRef.current).has(key) ||
			getArticleBlockTranslationStatus(
				doc.current,
				draftRef.current,
				block.id,
				currentPath,
			) === 'translated'
		)
			return
		const storedBlock = initialDoc?.blocks.find(item => item.id === blockId && item.type === block.type)
		const storedState = initialDocAr?.translation?.fields.find(item => item.blockId === blockId && item.blockType === block.type
			&& JSON.stringify(item.fieldPath) === JSON.stringify(path))
		const storedContext = translationEntityType && translationEntityId && storedBlock && readArticleBlockText(storedBlock, path) === field.text
			&& getArticleBlockItemId(storedBlock, path) === field.itemId
			? { entityType: translationEntityType, entityId: translationEntityId, revision: storedState?.revision ?? 0 } : undefined
		activeFields.current.add(key)
		failures.current.delete(key)
		refresh()
		let result: Awaited<ReturnType<typeof translateArticleBlockField>>
		try {
			result = await translateArticleBlockField({
			...storedContext,
			blockId,
			blockType: block.type,
			fieldPath: [...path],
			text: field.text,
			})
		} catch (error) {
			if (revisions.current.get(key) === before.get(key)) failures.current.set(key, error instanceof Error ? error.message : 'ترجمه ناموفق بود')
			throw error
		} finally {
			activeFields.current.delete(key)
			refresh()
		}
		const latest = doc.current.blocks.find(
			(item) => item.id === block.id && item.type === block.type,
		)
		const latestPath = articleBlockTextPathForIdentity(latest, path, field.itemId)
		if (
			!mounted.current ||
			!latest ||
			!latestPath || readArticleBlockText(latest, latestPath) !== field.text ||
			revisions.current.get(key) !== before.get(key) ||
			result.blockId !== block.id ||
			result.blockType !== block.type ||
			JSON.stringify(result.fieldPath) !== JSON.stringify(path) ||
			result.sourceText !== field.text ||
			storedContext && (result.entityType !== storedContext.entityType || result.entityId !== storedContext.entityId || result.revision !== storedContext.revision) ||
			getArticleBlockTranslationStatus(
				doc.current,
				draftRef.current,
				block.id,
				latestPath,
			) === 'translated'
		)
			return
		if (result.translation.trim())
			publish(
				setArticleBlockTranslations(doc.current, draftRef.current, [
					{ blockId, path: latestPath, text: result.translation },
				]),
			)
	}
	const translate = (blockId?: string, fieldPath?: ArticleBlockTextPath, itemId?: string) =>
		run(async () => {
			const source = doc.current
			const previous = draftRef.current
			const before = new Map(revisions.current)
			const previousStatus = createArticleBlockTranslationStatusReader(
				source,
				previous,
			)
			if (blockId !== undefined && fieldPath !== undefined) {
				const path = articleBlockTextPathForIdentity(source.blocks.find(block => block.id === blockId), fieldPath, itemId)
				if (path) await translateField(source, blockId, path, before)
				return
			}
			// Initial block/all previews omit completed source fields and Arabic values.
			const scoped =
				blockId === undefined
					? source
					: {
							version: source.version,
							blocks: source.blocks.filter((block) => block.id === blockId),
						}
			const omitted: ArticleBlockTextUpdate[] = []
			const protectedBefore = protectedFields(previous)
			const requestedKeys = new Set<string>()
			for (const block of scoped.blocks)
				for (const field of getArticleBlockTextFields(block)) {
					const key = keyFor(block.id, block.type, field.path)
					if (previousStatus(block.id, field.path) === 'translated' || protectedBefore.has(key))
						omitted.push({ blockId: block.id, path: field.path, text: '' })
					else if (field.text.trim()) requestedKeys.add(key)
				}
			if (!requestedKeys.size) return
			const request = omitted.length
				? setArticleBlockTexts(scoped, omitted)
				: scoped
			for (const key of requestedKeys) { activeFields.current.add(key); failures.current.delete(key) }
			refresh()
			let result: ArticleBlocksDoc
			try {
				result = await translateArticleBlocksPreview({
				blocks: request,
				...(blockId !== undefined ? { blockId } : {}),
				})
			} catch (error) {
				for (const key of requestedKeys) if (revisions.current.get(key) === before.get(key)) failures.current.set(key, error instanceof Error ? error.message : 'ترجمه ناموفق بود')
				throw error
			} finally {
				for (const key of requestedKeys) activeFields.current.delete(key)
				refresh()
			}
			if (!mounted.current) return
			const accepted: ArticleBlockTextUpdate[] = []
			const currentStatus = createArticleBlockTranslationStatusReader(
				doc.current,
				draftRef.current,
			)
			const protectedCurrent = protectedFields(draftRef.current)
			for (const block of doc.current.blocks) {
				const original = source.blocks.find(
					(item) => item.id === block.id && item.type === block.type,
				)
				const suggestion = result.blocks.find(
					(item) => item.id === block.id && item.type === block.type,
				)
				if (
					!original ||
					!suggestion ||
					(blockId !== undefined && block.id !== blockId)
				)
					continue
				for (const field of getArticleBlockTextFields(block)) {
					const key = keyFor(block.id, block.type, field.path)
					const originalPath = articleBlockTextPathForIdentity(original, field.path, field.itemId)
					if (
						!requestedKeys.has(key) || protectedCurrent.has(key) ||
						readMatching(original, field.path, field.itemId) !== field.text ||
						revisions.current.get(key) !== before.get(key) ||
						!originalPath || previousStatus(block.id, originalPath) === 'translated' ||
						currentStatus(block.id, field.path) === 'translated'
					)
						continue
					const value = readMatching(suggestion, field.path, field.itemId)
					if (value.trim())
						accepted.push({ blockId: block.id, path: field.path, text: value })
				}
			}
			publish(
				setArticleBlockTranslations(doc.current, draftRef.current, accepted),
			)
		})
	const translateChanged = () =>
		run(async () => {
			const source = doc.current
			const before = new Map(revisions.current)
			const sourceStatus = createArticleBlockTranslationStatusReader(
				source,
				draftRef.current,
			)
			const protectedBefore = protectedFields(draftRef.current)
			for (const block of source.blocks)
				for (const field of getArticleBlockTextFields(block)) {
					if (sourceStatus(block.id, field.path) === 'needs-retranslation' && !protectedBefore.has(keyFor(block.id, block.type, field.path, field.itemId, source))) {
						await translateField(source, block.id, field.path, before, false)
					}
				}
		})
	const draft = normalizeArticleBlocksTranslation(doc.current, draftRef.current)
	const status = createArticleBlockTranslationStatusReader(doc.current, draft)
	const protectedCurrent = protectedFields(draft)
	const fieldState = (blockId: string, path: ArticleBlockTextPath) => {
		const block = doc.current.blocks.find(item => item.id === blockId)
		const key = block && keyFor(block.id, block.type, path)
		return { busy: !!key && activeFields.current.has(key), error: key ? failures.current.get(key) : undefined }
	}
	const changedCount = doc.current.blocks.reduce(
		(total, block) =>
			total +
			getArticleBlockTextFields(block).filter(
				(field) =>
					!protectedCurrent.has(keyFor(block.id, block.type, field.path)) &&
					status(block.id, field.path) === 'needs-retranslation' &&
					field.text.trim(),
			).length,
		0,
	)
	return {
		draft,
		edit,
		translate,
		translateChanged,
		sourceChanged,
		status,
		changedCount,
		busy,
		fieldState,
	}
}
