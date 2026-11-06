import {
  blocksToPlainText, contentTranslationFields, eligibleContentTranslationFields,
  getArticleBlockTextFields, mergeArticleBlocksTranslation, normalizeArticleBlocksTranslation,
  readArticleBlockText, reconcileContentTranslation, setArticleBlockTranslations,
  type ArticleBlocksDoc, type ArticleBlockTextPath, type ArticleBlockType,
  type ContentEntityType, type ContentFieldPath, type ContentTranslationField,
} from '@sinshin/shared'
import type { Db, DbOrTx } from '#/infra/db/client'
import { AppError, Err } from '#/domain/shared/errors'
import { readContentRow, writeContentRow, type ContentRow } from './content-translation.store'

type FieldRequest = { entityType: ContentEntityType; entityId: string; fieldId: string; fieldPath: ContentFieldPath; sourceText: string; revision: number }
type BlockField = { blockId: string; blockType: ArticleBlockType; path: ArticleBlockTextPath; itemId?: string; text: string; revision: number; maxLength: number }
const sameBlockField = (candidate: BlockField, selected: BlockField) => candidate.blockId === selected.blockId && candidate.blockType === selected.blockType
  && (selected.itemId ? candidate.itemId === selected.itemId : JSON.stringify(candidate.path) === JSON.stringify(selected.path))

/** Uses the existing text planner and block primitives, with one guarded write per field. */
export class ContentTranslationWorker {
  private readonly inFlight = new Map<string, Promise<string>>()
  constructor(private readonly deps: { db: Db; translate: (texts: string[]) => Promise<string[]>; invalidate: (type: ContentEntityType) => Promise<void> }) {}

  private async translate(type: ContentEntityType, id: string, field: ContentTranslationField): Promise<string> {
    if (field.sourceText.length > 1_000_000) throw Err.validation('The source exceeds the translation request limit.')
    const key = JSON.stringify([type, id.toLowerCase(), field.fieldId, field.sourceText, field.revision])
    const existing = this.inFlight.get(key)
    if (existing) return existing
    const request = (async () => {
      const [value] = await this.deps.translate([field.sourceText])
      if (!value?.trim()) throw Err.validation('The translator returned an empty value.')
      if (value.trim().length > field.maxLength) throw Err.validation('The translation exceeds this field’s limit. Review a shorter Arabic version.')
      return value.trim()
    })()
    this.inFlight.set(key, request)
    try { return await request } finally { if (this.inFlight.get(key) === request) this.inFlight.delete(key) }
  }

  async previewField(input: FieldRequest): Promise<FieldRequest & { value: string }> {
    const row = await readContentRow(this.deps.db, input.entityType, input.entityId)
    if (!row) throw Err.notFound('Content not found.')
    const field = contentTranslationFields(input.entityType, row).find(candidate => candidate.fieldId === input.fieldId
      && JSON.stringify(candidate.fieldPath) === JSON.stringify(input.fieldPath))
    if (!field || field.sourceText !== input.sourceText || field.revision !== input.revision
      || !field.sourceText.trim() || field.sourceText.length > 1_000_000) throw Err.validation('Invalid field or stale source revision. Reload the content.')
    if (field.value !== null && field.status === 'translated') return { ...input, value: field.value }
    const value = await this.translate(input.entityType, input.entityId, field)
    const current = await readContentRow(this.deps.db, input.entityType, input.entityId)
    const latest = contentTranslationFields(input.entityType, current).find(candidate => candidate.fieldId === field.fieldId)
    if (!latest || latest.sourceText !== field.sourceText || latest.revision !== field.revision
      || JSON.stringify(latest.fieldPath) !== JSON.stringify(field.fieldPath)) throw Err.validation('The field changed while translation was running.')
    return { ...input, value }
  }

