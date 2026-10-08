//src/infra/uploads/upload.service.ts
import { Err } from '#/domain/shared/errors'

const EXT_BY_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/webp': 'webp',
}
const MAX_BYTES = 2 * 1024 * 1024
const NAME_RE = /^[a-f0-9-]{36}\.(png|webp)$/
/** round-18 — سقف شمارش برای usage()؛ مسیر «فقط ادمین»، نه هر درخواست */
const USAGE_MAX_FILES = 20_000

// ── رارد M14 — بررسی magic bytes + سقف ابعاد پیکسلی ──
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const MAX_PIXELS = 40_000_000 // ~۴۰MP — بالای هر موبایل/دوربین منطقی

function hasImageMagic(head: Uint8Array, ext: string): boolean {
  if (ext === 'png') {
    return PNG_SIG.every((b, i) => head[i] === b)
  }
  // webp: "RIFF" + 4B size + "WEBP"
  return (
    head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 &&
    head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50
  )
}

/** IHDR width/height — big-endian در بایت‌های 16..24 */
function pngWithinPixelCap(head: Uint8Array): boolean {
  const w = ((head[16]! << 24) | (head[17]! << 16) | (head[18]! << 8) | head[19]!) >>> 0
  const h = ((head[20]! << 24) | (head[21]! << 16) | (head[22]! << 8) | head[23]!) >>> 0
  return w > 0 && h > 0 && w * h <= MAX_PIXELS
}

export class UploadService {
  private readonly ready: Promise<void>
  /** round-16 — خطای آماده‌سازی ذخیره‌شده تا reject خاموش (unhandledRejection) تولید نشود */
  private dirError: unknown = null

  constructor(private readonly dir: string) {
    // بومیِ Bun — بدون node:fs؛ یک‌بار در عمر سرویس
    // round-16: خطای mkdir می‌ماند و در save با خطای شفاف ۵۰۳ سرو می‌شود
    this.ready = Bun.$`mkdir -p ${this.dir}`
      .then(() => {})
      .catch((err) => {
        this.dirError = err
        console.error('[uploads] storage dir not writable:', err)
      })
  }

  /** round-16 — برای روت سلامت: پوشهٔ آپلود قابل نوشتن است؟ */
  get storageReady(): boolean {
    return this.dirError === null
  }

  async save(file: File): Promise<{ url: string }> {
    const ext = EXT_BY_TYPE[file.type]
    if (!ext) throw Err.validation('فقط PNG یا WebP مجاز است.')
    if (file.size > MAX_BYTES) throw Err.validation('حداکثر حجم ۲ مگابایت است.')
    await this.ready
    if (this.dirError !== null) {
      throw Err.serviceUnavailable(
        'ذخیره‌سازی فایل در دسترس نیست — پوشهٔ آپلود سرور قابل نوشتن نیست.',
      )
    }

    // رارد M14 — magic bytes: Content-Type قابل جعل است؛ محتوای واقعی فایل
    // چک می‌شود (PNG: امضای ۸ بایتی | WebP: RIFF....WEBP). فایل حداکثر ۲MB
    // است و از قبل در حافظه — کل آن خوانده و ابتدایش چک می‌شود.
    const bytes = new Uint8Array(await file.arrayBuffer())
    const head = bytes.length > 32 ? bytes.slice(0, 32) : bytes
    if (!hasImageMagic(head, ext)) {
      throw Err.validation('محتوای فایل با فرمت اعلام‌شده نمی‌خواند (فقط PNG/WebP).')
    }
    if (ext === 'png' && head.length >= 24 && !pngWithinPixelCap(head)) {
      throw Err.validation('ابعاد تصویر بیش از حد مجاز است (حداکثر ۴۰ مگاپیکسل).')
    }

    const name = `${crypto.randomUUID()}.${ext}`
    await Bun.write(`${this.dir}/${name}`, file)
    return { url: `/uploads/${name}` }
  }

  /** سرو فایل — نام اعتبارسنجی‌شده (بدون path traversal) */
  async read(name: string): Promise<Bun.BunFile | null> {
    if (!NAME_RE.test(name)) return null
    const f = Bun.file(`${this.dir}/${name}`)
    return (await f.exists()) ? f : null
  }

  /**
   * round-18 — حجم دیسک پوشهٔ آپلود برای /health/metrics.
   * پوشه تخت است؛ اسکن با سقف USAGE_MAX_FILES تا شمارش همیشه تمام‌شدنی
   * باشد. null = پوشه از ابتدا آماده نشده. هرگز throw نمی‌کند.
   */
  async usage(): Promise<{
    files: number
    totalBytes: number
    capped: boolean
  } | null> {
    if (this.dirError !== null) return null
    try {
      let files = 0
      let totalBytes = 0
      let capped = false
      for await (const name of new Bun.Glob('*').scan({
        cwd: this.dir,
        onlyFiles: true,
      })) {
        if (files >= USAGE_MAX_FILES) {
          capped = true
          break
        }
        files++
        totalBytes += Bun.file(`${this.dir}/${name}`).size
      }
      return { files, totalBytes, capped }
    } catch {
      // پوشه در لحظهٔ اسکن حذف/قفل شده — health عادی تصمیم می‌گیرد
      return null
    }
  }
}