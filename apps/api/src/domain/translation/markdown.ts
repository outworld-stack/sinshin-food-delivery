// ═══════════════════════════════════════════════════════════════
// round-36 — sinshin-food-delivery — فایل 4 از 14
// مسیر مقصد: apps/api/src/domain/translation/markdown.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty two
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// round-35 — sinshin-food-delivery — فایل 11 از 31
// مسیر مقصد: apps/api/src/domain/translation/markdown.ts
// وضعیت: فایل جدید (قبلاً وجود نداشت)
// کامیت پیشنهادی: stage thirty one
// ═══════════════════════════════════════════════════════════════

// src/domain/translation/markdown.ts
/**
 * round-35 — تکه‌تکه‌کردن امنِ متن/Markdown برای ترجمه‌ی ماشینی.
 *
 * چرا: مترجم (NLLB) نباید ساختار Markdown را ببیند/خراب کند و هر
 * قطعه‌ی ارسالی باید کوتاه باشد (سقف خروجی decoder). این ماژول
 * متن را به «قطعات قابل‌ترجمه» می‌شکند و سازواره‌ی بازچینی می‌دهد
 * که خروجی ترجمه‌ها را دقیقاً در جای خودشان می‌نشاند.
 *
 * چه چیزی ترجمه می‌شود: متنِ پاراگراف‌ها، سرفصل‌ها (پس از جداکردن
 * ##/-/1./>)، آیتم‌های لیست، و سلول‌های جدول.
 *
 * چه چیزی عیناً محفوظ می‌ماند:
 *  • بلوک‌های کد fences (``` / ~~~) و خطوط داخلشان
 *  • خط‌های افقی (--- یا *** یا ___)، ردیف‌های جداکننده‌ی جدول (|---|---|)
 *  • خطوط خالی (فاصله‌ی پاراگراف‌ها)
 *  • توکن‌های درون‌خطی: `کد`، لینک‌ها [متن](url)، تصاویر ![alt](url)،
 *    URLهای خالی — با جای‌نگهدار [[n]] محافظت و بعد از ترجمه بازگردانده
 *    می‌شوند (شماره‌ها در کل سند یکتاند)
 *
 * محدودیت صادقانه: نشانگرهای پررنگ و مورب (ستاره‌دوتایی و زیرخط) در متن
 * می‌مانند و معمولاً توسط مدل کپی می‌شوند؛ اگر مدل جایی خرابشان کند،
 * ادمین در فرم می‌بیند.
 *
 * متن ساده (بدون Markdown) هم از همین مسیر می‌گذرد — تک‌بلوک ساده؛
 * همین یک مسیر برای preview فرم‌ها و بدنه‌ی مقاله‌ها.
 */

/** سقف طول هر قطعه‌ی ارسالی به مترجم (کاراکتر) */
const MAX_SEGMENT_CHARS = 380

