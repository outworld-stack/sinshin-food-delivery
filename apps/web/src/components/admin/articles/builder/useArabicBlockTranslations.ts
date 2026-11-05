import {
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
}: {
	doc: { current: ArticleBlocksDoc }
	docAr?: ArticleBlocksDoc | null
	onChange?: (doc: ArticleBlocksDoc) => void
	mounted: { current: boolean }
	showToast: (message: string, type?: 'error' | 'success') => void
}) {
	const seenSource = useRef(doc.current)
	const draftRef = useRef(docAr)
	const seenArabic = useRef(docAr)
	const onChangeRef = useRef(onChange)
	onChangeRef.current = onChange
	const revisions = useRef(new Map<string, number>())
	const keyFor = (
		id: string,
		type: ArticleBlockType,
		path: ArticleBlockTextPath,
	) => JSON.stringify([id, type, path])
	const countSourceChanges = (
		before: ArticleBlocksDoc,
		after: ArticleBlocksDoc,
	) => {
		for (const change of getChangedArticleBlockTextFields(before, after)) {
			const key = keyFor(change.blockId, change.blockType, change.fieldPath)
			revisions.current.set(key, (revisions.current.get(key) ?? 0) + 1)
		}
	}
	countSourceChanges(seenSource.current, doc.current)
	draftRef.current = reconcileArticleBlocksTranslation(
		seenSource.current,
		doc.current,
		docAr === seenArabic.current ? draftRef.current : docAr,
	)
	seenArabic.current = docAr
	seenSource.current = doc.current
	const busyRef = useRef(false)
	const [busy, setBusy] = useState(false)
	const publish = (next: ArticleBlocksDoc | null) => {
		if (!mounted.current || !next) return
		draftRef.current = next
		onChangeRef.current?.(next)
	}
	// Commit-time tracking also catches A -> B -> A before the next render.
	const sourceChanged = (next: ArticleBlocksDoc) => {
		countSourceChanges(seenSource.current, next)
		const previous = seenSource.current
		seenSource.current = next
		publish(reconcileArticleBlocksTranslation(previous, next, draftRef.current))
	}
	const edit = (blockId: string, path: ArticleBlockTextPath, text: string) => {
		const block = doc.current.blocks.find((item) => item.id === blockId)
		if (!block) return
		const key = keyFor(block.id, block.type, path)
		revisions.current.set(key, (revisions.current.get(key) ?? 0) + 1)
		publish(
			setArticleBlockTranslations(doc.current, draftRef.current, [
				{ blockId, path, text },
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
	) => {
		const block = source.blocks.find((item) => item.id === blockId)
		const field =
			block &&
			getArticleBlockTextFields(block).find(
				(item) => JSON.stringify(item.path) === JSON.stringify(path),
			)
		if (!block || !field?.text.trim()) return
		const key = keyFor(block.id, block.type, path)
		const currentBlock = doc.current.blocks.find(
			(item) => item.id === block.id && item.type === block.type,
		)
		if (
			!currentBlock ||
			readArticleBlockText(currentBlock, path) !== field.text ||
			revisions.current.get(key) !== before.get(key) ||
			getArticleBlockTranslationStatus(
				doc.current,
				draftRef.current,
				block.id,
				path,
			) === 'translated'
		)
			return
		const result = await translateArticleBlockField({
			blockId,
			blockType: block.type,
			fieldPath: [...path],
			text: field.text,
		})
		const latest = doc.current.blocks.find(
			(item) => item.id === block.id && item.type === block.type,
		)
		if (
			!mounted.current ||
			!latest ||
			readArticleBlockText(latest, path) !== field.text ||
			revisions.current.get(key) !== before.get(key) ||
			result.blockId !== block.id ||
			result.blockType !== block.type ||
			JSON.stringify(result.fieldPath) !== JSON.stringify(path) ||
			result.sourceText !== field.text ||
			getArticleBlockTranslationStatus(
				doc.current,
				draftRef.current,
				block.id,
				path,
			) === 'translated'
		)
			return
		if (result.translation.trim())
			publish(
				setArticleBlockTranslations(doc.current, draftRef.current, [
					{ blockId, path, text: result.translation },
				]),
			)
	}
	const translate = (blockId?: string, fieldPath?: ArticleBlockTextPath) =>
		run(async () => {
			const source = doc.current
			const previous = draftRef.current
			const before = new Map(revisions.current)
			const previousStatus = createArticleBlockTranslationStatusReader(
				source,
				previous,
			)
			if (blockId !== undefined && fieldPath !== undefined) {
				await translateField(source, blockId, fieldPath, before)
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
			for (const block of scoped.blocks)
				for (const field of getArticleBlockTextFields(block)) {
					if (previousStatus(block.id, field.path) === 'translated')
						omitted.push({ blockId: block.id, path: field.path, text: '' })
				}
			const request = omitted.length
				? setArticleBlockTexts(scoped, omitted)
				: scoped
			const result = await translateArticleBlocksPreview({
				blocks: request,
				...(blockId !== undefined ? { blockId } : {}),
			})
			if (!mounted.current) return
			const accepted: ArticleBlockTextUpdate[] = []
			const currentStatus = createArticleBlockTranslationStatusReader(
				doc.current,
				draftRef.current,
			)
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
					if (
						readArticleBlockText(original, field.path) !== field.text ||
						revisions.current.get(key) !== before.get(key) ||
						previousStatus(block.id, field.path) === 'translated' ||
						currentStatus(block.id, field.path) === 'translated'
					)
						continue
					const value = readArticleBlockText(suggestion, field.path)
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
			for (const block of source.blocks)
				for (const field of getArticleBlockTextFields(block)) {
					if (sourceStatus(block.id, field.path) === 'needs-retranslation') {
						await translateField(source, block.id, field.path, before)
					}
				}
		})
	const draft = normalizeArticleBlocksTranslation(doc.current, draftRef.current)
	const status = createArticleBlockTranslationStatusReader(doc.current, draft)
	const changedCount = doc.current.blocks.reduce(
		(total, block) =>
			total +
			getArticleBlockTextFields(block).filter(
				(field) =>
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
	}
}
