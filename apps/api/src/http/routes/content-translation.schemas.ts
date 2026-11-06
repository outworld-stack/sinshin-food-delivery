import { t } from 'elysia'

export const contentFieldPathSchema = t.Array(t.Union([t.String({ minLength: 1, maxLength: 64 }), t.Integer({ minimum: 0, maximum: 10000 })]), { minItems: 1, maxItems: 6 })
export const translationEditsSchema = t.Array(t.Object({
  fieldId: t.String({ minLength: 1, maxLength: 256 }),
  fieldPath: contentFieldPathSchema,
  sourceText: t.String({ maxLength: 1000000 }),
  value: t.String({ maxLength: 1000000 }),
  revision: t.Integer({ minimum: 0 }),
  origin: t.Union([t.Literal('manual'), t.Literal('automatic')]),
// Terms allow 100 sections with 100 independently editable items plus a title each.
}, { additionalProperties: false }), { maxItems: 10100 })
