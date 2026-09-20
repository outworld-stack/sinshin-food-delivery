//src/infra/uploads/upload.service.ts
import { Err } from '#/domain/shared/errors'

const EXT_BY_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/webp': 'webp',
}
const MAX_BYTES = 2 * 1024 * 1024
const NAME_RE = /^[a-f0-9-]{36}\.(png|webp)$/

export class UploadService {
  private readonly ready: Promise<void>

  constructor(private readonly dir: string) {
    // Bun-native — بدون node:fs؛ یک‌بار در عمر سرویس
    this.ready = Bun.$`mkdir -p ${this.dir}`.then(() => {})
  }

  async save(file: File): Promise<{ url: string }> {
    const ext = EXT_BY_TYPE[file.type]
    if (!ext) throw Err.validation('فقط PNG یا WebP مجاز است.')
    if (file.size > MAX_BYTES) throw Err.validation('حداکثر حجم ۲ مگابایت است.')
    await this.ready

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
}