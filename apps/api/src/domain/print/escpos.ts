// ═══════════════════════════════════════════════════════════════
// stage-88 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/domain/print/escpos.ts (فایل جدید)
// کدگذار ESC/POS — صفر وابستگی، بایت‌به‌بایت طبق مرجع رسمی اپسون.
//
// منابعِ فرمان‌ها (تحقیق استیج-۸۸، چندمنبعی راستی‌آزمایی‌شده):
//  · GS v 0 (تصویر رستری): 1D 76 30 m xL xH yL yH d…
//    – xL/xH «بایت در هر ردیف» = ⌈dots/8⌉ · yL/yH «ارتفاع به dot» —
//      هر دو little-endian؛ نامتقارن بودنِ x=بایت/y=dot خطای کلاسیک #۱ است.
//    – bit=1 یعنی «چاپ» (مشکی) · MSB سمت چپ · ردیف‌ها از بالا.
//  · برش: GS V (1D 56) — فرمانِ B: 1D 56 42 n = فید تا محلِ برش + برشِ
//    جزئی؛ فقط ابتدایِ خط اجرا می‌شود ⇒ قبلش LF.
//  · وضعیت لحظه‌ای: DLE EOT (10 04 n) — حتی وقتی بافر پر است پاسخ
//    می‌دهد؛ n=1 وضعیت پرینتر · n=4 سنسور کاغذ.
//  · قطعه‌بندیِ تصویر ≤ 960 dot (پیش‌فرضِ python-escpos) + LF بین
//    قطعه‌ها — بافر دریافتی چاپگرهای ارزان با تصویرِ یکپارچهٔ بزرگ
//    سرریز می‌شود.
//  · متنِ اسکی برای «صفحهٔ تست»: ESC t 0 (کدپیج PC437) — فارسی در
//    ESC/POS شکل‌گیری حروف ندارد؛ متنِ فارسی از مسیرِ رستریِ مرورگر
//    (canvas→GS v 0) می‌آید، نه از این فرمان‌ها.
// ═══════════════════════════════════════════════════════════════

//src/domain/print/escpos.ts

/** بیشینهٔ ارتفاعِ هر قطعهٔ GS v 0 (dot) — سرریزِ بافر چاپگرهای کلون */
export const RASTER_FRAGMENT_DOTS = 960

const u16le = (v: number): [number, number] => [v & 0xff, (v >> 8) & 0xff]

/** ESC @ — شروع/پایان کار: حالت‌های به‌جامانده از کارِ قبلی پاک شود */
export function cmdInit(): Uint8Array {
  return new Uint8Array([0x1b, 0x40])
}

/** LF (0x0A) — خالی‌کردنِ بافرِ خط؛ پیش‌نیازِ GS v 0 و GS V */
export function cmdLf(): Uint8Array {
  return new Uint8Array([0x0a])
}

/** ESC d n — چاپ بافر + فید n خط (حاشیهٔ پیش از برش) */
export function cmdFeed(lines: number): Uint8Array {
  const n = Math.max(0, Math.min(255, Math.round(lines)))
  return new Uint8Array([0x1b, 0x64, n])
}

/** ESC a n — تراز (0=چپ/1=وسط/2=راست) */
export function cmdAlign(n: 0 | 1 | 2): Uint8Array {
  return new Uint8Array([0x1b, 0x61, n])
}

/** ESC E n — بولد روشن/خاموش */
export function cmdBold(on: boolean): Uint8Array {
  return new Uint8Array([0x1b, 0x45, on ? 1 : 0])
}

/** GS ! n — مضرب عرض/ارتفاع (نیم‌بایت بالا=عرض، پایین=ارتفاع) */
export function cmdSize(mult: 1 | 2 | 4): Uint8Array {
  const v = mult === 4 ? 0x33 : mult === 2 ? 0x11 : 0x00
  return new Uint8Array([0x1d, 0x21, v])
}

/** ESC t 0 — کدپیج PC437 (اسکی) برای متنِ تست */
export function cmdCodepageUsa(): Uint8Array {
  return new Uint8Array([0x1b, 0x74, 0x00])
}

/** یک خطِ اسکی + LF — نویسه‌های غیراسکی به '?' تبدیل می‌شوند */
export function cmdTextLine(text: string): Uint8Array {
  const ascii = Array.from(text, (ch) => {
    const c = ch.codePointAt(0) ?? 63
    return c >= 0x20 && c <= 0x7e ? c : 0x3f
  })
  return new Uint8Array([...ascii, 0x0a])
}

/**
 * GS v 0 — یک قطعهٔ تصویرِ رستری 1bpp.
 * @param widthDots عرض تصویر (dot) — باید با عرضِ سرِ چاپگر یکی باشد
 * @param rows بایت‌های تصویر؛ طولِ آن باید bytesPerRow×heightDots باشد
 */
