//src/infra/report/xlsx.writer.ts
/**
 * XLSX مینیمال — دست‌ساز، بدون وابستگی.
 * Excel-strict: fills>=2 (none+gray125)، cellStyles Normal، bookViews، dimension،
 * گارد NaN/تاریخ نامعتبر — همه‌ی سخت‌گیری‌های شناخته‌شده‌ی اکسل اعمال شده.
 */

// ── ZIP writer (store method — بدون فشرده‌سازی) ──

interface ZipEntry {
    name: string
    data: Uint8Array
}

const CRC_TABLE = (() => {
    const table = new Uint32Array(256)
    for (let i = 0; i < 256; i++) {
        let c = i
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
        table[i] = c >>> 0
    }
    return table
})()

function crc32(data: Uint8Array): number {
    let crc = 0xffffffff
    for (let i = 0; i < data.length; i++) {
        const byte = data[i]!
        crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
    }
    return (crc ^ 0xffffffff) >>> 0
}

function buildZip(entries: ZipEntry[]): Uint8Array {
    const chunks: Uint8Array[] = []
    const central: Uint8Array[] = []
    let offset = 0

    const enc = new TextEncoder()

    for (const entry of entries) {
        const nameBytes = enc.encode(entry.name)
        const crc = crc32(entry.data)

        const local = new Uint8Array(30 + nameBytes.length)
        const lv = new DataView(local.buffer)
        lv.setUint32(0, 0x04034b50, true)
        lv.setUint16(4, 20, true)
        lv.setUint16(6, 0x0800, true)
        lv.setUint16(8, 0, true)
        lv.setUint16(10, 0, true)
        lv.setUint16(12, 0x21, true)
        lv.setUint32(14, crc, true)
        lv.setUint32(18, entry.data.length, true)
        lv.setUint32(22, entry.data.length, true)
        lv.setUint16(26, nameBytes.length, true)
        lv.setUint16(28, 0, true)
        local.set(nameBytes, 30)

        chunks.push(local, entry.data)

        const cd = new Uint8Array(46 + nameBytes.length)
        const cv = new DataView(cd.buffer)
        cv.setUint32(0, 0x02014b50, true)
        cv.setUint16(4, 20, true)
        cv.setUint16(6, 20, true)
        cv.setUint16(8, 0x0800, true)
        cv.setUint16(10, 0, true)
        cv.setUint16(12, 0, true)
        cv.setUint16(14, 0x21, true)
        cv.setUint32(16, crc, true)
        cv.setUint32(20, entry.data.length, true)
        cv.setUint32(24, entry.data.length, true)
        cv.setUint16(28, nameBytes.length, true)
        cv.setUint32(42, offset, true)
        cd.set(nameBytes, 46)
        central.push(cd)

        offset += local.length + entry.data.length
    }

    const centralSize = central.reduce((s, c) => s + c.length, 0)
    const eocd = new Uint8Array(22)
    const ev = new DataView(eocd.buffer)
    ev.setUint32(0, 0x06054b50, true)
    ev.setUint16(8, entries.length, true)
    ev.setUint16(10, entries.length, true)
    ev.setUint32(12, centralSize, true)
    ev.setUint32(16, offset, true)

    const all = [...chunks, ...central, eocd]
    const total = all.reduce((s, c) => s + c.length, 0)
    const out = new Uint8Array(total)
    let p = 0
    for (const c of all) {
        out.set(c, p)
        p += c.length
    }
    return out
}

// ── XML helpers ──

const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const colLetter = (i: number): string => {
    let s = ''
    let n = i
    while (n >= 0) {
        s = String.fromCharCode(65 + (n % 26)) + s
        n = Math.floor(n / 26) - 1
    }
    return s
}

export interface SheetData {
    name: string
    rows: (string | number | Date | null)[][]
}

function excelSerial(d: Date): number {
    const base = Date.UTC(1899, 11, 30)
    const ms = d.getTime() - base
    return Math.round((ms / 86400000) * 100000) / 100000
}

function sheetXml(sheet: SheetData): string {
    let body = ''
    let maxCol = 0
    for (const row of sheet.rows) maxCol = Math.max(maxCol, row?.length ?? 0)
    const dim =
        sheet.rows.length > 0 && maxCol > 0
            ? `<dimension ref="A1:${colLetter(maxCol - 1)}${sheet.rows.length}"/>`
            : ''

    for (let r = 0; r < sheet.rows.length; r++) {
        const row = sheet.rows[r]!
        let cells = ''
        for (let c = 0; c < row.length; c++) {
            const cell = row[c]
            if (cell === null || cell === undefined) continue
            const ref = `${colLetter(c)}${r + 1}`

            if (cell instanceof Date) {
                const serial = excelSerial(cell)
                // تاریخ نامعتبر/خارج از بازه → به‌صورت متن امن
                if (Number.isFinite(serial) && serial > 0) {
                    cells += `<c r="${ref}" s="1"><v>${serial}</v></c>`
                } else {
                    cells += `<c r="${ref}" t="inlineStr"><is><t>${esc(cell.toISOString())}</t></is></c>`
                }
            } else if (typeof cell === 'number') {
                // NaN/Infinity → متن امن، نه عدد خراب
                if (Number.isFinite(cell)) {
                    cells += `<c r="${ref}"><v>${cell}</v></c>`
                } else {
                    cells += `<c r="${ref}" t="inlineStr"><is><t>${esc(String(cell))}</t></is></c>`
                }
            } else {
                cells += `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(cell)}</t></is></c>`
            }
        }
        if (cells === '') continue
        body += `<row r="${r + 1}">${cells}</row>`
    }
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
 ${dim}
<sheetData>${body}</sheetData>
</worksheet>`
}

export function buildXlsx(sheets: SheetData[]): Uint8Array {
    const enc = new TextEncoder()
    const entries: ZipEntry[] = []

    const sheetEntries = sheets.map((_, i) => `xl/worksheets/sheet${i + 1}.xml`)

    entries.push({
        name: '[Content_Types].xml',
        data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
 ${sheets
                .map(
                    (_, i) =>
                        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
                )
                .join('\n')}
</Types>`),
    })

    entries.push({
        name: '_rels/.rels',
        data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    })

    // bookViews قبل از sheets — الزامی اکسل
    entries.push({
        name: 'xl/workbook.xml',
        data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView/></bookViews>
<sheets>
 ${sheets
                .map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
                .join('\n')}
</sheets>
</workbook>`),
    })

    entries.push({
        name: 'xl/_rels/workbook.xml.rels',
        data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 ${sheets
                .map(
                    (_, i) =>
                        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
                )
                .join('\n')}
</Relationships>`),
    })


    // harden: fills>=2 + cellStyles Normal — سخت‌گیری اکسل
    entries.push({
        name: 'xl/styles.xml',
        data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm:ss"/></numFmts>
<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`),
    })


    for (let i = 0; i < sheets.length; i++) {
        entries.push({ name: sheetEntries[i]!, data: enc.encode(sheetXml(sheets[i]!)) })
        // worksheet rels — ارجاع زنده به styles؛ بدون آن اکسل s="1" را «جداشده» می‌بیند → repair
        entries.push({
            name: `xl/worksheets/_rels/sheet${i + 1}.xml.rels`,
            data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="../styles.xml"/>
</Relationships>`),
        })
    }

    return buildZip(entries)
}