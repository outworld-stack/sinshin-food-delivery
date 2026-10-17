// src/domain/article/blocks-normalize.ts
// ═══════════════════════════════════════════════════════════════
// stage-82 — اعتبارسنجی/نرمال‌سازیِ سندِ بلوکیِ مقاله (سمت سرور).
//
// لایه‌بندیِ تحقیق‌شده (IBM rich-text XSS / Editor.js #1884):
//  ۱) TypeBox در روت — پاکتِ سند + enum ها + سقف‌های کلی
//  ۲) همین فایل — اعتبارسنجیِ سخت‌گیرِ per-type + حذفِ ناشناخته‌ها
//  ۳) رندر عمومی — defensive (بلوکِ خراب = skip، نه کرش)
//
// سیاست: «بلوکِ ناشناخته/خراب حذف می‌شود، نه کلِ سند» (درسِ Gutenberg).
// هیچ HTML خامی ذخیره نمی‌شود؛ تنها سطحِ حمله URL تصاویر است →
// الگوی^(https:\/\/|\/) (http خام = mixed-content رد؛ javascript: و
// پروتکل-نسبی بی‌معنی رد). رنگ‌ها فقط hex ۶رقمی.
// ═══════════════════════════════════════════════════════════════
import { randomUUID } from 'node:crypto'

import { isArticleBlockUrl, isHexColor, type ArticleBlock, type ArticleBlocksDoc } from '@sinshin/shared'
import { Err } from '#/domain/shared/errors'

/** سقف‌ها — آینه‌ی articleBody (روت) برای دفاع در عمق */
const LIMITS = {
        blocks: 200,
        docBytes: 262_144, // 256KB
        text: 5_000,
        heading: 200,
        quote: 1_000,
        calloutTitle: 160,
        author: 120,
        listItem: 300,
        listItems: 30,
        gallery: 12,
        ctaLabel: 60,
        heroText: 500,
        url: 500,
        alt: 200,
} as const

const BLOCK_TYPES = new Set([
        'hero',
        'heading',
        'paragraph',
        'image',
        'gallery',
        'quote',
        'callout',
        'list',
        'cta',
        'divider',
])
const WIDTHS = new Set<NonNullable<ArticleBlock['width']>>(['sm', 'md', 'lg', 'full'])
const ANIMS = new Set<NonNullable<ArticleBlock['anim']>>(['none', 'fade', 'fade-up', 'slide', 'zoom', 'blur'])
const PADS = new Set<'sm' | 'md' | 'lg'>(['sm', 'md', 'lg'])
const ALIGNS = new Set<'start' | 'center'>(['start', 'center'])

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const str = (v: unknown, max: number): string | undefined => {
        if (typeof v !== 'string') return undefined
        const t = v.trim()
        return t.length === 0 ? undefined : t.slice(0, max)
}

const url = (v: unknown): string | undefined => {
        if (typeof v !== 'string') return undefined
        const t = v.trim()
        if (!t || t.length > LIMITS.url) return undefined
        return isArticleBlockUrl(t) ? t : undefined
}

const hex = (v: unknown): string | undefined => (isHexColor(v) ? v : undefined)

const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined)

const oneOf = <T extends string>(v: unknown, set: Set<T>): T | undefined =>
        typeof v === 'string' && set.has(v as T) ? (v as T) : undefined

function normalizeStyle(raw: unknown): ArticleBlock['style'] {
        if (!isRec(raw)) return undefined
        const out: NonNullable<ArticleBlock['style']> = {}
        const bg = hex(raw.bg)
        if (bg) out.bg = bg
        const fg = hex(raw.fg)
        if (fg) out.fg = fg
        const align = oneOf(raw.align, ALIGNS)
        if (align) out.align = align
        const pad = oneOf(raw.pad, PADS)
        if (pad) out.pad = pad
        return Object.keys(out).length > 0 ? out : undefined
}