export function cmdRaster(
  widthDots: number,
  heightDots: number,
  rows: Uint8Array,
): Uint8Array {
  const bytesPerRow = Math.ceil(widthDots / 8)
  if (heightDots <= 0 || rows.length !== bytesPerRow * heightDots) {
    throw new Error(
      `bad raster dims: width=${widthDots} height=${heightDots} rows=${rows.length} (expected ${bytesPerRow * heightDots})`,
    )
  }
  const [xl, xh] = u16le(bytesPerRow)
  const [yl, yh] = u16le(heightDots)
  const out = new Uint8Array(8 + rows.length)
  out.set([0x1d, 0x76, 0x30, 0x00, xl, xh, yl, yh], 0)
  out.set(rows, 8)
  return out
}

export interface RasterJobOpts {
  /** برش جزئی در پایان (پیش‌فرض) — بدون برش فقط فید */
  autoCut: boolean
  /** خط‌های خالی پیش از برش (پیش‌فرض ۲ ≈ ۷.۵mm) */
  feedLinesBeforeCut?: number
  /** قطعهٔ حداکثر (dot) — 960 */
  fragmentDots?: number
}

/**
 * کارِ کاملِ چاپِ یک تصویر رستری:
 *   ESC @ → [GS v 0 قطعه + LF]×n → LF → ESC d n → (GS V 42 0 | فید) → ESC @
 * طولِ کاغذِ مصرفی = ارتفاعِ تصویر + فیدِ برش — دقیقاً «به‌اندازهٔ محتوا».
 */
export function buildRasterJob(
  widthDots: number,
  heightDots: number,
  rows: Uint8Array,
  opts: RasterJobOpts,
): Uint8Array {
  const fragment = Math.max(
    64,
    Math.min(opts.fragmentDots ?? RASTER_FRAGMENT_DOTS, RASTER_FRAGMENT_DOTS),
  )
  const bytesPerRow = Math.ceil(widthDots / 8)
  const parts: Uint8Array[] = [cmdInit()]
  for (let y = 0; y < heightDots; y += fragment) {
    const h = Math.min(fragment, heightDots - y)
    const slice = rows.subarray(y * bytesPerRow, (y + h) * bytesPerRow)
    parts.push(cmdRaster(widthDots, h, slice))
    parts.push(cmdLf())
  }
  parts.push(cmdLf())
  parts.push(cmdFeed(opts.feedLinesBeforeCut ?? 2))
  if (opts.autoCut) {
    // GS V 66 0 — فید تا محلِ برش + برشِ جزئی (کاغذِ ناچیز؛ تیغه هرگز
    // روی متن نمی‌نشیند چون فیدِ مخصوصِ برش جدا از فیدِ ما محاسبه می‌شود)
    parts.push(new Uint8Array([0x1d, 0x56, 0x42, 0x00]))
  }
  parts.push(cmdInit())
  let total = 0
  for (const p of parts) total += p.length
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

/** DLE EOT n (10 04 n) — درخواستِ وضعیتِ لحظه‌ای (پیش از چاپ) */
export function cmdStatus(n: 1 | 2 | 3 | 4): Uint8Array {
  return new Uint8Array([0x10, 0x04, n])
}

/** پاسخ DLE EOT 1 (وضعیت پرینتر) — 0x12 = آنلاینِ سالم */
export function parseStatusPrinter(byte: number): { offline: boolean } {
  // bit3=1 → آفلاین · بیت‌های ثابت 1 و 4 روشن
  return { offline: (byte & 0x08) !== 0 }
}

/** پاسخ DLE EOT 4 (سنسور کاغذ) — bits 5,6 = کاغذ تمام */
export function parseStatusPaper(byte: number): {
  paperEnd: boolean
  paperNearEnd: boolean
} {
  return {
    paperEnd: (byte & 0x60) === 0x60,
    paperNearEnd: (byte & 0x0c) === 0x0c,
  }
}

/** صفحهٔ تستِ اسکی — همان مسیرِ سوکت، بدون نیاز به canvas (فارسی نیست؛
 *  تستِ فارسی از خودِ مودال با رسیدِ رستریِ واقعی انجام می‌شود) */
export function buildTestJob(input: {
  name: string
  host: string
  widthDots: number
  autoCut: boolean
}): Uint8Array {
  const parts: Uint8Array[] = [
    cmdInit(),
    cmdCodepageUsa(),
    cmdAlign(1),
    cmdBold(true),
    cmdSize(2),
    cmdTextLine('SINSHIN PRINT TEST'),
    cmdSize(1),
    cmdBold(false),
    cmdTextLine('------------------------'),
    cmdTextLine(`Printer: ${input.name}`),
    cmdTextLine(`Address: ${input.host}`),
    cmdTextLine(`Width:   ${input.widthDots} dots`),
    cmdTextLine(`Date:    ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`),
    cmdTextLine('------------------------'),
    cmdAlign(0),
    cmdTextLine('abcdefghijklmnopqrstuvwxyz 0123456789'),
    cmdFeed(1),
    // نوارِ تستِ تراکم — الگویِ متناوبِ مشکی/سفید
    cmdAlign(1),
    cmdTextLine('+-+-+-+-+-+-+-+-+-+-+-+-'),
    cmdFeed(2),
  ]
  if (input.autoCut) parts.push(new Uint8Array([0x1d, 0x56, 0x42, 0x00]))
  parts.push(cmdInit())
  let total = 0
  for (const p of parts) total += p.length
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}
