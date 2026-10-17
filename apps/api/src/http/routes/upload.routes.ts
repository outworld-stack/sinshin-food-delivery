//src/http/routes/upload.routes.ts
// ═══════════════════════════════════════════════════════════════
// stage-84 (مواردِ پنجره‌ی بعدی) — پایان «۴۰۳ ادمین۲ در آپلود»:
//  FileUploader مصرف‌کننده‌ی فرمِ محصول (productsWrite) و صفحه‌سازِ
//  مقالات (articlesWrite) است؛ ادمین۲ِ دارایِ هر یک از این دو مجوزِ نوشتن
//  حالا آپلود می‌کند؛ ادمین اصلی مثلِ همیشه همیشه. ادمین۲ِ فقط-خواندن → 403
//  با پیامِ صریحِ فارسی. نیازی به مجوزِ جدا نبود (مجوزِ نوشتنِ همان بخشی
//  که تصویرِ آن را آپلود می‌کند = کمترینِ امتیازِ لازم).
// ═══════════════════════════════════════════════════════════════
import { Elysia, t } from 'elysia'

import type { SessionService } from '#/domain/auth/session.service'
import type { Admin2Service } from '#/domain/admin2/admin2.service'
import type { UploadService } from '#/infra/uploads/upload.service'
import { Err } from '#/domain/shared/errors'
import { requireAdmin2 } from '#/http/hooks/require-admin2'

export interface UploadRoutesDeps {
  sessions: SessionService
  admin2: Admin2Service
  uploads: UploadService
}

export const uploadRoutes = (deps: UploadRoutesDeps) => {
  // آپلود — ادمین اصلی + ادمین۲ با مجوزِ نوشتنِ محصولات یا مقالات
  // قیود type/maxSize عمداً در سرویس اعمال می‌شود (پیام فارسی + کنترل کامل)؛
  // t.File با قیود در elysia 1.3 روی multipart خطای 422 می‌داد.
  const adminUpload = new Elysia()
    .use(requireAdmin2({ sessions: deps.sessions, admin2: deps.admin2 }))
    .post(
      '/api/uploads',
      ({ admin2, body }) => {
        // admin2 === null → ادمین اصلی (همیشه مجاز)
        if (admin2 && !admin2.productsWrite && !admin2.articlesWrite) {
          throw Err.forbidden(
            'آپلود تصویر برای ادمین سطح ۲ نیازمند مجوز نوشتن محصولات یا مقالات است.',
          )
        }
        return deps.uploads.save(body.file)
      },
      {
        body: t.Object({ file: t.File() }),
        detail: {
          summary:
            'Upload image (main admin or admin2 with productsWrite/articlesWrite, PNG/WebP, max 2MB — enforced in service)',
        },
      },
    )

  // سرو استاتیک — عمومی، کشِ جاودان (نام فایل uuid است)
  const staticServe = new Elysia().get(
    '/uploads/:name',
    async ({ params, set }) => {
      const f = await deps.uploads.read(params.name)
      if (!f) throw Err.notFound('فایل پیدا نشد.')
      set.headers['content-type'] = params.name.endsWith('.png') ? 'image/png' : 'image/webp'
      // رارد M14 — nosniff: عمق دفاعی کنار magic-check سمت ذخیره
      set.headers['x-content-type-options'] = 'nosniff'
      set.headers['cache-control'] = 'public, max-age=31536000, immutable'
      return f
    },
    {
      params: t.Object({ name: t.String({ maxLength: 60 }) }),
      detail: { summary: 'Serve uploaded file (public, immutable cache)' },
    },
  )

  return new Elysia({ tags: ['Uploads'] }).use(adminUpload).use(staticServe)
}