/** توکن‌های درون‌خطیِ محافظت‌شده */
const INLINE_PROTECT =
  /(`[^`\n]+`)|(!\[[^\]]*\]\([^)\s]+\))|(\[[^\]\n]+\]\([^)\s]+\))|(https?:\/\/[^\s<>()]+)/g

/** جای‌نگهدار — براکت‌های ASCII که مدل معمولاً عیناً کپی می‌کند */
const PLACEHOLDER = /\[\[\s*(\d+)\s*\]\]/g

/** سرفصل/لیست/نقل‌قول — پیشوند ساختاری جدا و «متن» ترجمه می‌شود */
const PREFIXED = /^(\s*(?:#{1,6}|[-*+]|\d+[.)]|[>])\s+)(.*)$/

/** خط افقی */
const HORIZONTAL_RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/

/** ردیف جداکننده‌ی جدول: فقط |، فاصله، : و - */
const TABLE_SEPARATOR = /^\s*\|?[\s:|-]+\|?\s*$/

/** آیا بعد از حذف جای‌نگهدارها حرفی برای ترجمه مانده؟ */
const HAS_LETTER = /[\p{L}\p{N}]/u

type Piece =
  | { readonly kind: 'raw'; readonly s: string }
  | { readonly kind: 'seg'; readonly pre: string; readonly body: string; readonly post: string; readonly glue?: boolean }

/** خط خروجی — یا ساده (تکه‌ها پشت‌سرهم) یا ردیف جدول (سلول‌ها با | جدایشان بازسازی می‌شوند) */
type Block =
  | { readonly kind: 'line'; readonly pieces: readonly Piece[] }
  | { readonly kind: 'tableRow'; readonly cells: readonly (readonly Piece[])[] }

/** نقشه‌ی ترجمه — قطعات + سازواره‌ی بازچینی */
export interface TextPlan {
  /** قطعات قابل‌ترجمه به ترتیب سند */
  readonly segments: readonly string[]
  /** جای‌گذاری ترجمه‌ها (هم‌طول با segments) → متن کامل */
  readonly assemble: (translations: readonly string[]) => string
}

function restore(s: string, stash: readonly string[]): string {
  return s.replace(PLACEHOLDER, (_, n: string) => {
    const v = stash[Number(n)]
    return v !== undefined ? v : `[[${n}]]`
  })
}

/** شکستن متن بلند به قطعات ≤ max — مرز جمله، بعد مرز کلمه */
function splitLongText(text: string, max: number): string[] {
  // ۱) مرزهای جمله (فارسی/عربی/لاتین)
  const sentences = text.split(/(?<=[.!?؟…؛])\s+/).flatMap((s) =>
    s.length > max ? hardWrap(s, max) : [s],
  )
  // ۲) چسباندن جمله‌ها تا سقف
  const out: string[] = []
  let buf = ''
  for (const s of sentences) {
    if (buf !== '' && buf.length + 1 + s.length > max) {
      out.push(buf)
      buf = s
    } else {
      buf = buf === '' ? s : `${buf} ${s}`
    }
  }
  if (buf !== '') out.push(buf)
  return out
}

/** جمله‌ی بی‌مرز و خیلی بلند → شکستن مرز کلمه */
function hardWrap(s: string, max: number): string[] {
  const words = s.split(' ')
  const out: string[] = []
  let buf = ''
  for (const w of words) {
    if (buf !== '' && buf.length + 1 + w.length > max) {
      out.push(buf)
      buf = w
    } else {
      buf = buf === '' ? w : `${buf} ${w}`
    }
  }
  if (buf !== '') out.push(buf)
  return out
}

/**
 * ساخت نقشه‌ی ترجمه برای یک متن (Markdown یا ساده).
 *
 * متن‌های چندخطی: هر خطِ محتوایی قطعه‌ای خودش را می‌گیرد (کانتینر
 * مترجم هم خط‌به‌خط کار می‌کند)؛ خطوط خالی/ساختاری عیناً می‌مانند.
 */
export function planText(input: string): TextPlan {
  const stash: string[] = []
  const blocks: Block[] = []

  const protect = (body: string): string =>
    body.replace(INLINE_PROTECT, (m) => {
      stash.push(m)
      return `[[${stash.length - 1}]]`
    })

  const pushSeg = (target: Piece[], pre: string, body: string, post: string): void => {
    const protectedBody = protect(body)
    // فقط جای‌نگهدار/فاصله است → ترجمه‌ای نیست؛ عیناً برگردان
    if (!HAS_LETTER.test(protectedBody.replace(PLACEHOLDER, ''))) {
      target.push({ kind: 'raw', s: pre + restore(protectedBody, stash) + post })
      return
    }
    if (protectedBody.length <= MAX_SEGMENT_CHARS) {
      target.push({ kind: 'seg', pre, body: protectedBody, post })
      return
    }
    // بلند → چند قطعه‌ی پیوسته؛ pre روی اولی، post روی آخری.
    // round-36 — glue: فاصله‌ای که شکستن مرز جمله/کلمه بلعیده، هنگام
    // بازچینی به‌صورت فاصله‌ی بین قطعات برمی‌گردد (باگ تست عمیق:
    // «…است.این جمله…» بدون فاصله چسبیده بود).
    const chunks = splitLongText(protectedBody, MAX_SEGMENT_CHARS)
    chunks.forEach((c, i) => {
      target.push({
        kind: 'seg',
        pre: i === 0 ? pre : '',
        body: c,
        post: i === chunks.length - 1 ? post : '',
        glue: i > 0,
      })
    })
  }

  let inFence = false
  let fenceMarker = ''

  for (const rawLine of input.replace(/\r\n/g, '\n').split('\n')) {
    // ── بلوک کد ──
    const fence = rawLine.match(/^\s*(```|~~~)/)
    if (fence) {
      if (!inFence) {
        inFence = true
        fenceMarker = fence[1] ?? '```'
      } else if (fence[1] === fenceMarker) {
        inFence = false
      }
      blocks.push({ kind: 'line', pieces: [{ kind: 'raw', s: rawLine }] })
      continue
    }
    if (inFence) {
      blocks.push({ kind: 'line', pieces: [{ kind: 'raw', s: rawLine }] })
      continue
    }

    // ── خط خالی / خط افقی ──
    if (rawLine.trim() === '' || HORIZONTAL_RULE.test(rawLine)) {
      blocks.push({ kind: 'line', pieces: [{ kind: 'raw', s: rawLine }] })
      continue
    }

    // ── جدول ──
    if (rawLine.includes('|') && rawLine.trimStart().startsWith('|')) {
      if (TABLE_SEPARATOR.test(rawLine) && rawLine.includes('-')) {
        blocks.push({ kind: 'line', pieces: [{ kind: 'raw', s: rawLine }] })
        continue
      }
      // سلول‌به‌سلول؛ فاصله‌های دور سلول در pre/post حفظ و |ها با join بازسازی
      const cells = rawLine.split('|').map((p) => {
        const t = p.trim()
        if (t === '') return [{ kind: 'raw', s: p }] as const
        const first = p.indexOf(t[0]!)
        const pieces: Piece[] = []
        pushSeg(pieces, p.slice(0, first), t, p.slice(first + t.length))
        return pieces
      })
      blocks.push({ kind: 'tableRow', cells })
      continue
    }

    // ── سرفصل/لیست/نقل‌قول ──
    const prefixed = rawLine.match(PREFIXED)
    if (prefixed && (prefixed[2] ?? '').trim() !== '') {
      const pieces: Piece[] = []
      pushSeg(pieces, prefixed[1] ?? '', prefixed[2] ?? '', '')
      blocks.push({ kind: 'line', pieces })
      continue
    }

    // ── خطِ پاراگراف ──
    const pieces: Piece[] = []
    pushSeg(pieces, '', rawLine, '')
    blocks.push({ kind: 'line', pieces })
  }

  // جمع‌آوری قطعات به ترتیب سند
  const segBodies: string[] = []
  for (const b of blocks) {
    const groups = b.kind === 'tableRow' ? b.cells : [b.pieces]
    for (const g of groups) {
      for (const p of g) {
        if (p.kind === 'seg') segBodies.push(p.body)
      }
    }
  }

  const renderPiece = (p: Piece, translations: string[]): string => {
    if (p.kind === 'raw') return p.s
    const t = restore(translations.shift() ?? '', stash)
    // قطعات پیوسته‌ی یک خط بلند با یک فاصله به هم می‌چسبند (glue)
    return p.pre + (p.kind === 'seg' && p.glue && t !== '' ? ' ' : '') + t + p.post
  }

  return {
    segments: segBodies,
    assemble: (translations: readonly string[]) => {
      const queue = [...translations]
      return blocks
        .map((b) => {
          if (b.kind === 'tableRow') {
            return b.cells.map((cell) => cell.map((p) => renderPiece(p, queue)).join('')).join('|')
          }
          return b.pieces.map((p) => renderPiece(p, queue)).join('')
        })
        .join('\n')
    },
  }
}
