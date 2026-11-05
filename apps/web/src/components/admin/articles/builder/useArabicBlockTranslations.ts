import {
	fillMissingArticleBlocksTranslation,
	getArticleBlockTextFields,
	normalizeArticleBlocksTranslation,
	readArticleBlockText,
	setArticleBlockText,
	setArticleBlockTexts,
	type ArticleBlocksDoc,
	type ArticleBlockTextPath,
	type ArticleBlockTextUpdate,
} from '@sinshin/shared'
import { useRef, useState } from 'react'
import { translateArticleBlocksPreview } from '#/server/translation'

/** Keep suggestions separate from source edits, and discard stale async results. */
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
	const draftRef = useRef(docAr)
	draftRef.current = docAr
	const onChangeRef = useRef(onChange)
	onChangeRef.current = onChange
	const revisions = useRef(new Map<string, number>())
	const busyRef = useRef(false)
	const [busy, setBusy] = useState(false)
	const publish = (next: ArticleBlocksDoc) => {
		if (!mounted.current) return
		draftRef.current = next
		onChangeRef.current?.(next)
	}
	const edit = (blockId: string, path: ArticleBlockTextPath, text: string) => {
		const key = JSON.stringify([blockId, path])
		revisions.current.set(key, (revisions.current.get(key) ?? 0) + 1)
		const draft = normalizeArticleBlocksTranslation(
			doc.current,
			draftRef.current,
		)
		if (draft) publish(setArticleBlockText(draft, blockId, path, text))
	}
	const translate = async (blockId?: string) => {
		if (busyRef.current || !onChangeRef.current) return
		busyRef.current = true
		setBusy(true)
		const source = doc.current
		const previous = draftRef.current
		const before = new Map(revisions.current)
		try {
			const result = await translateArticleBlocksPreview({
				blocks: source,
				blocksAr: previous,
				blockId,
			})
			if (!mounted.current) return
			const current = doc.current
			let suggestions = normalizeArticleBlocksTranslation(current, result)
			if (!suggestions) return
			const discarded: ArticleBlockTextUpdate[] = []
			for (const block of current.blocks) {
				const original = source.blocks.find(
					(b) => b.id === block.id && b.type === block.type,
				)
				const originalAr = previous?.blocks.find(
					(b) => b.id === block.id && b.type === block.type,
				)
				for (const field of getArticleBlockTextFields(block)) {
					const key = JSON.stringify([block.id, field.path])
					if (
						!original ||
						readArticleBlockText(original, field.path) !== field.text ||
						readArticleBlockText(originalAr, field.path).trim() ||
						revisions.current.get(key) !== before.get(key) ||
						(blockId !== undefined && block.id !== blockId)
					) {
						discarded.push({ blockId: block.id, path: field.path, text: '' })
					}
				}
			}
			suggestions = setArticleBlockTexts(suggestions, discarded)
			const filled = fillMissingArticleBlocksTranslation(
				current,
				draftRef.current,
				suggestions,
			)
			if (filled) publish(filled)
			showToast(
				'ترجمه عربی آماده بازبینی است؛ پس از ویرایش مقاله را ذخیره کنید',
			)
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
	return {
		draft: normalizeArticleBlocksTranslation(doc.current, docAr),
		edit,
		translate,
		busy,
	}
}