/** props هر بلوک — undefined یعنی بلوک حذف شود */
function normalizeProps(type: string, raw: unknown): Record<string, unknown> | undefined {
        if (type === 'divider' && raw === undefined) return { variant: 'line' }
        if (!isRec(raw)) return undefined
        switch (type) {
                case 'hero': {
                        const out: Record<string, unknown> = {}
                        const src = url(raw.src)
                        if (src) out.src = src
                        const title = str(raw.title, LIMITS.heading)
                        if (title) out.title = title
                        const text = str(raw.text, LIMITS.heroText)
                        if (text) out.text = text
                        return src || title || text ? out : undefined
                }
                case 'heading': {
                        const text = str(raw.text, LIMITS.heading)
                        if (!text) return undefined
                        const level = raw.level === 3 ? 3 : 2
                        return { text, level }
                }
                case 'paragraph': {
                        const text = str(raw.text, LIMITS.text)
                        return text ? { text } : undefined
                }
                case 'image': {
                        const src = url(raw.src)
                        if (!src) return undefined
                        const out: Record<string, unknown> = { src }
                        const alt = str(raw.alt, LIMITS.alt)
                        if (alt) out.alt = alt
                        const caption = str(raw.caption, LIMITS.calloutTitle)
                        if (caption) out.caption = caption
                        return out
                }
                case 'gallery': {
                        const rawImages = Array.isArray(raw.images) ? raw.images : []
                        const images = rawImages
                                .map((im) => {
                                        if (!isRec(im)) return null
                                        const src = url(im.src)
                                        if (!src) return null
                                        const alt = str(im.alt, LIMITS.alt)
                                        return alt ? { src, alt } : { src }
                                })
                                .filter((x): x is { src: string; alt?: string } => x !== null)
                                .slice(0, LIMITS.gallery)
                        if (images.length === 0) return undefined
                        const layout = raw.layout === 'slider' ? 'slider' : 'grid'
                        return { images, layout }
                }
                case 'quote': {
                        const text = str(raw.text, LIMITS.quote)
                        if (!text) return undefined
                        const author = str(raw.author, LIMITS.author)
                        return author ? { text, author } : { text }
                }
                case 'callout': {
                        const text = str(raw.text, LIMITS.quote)
                        if (!text) return undefined
                        const title = str(raw.title, LIMITS.calloutTitle)
                        return title ? { title, text } : { text }
                }
                case 'list': {
                        const rawItems = Array.isArray(raw.items) ? raw.items : []
                        const items = rawItems
                                .map((it) => str(it, LIMITS.listItem))
                                .filter((x): x is string => x !== undefined)
                                .slice(0, LIMITS.listItems)
                        if (items.length === 0) return undefined
                        const ordered = bool(raw.ordered)
                        return ordered ? { items, ordered: true } : { items }
                }
                case 'cta': {
                        const label = str(raw.label, LIMITS.ctaLabel)
                        if (!label) return undefined
                        const out: Record<string, unknown> = { label }
                        const to = oneOf(raw.to, new Set(['menu', 'articles', 'url'] as const)) ?? 'menu'
                        const href = url(raw.href)
                        if (to === 'url' && href) {
                                out.to = 'url'
                                out.href = href
                        } else {
                                // url بدون href معتبر = تنزل به menu (دکمه هرگز مرده نمی‌شود)
                                out.to = to === 'url' ? 'menu' : to
                        }
                        const title = str(raw.title, LIMITS.calloutTitle)
                        if (title) out.title = title
                        const text = str(raw.text, LIMITS.heroText)
                        if (text) out.text = text
                        return out
                }
                case 'divider': {
                        const variant = oneOf(raw.variant, new Set(['line', 'dots', 'space'] as const)) ?? 'line'
                        return { variant }
                }
                default:
                        return undefined
        }
}

/**
 * ورودیِ هرچه که هست → سندِ تمیز یا null (بدون بلوکِ معتبر).
 * اثر جانبی: لاگِ شمارِ حذفیات برای ممیزی (بلوک ناشناخته = سکوتِ رندر،
 * اما ادمین باید در لاگ ببیند چرا چیزی که فرستاده ذخیره نشد).
 */
export function normalizeBlocksDoc(input: unknown): ArticleBlocksDoc | null {
        if (!isRec(input)) return null
        if (input.version !== 1) return null
        if (!Array.isArray(input.blocks)) return null

        const seenIds = new Set<string>()
        const blocks: ArticleBlock[] = []
        let dropped = 0

        for (const raw of input.blocks.slice(0, LIMITS.blocks)) {
                if (!isRec(raw)) {
                        dropped++
                        continue
                }
                const type = typeof raw.type === 'string' && BLOCK_TYPES.has(raw.type) ? raw.type : null
                if (!type) {
                        dropped++
                        continue
                }
                const props = normalizeProps(type, raw.props)
                if (!props) {
                        dropped++
                        continue
                }
                // id پایدار — نبود/تکراری = تولیدِ تازه (کپی‌ها در ادیتور id تازه می‌گیرند؛
                // این دفاعِ دوم است — key های رندر هرگز ایندکس نیستند)
                let id = typeof raw.id === 'string' && raw.id.length <= 64 ? raw.id.trim() : ''
                if (!id || seenIds.has(id)) id = randomUUID()
                seenIds.add(id)

                const block: Record<string, unknown> = { id, type, props }
                const width = oneOf(raw.width, WIDTHS)
                if (width) block.width = width
                const anim = oneOf(raw.anim, ANIMS)
                if (anim) block.anim = anim
                const style = normalizeStyle(raw.style)
                if (style) block.style = style
                blocks.push(block as unknown as ArticleBlock)
        }

        if (blocks.length === 0) return null
        const doc: ArticleBlocksDoc = { version: 1, blocks }
        if (Buffer.byteLength(JSON.stringify(doc), 'utf8') > LIMITS.docBytes) {
                // Returning null would silently erase a saved article's block layout.
                throw Err.validation('حجم محتوای بلوکی مقاله نباید بیشتر از ۲۵۶ کیلوبایت باشد.')
        }
        if (dropped > 0) {
                console.warn(`[articles] normalizeBlocksDoc: ${dropped} invalid block(s) dropped`)
        }
        return doc
}