  async previewStoredBlockField(input: { entityType: 'article' | 'about'; entityId: string; blockId: string; blockType: ArticleBlockType; fieldPath: ArticleBlockTextPath; text: string; revision: number }): Promise<string> {
    const find = (row: ContentRow | null) => {
      const source = row?.blocks as ArticleBlocksDoc | null
      const block = source?.blocks.find(candidate => candidate.id === input.blockId && candidate.type === input.blockType)
      const field = block && getArticleBlockTextFields(block).find(candidate => JSON.stringify(candidate.path) === JSON.stringify(input.fieldPath))
      const translated = normalizeArticleBlocksTranslation(source, row?.blocksAr)
      const proof = translated?.translation?.fields.find(candidate => candidate.blockId === input.blockId && candidate.blockType === input.blockType
        && JSON.stringify(candidate.fieldPath) === JSON.stringify(input.fieldPath))
      const arabic = translated?.blocks.find(candidate => candidate.id === input.blockId && candidate.type === input.blockType)
      return field ? { ...field, revision: proof?.revision ?? 0, value: readArticleBlockText(arabic, input.fieldPath) } : null
    }
    const field = find(await readContentRow(this.deps.db, input.entityType, input.entityId))
    if (!field || field.text !== input.text || field.revision !== input.revision) throw Err.validation('The saved block source or revision changed. Reload the content.')
    if (field.value.trim()) return field.value
    const value = await this.translate(input.entityType, input.entityId, { fieldId: JSON.stringify([input.blockId, input.blockType, input.fieldPath]),
      fieldPath: field.path, sourceText: field.text, revision: field.revision, maxLength: field.maxLength,
      value: null, origin: 'automatic', status: 'missing' })
    const latest = find(await readContentRow(this.deps.db, input.entityType, input.entityId))
    if (!latest || latest.itemId !== field.itemId || latest.text !== field.text || latest.revision !== field.revision) throw Err.validation('The block field changed while translation was running.')
    return value
  }

  blockFields(row: ContentRow): BlockField[] {
    const source = row.blocks as ArticleBlocksDoc | null
    const translated = normalizeArticleBlocksTranslation(source, row.blocksAr)
    if (!source || !translated) return []
    return source.blocks.flatMap(block => {
      const current = translated.blocks.find(candidate => candidate.id === block.id && candidate.type === block.type)
      return getArticleBlockTextFields(block).flatMap(field => {
        const proof = translated.translation?.fields.find(state => state.blockId === block.id && state.blockType === block.type
          && JSON.stringify(state.fieldPath) === JSON.stringify(field.path))
        return field.text.trim() && !readArticleBlockText(current, field.path).trim() && proof?.origin !== 'manual' && proof?.origin !== 'legacy'
          ? [{ blockId: block.id, blockType: block.type, path: field.path, itemId: field.itemId, text: field.text, revision: proof?.revision ?? 0, maxLength: field.maxLength }] : []
      })
    })
  }

  hasEligibleFields(type: ContentEntityType, row: ContentRow): boolean {
    return eligibleContentTranslationFields(type, row).length > 0 || ((type === 'article' || type === 'about') && this.blockFields(row).length > 0)
  }

