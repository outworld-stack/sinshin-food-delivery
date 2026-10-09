// ═══════════════════════════════════════════════════════════════
// phase-2 — sinshin-food-delivery — فایل جدید
// مسیر مقصد: apps/api/src/infra/report/zip.ts
// ═══════════════════════════════════════════════════════════════

// src/infra/report/zip.ts
/**
 * فاز-۲ — سازنده‌ی بسته‌ی ZIP (بدون وابستگی خارجی).
 *
 * چرا دست‌ساز؟
 *  • Bun ZIP بومی ندارد (فقط gzip) و اضافه‌کردن پکیج فقط برای همین
 *    یک کار، ریسک سازگاری/امنیتی بی‌مورد است.
 *  • فرمت ZIP با روش STORE (بدون فشرده‌سازی) بخش سرراستی از اسپک است:
 *    local file header + central directory + EOCD. فایل‌های ما (CSV/
 *    لاگ متنی) حجم کمی دارند؛ فشرده‌سازی بهینه نیست.
 *
 * محدودیت‌های آگاهانه:
 *  • فقط روش STORE (method 0) — بدون deflate.
 *  • نام فایل‌ها ASCII (داخل بسته: orders.csv / users.csv / …)؛
 *    متن فارسی داخل «محتوای» فایل‌ها آزاد است (UTF-8).
 *  • سقف سخت ندارد — کالر (report.service) خودش سقف لاگ را اعمال می‌کند.
 */

/** جدول CRC-32 (IEEE 802.3) — ساخته‌شده یک‌بار در لود اول ماژول */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ (buf[i] ?? 0)) & 0xff]! ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

export interface ZipEntry {
  /** نام فایل داخل بسته — ASCII، بدون مسیر (پوشه نداریم) */
  name: string
  /** محتوا — متن UTF-8 یا بایت‌های خام */
  data: string | Uint8Array
  /** تاریخ فایل (برای هدر ZIP) — پیش‌فرض الان */
  modifiedAt?: Date
}

/** DOS date/time از Date — دقت ۲ ثانیه (محدودیت فرمت ZIP) */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear())
  const time =
    (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)
  const date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return { time, date }
}

/** ZIP (STORE) از چند فایل — خروجی Uint8Array آماده‌ی Response */
export function buildZip(entries: ZipEntry[]): Uint8Array {
  const enc = new TextEncoder()
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const data =
      typeof entry.data === 'string' ? enc.encode(entry.data) : entry.data
    const nameBytes = enc.encode(entry.name)
    if (nameBytes.length > 255) {
      throw new Error(`[zip] نام فایل بیش از حد بلند است: ${entry.name.slice(0, 40)}`)
    }
    const { time, date } = dosDateTime(entry.modifiedAt ?? new Date())
    const crc = crc32(data)

    // ── Local File Header (PK\x03\x04) ──
    const lfh = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(lfh.buffer)
    lv.setUint32(0, 0x04034b50, true) // signature
    lv.setUint16(4, 20, true) // version needed (2.0)
    lv.setUint16(6, 0x0800, true) // flags: UTF-8 names
    lv.setUint16(8, 0, true) // method: STORE
    lv.setUint16(10, time, true)
    lv.setUint16(12, date, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, data.length, true) // compressed size = size
    lv.setUint32(22, data.length, true) // uncompressed size
    lv.setUint16(26, nameBytes.length, true)
    lv.setUint16(28, 0, true) // extra len
    lfh.set(nameBytes, 30)
    localParts.push(lfh, data)

    // ── Central Directory Header (PK\x01\x02) ──
    const cdh = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(cdh.buffer)
    cv.setUint32(0, 0x02014b50, true) // signature
    cv.setUint16(4, 20, true) // version made by
    cv.setUint16(6, 20, true) // version needed
    cv.setUint16(8, 0x0800, true) // flags: UTF-8
    cv.setUint16(10, 0, true) // method: STORE
    cv.setUint16(12, time, true)
    cv.setUint16(14, date, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, data.length, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint16(30, 0, true) // extra
    cv.setUint16(32, 0, true) // comment
    cv.setUint16(34, 0, true) // disk number
    cv.setUint16(36, 0, true) // internal attrs
    cv.setUint32(38, 0, true) // external attrs
    cv.setUint32(42, offset, true) // local header offset
    cdh.set(nameBytes, 46)
    centralParts.push(cdh)

    offset += lfh.length + data.length
  }

  // ── End of Central Directory (PK\x05\x06) ──
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(4, 0, true) // disk
  ev.setUint16(6, 0, true) // start disk
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, centralParts.reduce((s, p) => s + p.length, 0), true) // size of central dir
  ev.setUint32(16, offset, true) // offset of central dir
  ev.setUint16(20, 0, true) // comment len

  const total =
    localParts.reduce((s, p) => s + p.length, 0) +
    centralParts.reduce((s, p) => s + p.length, 0) +
    eocd.length
  const out = new Uint8Array(total)
  let pos = 0
  for (const part of [...localParts, ...centralParts, eocd]) {
    out.set(part, pos)
    pos += part.length
  }
  return out
}
