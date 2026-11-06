import {
	contentTranslationFields,
	withContentTranslationIdentities,
	reconcileContentTranslation,
	type ContentTranslationField,
	type TranslationEdit,
	type ContentEntityType,
} from '@sinshin/shared'
import { useCallback, useEffect, useRef, useState } from 'react'
import { translateContentField, translatePreview } from '#/server/translation'

type FieldPath = (string | number)[]
const pathKey = (path: FieldPath) => JSON.stringify(path)

export interface ContentTranslationBinding {
	field: ContentTranslationField
	status: ContentTranslationField['status']
	busy: boolean
	failed: boolean
	register: (onChange: (value: string) => void) => void
	edit: (value: string, origin?: 'manual' | 'automatic') => void
	translate: () => Promise<string | undefined>
}

/** Only explicit Arabic edits produce save proof. Source changes discard pending suggestions. */
export function useContentTranslationDraft({
	entityType,
	entityId,
	initialRow,
	row,
}: {
	entityType: ContentEntityType
	entityId?: string | null
	initialRow?: Record<string, unknown> | null
	row: Record<string, unknown>
}) {
	const key = `${entityType}:${entityId ?? 'new'}`
	const edits = useRef(new Map<string, TranslationEdit>())
	const baseline = useRef<{
		key: string
		row: Record<string, unknown>
		fields: ContentTranslationField[]
		sourceRevision?: string
	} | null>(null)
	if (!baseline.current || baseline.current.key !== key) {
		edits.current.clear()
		const firstRow = structuredClone(initialRow ?? row)
		const firstFields = contentTranslationFields(entityType, firstRow)
		baseline.current = {
			key,
			row: {
				...firstRow,
				translationState: {
					version: 1,
					entityType,
					entityId: entityId ?? '',
					fields: firstFields,
				},
			},
			fields: firstFields,
			sourceRevision: typeof initialRow?.sourceRevision === 'string' ? initialRow.sourceRevision : undefined,
		}
	}
	const original = baseline.current.fields
	const working = useRef<{ key: string; fields: ContentTranslationField[] }>({
		key,
		fields: original,
	})
	if (working.current.key !== key) working.current = { key, fields: original }
	const identifiedRow = Array.isArray(row.translationIdentities)
		? withContentTranslationIdentities(entityType, row, row.translationIdentities) : row
	const identities = contentTranslationFields(entityType, {
		...identifiedRow,
		translationState: {
			...(typeof identifiedRow.translationState === 'object' && identifiedRow.translationState !== null ? identifiedRow.translationState : {}),
			version: 1,
			entityType,
			entityId: entityId ?? '',
			fields: working.current.fields,
		},
	})
	working.current.fields = identities
	const currentEdits =
		key === baseline.current.key
			? [...edits.current.values()].flatMap((edit) => {
					const current = identities.find(
						(field) =>
							field.fieldId === edit.fieldId &&
							field.sourceText === edit.sourceText,
					)
					return current ? [{ ...edit, fieldPath: [...current.fieldPath] }] : []
				})
			: []
	const newIdentities: TranslationEdit[] = identities
		.filter(
			(field) => !original.some((before) => before.fieldId === field.fieldId),
		)
		.filter(
			(field) => !currentEdits.some((edit) => edit.fieldId === field.fieldId),
		)
		.map((field) => ({
			fieldId: field.fieldId,
			fieldPath: [...field.fieldPath],
			sourceText: field.sourceText,
			value: '',
			revision: 0,
			origin: 'automatic',
		}))
	const reconciled = reconcileContentTranslation(
		entityType,
		entityId ?? '',
		baseline.current.row,
		identifiedRow,
		[...currentEdits, ...newIdentities],
	)
	const persistedFields = initialRow ? contentTranslationFields(entityType, initialRow) : []
	const fields = contentTranslationFields(entityType, reconciled)
		.filter(
			(field) =>
				!(
					entityType === 'article' &&
					row.blocks &&
					field.fieldId === 'content'
				),
		)
		.map((field) => {
			const saved = original.find(before => before.fieldId === field.fieldId)
			const persisted = persistedFields.find(current => current.fieldId === field.fieldId
				&& current.sourceText === field.sourceText && pathKey(current.fieldPath) === pathKey(field.fieldPath))
			// Refresh server statuses without replacing explicit drafts or rebinding their save proof.
			const observed = persisted && saved?.sourceText === field.sourceText && !edits.current.has(field.fieldId)
				? { ...field, value: persisted.value, origin: persisted.origin, status: persisted.status,
					staleValue: persisted.staleValue, staleSourceText: persisted.staleSourceText, error: persisted.error }
				: field
			return {
			...observed,
			revision:
				saved?.revision ?? 0,
			status:
				!entityId && observed.status === 'needs-retranslation' && !observed.staleValue
					? ('missing' as const)
					: observed.status,
			}
		})
	const versions = useRef(new Map<string, number>())
	const seenSource = useRef(new Map<string, string>())
	const updaters = useRef(new Map<string, (value: string) => void>())
	const pending = useRef(new Map<string, symbol>())
	const failed = useRef(new Set<string>())
	const mounted = useRef(true)
	const [, refresh] = useState(0)
	const latest = useRef({ key, fields })
	if (latest.current.key !== key) {
		edits.current.clear()
		versions.current.clear()
		seenSource.current.clear()
		updaters.current.clear()
		pending.current.clear()
		failed.current.clear()
	}
	for (const field of fields) {
		const before = seenSource.current.get(field.fieldId)
		if (before !== undefined && before !== field.sourceText) {
			versions.current.set(
				field.fieldId,
				(versions.current.get(field.fieldId) ?? 0) + 1,
			)
			edits.current.delete(field.fieldId)
			failed.current.delete(field.fieldId)
		}
		seenSource.current.set(field.fieldId, field.sourceText)
	}
	latest.current = { key, fields }
	useEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
			pending.current.clear()
		}
	}, [])
	const redraw = () => {
		if (mounted.current) refresh((value) => value + 1)
	}
	const statusOf = (field: ContentTranslationField) => {
		const edit = edits.current.get(field.fieldId)
		return edit?.sourceText === field.sourceText
			? edit.value.trim()
				? 'translated'
				: 'missing'
			: field.status
	}
	const edit = (
		field: ContentTranslationField,
		value: string,
		origin: 'manual' | 'automatic' = 'manual',
	) => {
		versions.current.set(
			field.fieldId,
			(versions.current.get(field.fieldId) ?? 0) + 1,
		)
		failed.current.delete(field.fieldId)
		edits.current.set(field.fieldId, {
			fieldId: field.fieldId,
			fieldPath: [...field.fieldPath],
			sourceText: field.sourceText,
			value,
			revision: field.revision,
			origin,
		})
		redraw()
	}
	const translate = async (field: ContentTranslationField) => {
		const currentField = latest.current.fields.find(
			(item) => item.fieldId === field.fieldId,
		)
		if (
			currentField?.sourceText !== field.sourceText ||
			pathKey(currentField.fieldPath) !== pathKey(field.fieldPath)
		)
			return
		if (
			!field.sourceText.trim() ||
			statusOf(field) === 'translated' ||
			pending.current.has(field.fieldId)
		)
			return
		const token = Symbol('content-field')
		const version = versions.current.get(field.fieldId)
		const sourceKey = latest.current.key
		pending.current.set(field.fieldId, token)
		failed.current.delete(field.fieldId)
		redraw()
		try {
			const stored = original.find((item) => item.fieldId === field.fieldId)
			let value: string | undefined
			if (
				entityId &&
				stored?.sourceText === field.sourceText &&
				pathKey(stored.fieldPath) === pathKey(field.fieldPath)
			) {
				const result = await translateContentField({
					entityType,
					entityId,
					fieldId: field.fieldId,
					fieldPath: [...field.fieldPath],
					sourceText: field.sourceText,
					revision: field.revision,
				})
				if (
					result.entityType !== entityType ||
					result.entityId !== entityId ||
					result.fieldId !== field.fieldId ||
					result.sourceText !== field.sourceText ||
					result.revision !== field.revision ||
					pathKey(result.fieldPath) !== pathKey(field.fieldPath)
				)
					return
				value = result.value
			} else {
				// New/unsaved drafts have no stored source to validate. Preview exactly one text, then bind save proof.
				value = (await translatePreview([field.sourceText]))[0]
			}
			const current = latest.current.fields.find(
				(item) => item.fieldId === field.fieldId,
			)
			if (
				!mounted.current ||
				latest.current.key !== sourceKey ||
				pending.current.get(field.fieldId) !== token ||
				versions.current.get(field.fieldId) !== version ||
				current?.sourceText !== field.sourceText ||
				pathKey(current.fieldPath) !== pathKey(field.fieldPath) ||
				statusOf(current) === 'translated'
			)
				return
			if (value && value.length > field.maxLength)
				throw new Error(
					'ترجمه بیش از طول مجاز این فیلد است؛ متن را بازبینی کنید',
				)
			return value?.trim()
		} catch (error) {
			const current = latest.current.fields.find(item => item.fieldId === field.fieldId)
			if (mounted.current && latest.current.key === sourceKey && versions.current.get(field.fieldId) === version
				&& current?.sourceText === field.sourceText && pathKey(current.fieldPath) === pathKey(field.fieldPath)) {
				failed.current.add(field.fieldId)
				redraw()
			}
			throw error
		} finally {
			if (pending.current.get(field.fieldId) === token) {
				pending.current.delete(field.fieldId)
				redraw()
			}
		}
	}
	const field = (path: FieldPath): ContentTranslationBinding | undefined => {
		const value = fields.find(
			(item) => pathKey(item.fieldPath) === pathKey(path),
		)
		if (!value) return undefined
		return {
			field: {
				...value,
				origin: edits.current.get(value.fieldId)?.origin ?? value.origin,
			},
			status: statusOf(value),
			busy: pending.current.has(value.fieldId),
			failed: failed.current.has(value.fieldId) || !!value.error && !edits.current.has(value.fieldId),
			register: (onChange) => {
				updaters.current.set(value.fieldId, onChange)
			},
			edit: (text, origin) => edit(value, text, origin),
			translate: () => translate(value),
		}
	}
	const translateEligible = async () => {
		for (const item of fields) {
			if (
				item.origin !== 'automatic' ||
				!['missing', 'needs-retranslation'].includes(statusOf(item)) ||
				!updaters.current.has(item.fieldId)
			)
				continue
			const value = await translate(item)
			if (!value) continue
			edit(item, value, 'automatic')
			updaters.current.get(item.fieldId)?.(value)
		}
	}
	const reset = useCallback(
		(nextInitialRow?: Record<string, unknown>) => {
			if (nextInitialRow) {
				const firstRow = structuredClone(nextInitialRow)
				const firstFields = contentTranslationFields(entityType, firstRow)
				baseline.current = {
					key,
					fields: firstFields,
					row: {
						...firstRow,
						translationState: {
							version: 1,
							entityType,
							entityId: entityId ?? '',
							fields: firstFields,
						},
					},
					sourceRevision: typeof nextInitialRow.sourceRevision === 'string' ? nextInitialRow.sourceRevision : undefined,
				}
			} else baseline.current = null
			working.current.key = ''
			edits.current.clear()
			failed.current.clear()
			pending.current.clear()
			seenSource.current.clear()
			versions.current.clear()
			if (mounted.current) refresh((value) => value + 1)
		},
		[entityType, entityId, key],
	)
	return {
		sourceRevision: baseline.current.sourceRevision,
		field,
		translateEligible,
		busy: pending.current.size > 0,
		eligibleCount: fields.filter(
			(item) =>
				item.origin === 'automatic' &&
				item.sourceText.trim() &&
				['missing', 'needs-retranslation'].includes(statusOf(item)),
		).length,
		getEdits: () => {
			const submitted = [...edits.current.values()].flatMap((item) => {
				const current = fields.find(
					(field) =>
						field.fieldId === item.fieldId &&
						field.sourceText === item.sourceText,
				)
				return current ? [{ ...item, fieldPath: [...current.fieldPath] }] : []
			})
			// New nested items carry their parent's draft identity through reorder.
			// Send only the source-bound parent hints needed by explicit item edits.
			const parentHints: TranslationEdit[] = []
			for (const item of submitted) {
				const collection = item.fieldPath[0]
				if (!['sections', 'processes'].includes(String(collection)) || item.fieldPath[2] !== 'items') continue
				const parent = fields.find(field => pathKey(field.fieldPath) === pathKey([collection as string, item.fieldPath[1] as number, 'title']))
				if (!parent || original.some(field => field.fieldId === parent.fieldId)
					|| submitted.some(edit => edit.fieldId === parent.fieldId) || parentHints.some(edit => edit.fieldId === parent.fieldId)) continue
				parentHints.push({ fieldId: parent.fieldId, fieldPath: [...parent.fieldPath], sourceText: parent.sourceText,
					value: '', revision: 0, origin: 'automatic' })
			}
			return [...parentHints, ...submitted]
		},
		reset,
	}
}