  async run(type: ContentEntityType, id: string, isActive: (tx?: DbOrTx) => Promise<boolean> = async () => true): Promise<void> {
    const row = await readContentRow(this.deps.db, type, id)
    if (!row) return
    id = String(row.id)
    let failure: unknown
    for (const field of eligibleContentTranslationFields(type, row)) {
      try {
        if (!await isActive()) return
        const beforeRequest = await readContentRow(this.deps.db, type, id)
        const selected = eligibleContentTranslationFields(type, beforeRequest).find(candidate => candidate.fieldId === field.fieldId)
        if (!selected || selected.sourceText !== field.sourceText || selected.revision !== field.revision) continue
        const value = await this.translate(type, id, field)
        const wrote = await this.deps.db.transaction(async tx => {
          const current = await readContentRow(tx, type, id, true)
          if (!current) return false
          if (!await isActive(tx)) return false
          const latest = eligibleContentTranslationFields(type, current).find(candidate => candidate.fieldId === field.fieldId)
          if (!latest || latest.sourceText !== field.sourceText || latest.revision !== field.revision) return false
          const updated = reconcileContentTranslation(type, id, current, current, [{ fieldId: field.fieldId, fieldPath: latest.fieldPath,
            sourceText: field.sourceText, revision: field.revision, value, origin: 'automatic' }])
          await writeContentRow(tx, type, id, updated)
          return true
        })
        if (wrote) await this.deps.invalidate(type)
      } catch (error) {
        failure ??= error
        const wrote = await this.deps.db.transaction(async tx => {
          const current = await readContentRow(tx, type, id, true)
          if (!current) return
          if (!await isActive(tx)) return
          const latest = eligibleContentTranslationFields(type, current).find(candidate => candidate.fieldId === field.fieldId
            && candidate.sourceText === field.sourceText && candidate.revision === field.revision)
          if (!latest) return
          const updated = reconcileContentTranslation(type, id, current, current)
          const state = updated.translationState.fields.find(candidate => candidate.fieldId === field.fieldId)
          if (state) state.error = (error instanceof Error ? error.message : String(error)).slice(0, 500)
          await writeContentRow(tx, type, id, updated)
          return true
        })
        if (wrote) await this.deps.invalidate(type)
        if (error instanceof AppError && error.code === 'SERVICE_UNAVAILABLE') throw error
      }
    }
    if (type === 'article' || type === 'about') {
      for (const field of this.blockFields(row)) {
        try {
          if (!await isActive()) return
          const beforeRequest = await readContentRow(this.deps.db, type, id)
          const selected = beforeRequest && this.blockFields(beforeRequest).find(candidate => sameBlockField(candidate, field))
          if (!selected || selected.text !== field.text || selected.revision !== field.revision) continue
          const value = await this.translate(type, id, { fieldId: JSON.stringify([field.blockId, field.blockType, field.itemId ?? field.path]), fieldPath: selected.path,
            sourceText: field.text, revision: field.revision, maxLength: field.maxLength, value: null, origin: 'automatic', status: 'missing' })
          const wrote = await this.deps.db.transaction(async tx => {
            const current = await readContentRow(tx, type, id, true)
            if (!current) return false
            if (!await isActive(tx)) return false
            if (row.blocksAr && !current.blocksAr) return false
            const latest = this.blockFields(current).find(candidate => sameBlockField(candidate, field))
            if (!latest || latest.text !== field.text || latest.revision !== field.revision) return false
            const source = current.blocks as ArticleBlocksDoc
            const blocksAr = setArticleBlockTranslations(source, current.blocksAr, [{ blockId: field.blockId, path: latest.path, text: value }], 'automatic')
            if (!blocksAr) return false
            const updated = reconcileContentTranslation(type, id, current, { ...current, blocksAr })
            await writeContentRow(tx, type, id, updated)
            return true
          })
          if (wrote) await this.deps.invalidate(type)
        } catch (error) {
          failure ??= error
          const wrote = await this.deps.db.transaction(async tx => {
            const current = await readContentRow(tx, type, id, true)
            if (!current || row.blocksAr && !current.blocksAr) return
            if (!await isActive(tx)) return
            const latest = this.blockFields(current).find(candidate => sameBlockField(candidate, field) && candidate.text === field.text && candidate.revision === field.revision)
            if (!latest) return
            const translated = normalizeArticleBlocksTranslation(current.blocks as ArticleBlocksDoc | null, current.blocksAr)
            if (!translated) return
            const fields = translated.translation?.fields ?? []
            const index = fields.findIndex(state => state.blockId === field.blockId && state.blockType === field.blockType
              && JSON.stringify(state.fieldPath) === JSON.stringify(latest.path))
            const failed = { ...(index >= 0 ? fields[index] : {}), blockId: field.blockId, blockType: field.blockType,
              fieldPath: [...latest.path], itemId: field.itemId, sourceText: field.text, revision: field.revision, origin: 'automatic' as const,
              status: 'missing' as const, error: (error instanceof Error ? error.message : String(error)).slice(0, 500) }
            if (index >= 0) fields[index] = failed
            else fields.push(failed)
            translated.translation = { ...translated.translation, fields }
            await writeContentRow(tx, type, id, reconcileContentTranslation(type, id, current, { ...current, blocksAr: translated }))
            return true
          })
          if (wrote) await this.deps.invalidate(type)
          if (error instanceof AppError && error.code === 'SERVICE_UNAVAILABLE') throw error
        }
      }
      if (type === 'article') await this.deriveArticleContent(id, isActive)
    }
    if (failure) throw failure
  }

  private async deriveArticleContent(id: string, isActive: (tx?: DbOrTx) => Promise<boolean>): Promise<void> {
    const wrote = await this.deps.db.transaction(async tx => {
      const current = await readContentRow(tx, 'article', id, true)
      if (!current?.blocks) return false
      if (!await isActive(tx)) return false
      const field = contentTranslationFields('article', current).find(candidate => candidate.fieldId === 'content')
      if (!field || field.origin !== 'automatic') return false
      const value = blocksToPlainText(mergeArticleBlocksTranslation(current.blocks as ArticleBlocksDoc, current.blocksAr))
      if (!value || value === field.value && field.status === 'translated') return false
      // Derivation carries the same source proof as an automatic field; it costs no translator request.
      const invalidated = { ...current, contentAr: null, translationState: current.translationState ? {
        ...current.translationState, fields: current.translationState.fields.map(state => state.fieldId === 'content'
          ? { ...state, status: 'missing' as const } : state),
      } : current.translationState }
      const updated = reconcileContentTranslation('article', id, invalidated, invalidated, [{ fieldId: field.fieldId,
        fieldPath: field.fieldPath, sourceText: field.sourceText, revision: field.revision, value, origin: 'automatic' }])
      await writeContentRow(tx, 'article', id, updated)
      return true
    })
    if (wrote) await this.deps.invalidate('article')
  }
}
