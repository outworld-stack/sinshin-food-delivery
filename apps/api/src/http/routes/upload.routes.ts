//src/http/routes/upload.routes.ts
import { Elysia, t } from 'elysia'

import type { SessionService } from '#/domain/auth/session.service'
import type { UploadService } from '#/infra/uploads/upload.service'
import { Err } from '#/domain/shared/errors'
import { requireAdmin } from '#/http/hooks/require-auth'

export interface UploadRoutesDeps {
  sessions: SessionService
  uploads: UploadService
}

export const uploadRoutes = (deps: UploadRoutesDeps) => {
  // آپلود — فقط ادمین اصلی (permission ادمین۲ در فاز ۵)
  // قیود type/maxSize عمداً در سرویس اعمال می‌شود (پیام فارسی + کنترل کامل)؛
  // t.File با قیود در elysia 1.3 روی multipart خطای 422 می‌داد.
  const adminUpload = new Elysia()
    .use(requireAdmin(deps.sessions))
    .post(
      '/api/uploads',
      ({ body }) => deps.uploads.save(body.file),
      {
        body: t.Object({ file: t.File() }),
        detail: { summary: 'Upload image (admin, PNG/WebP, max 2MB — enforced in service)' },
      },
    )

  // سرو استاتیک — عمومی، cache جاودان (نام فایل uuid است)
  const staticServe = new Elysia().get(
    '/uploads/:name',
    async ({ params, set }) => {
      const f = await deps.uploads.read(params.name)
      if (!f) throw Err.notFound('فایل پیدا نشد.')
      set.headers['content-type'] = params.name.endsWith('.png') ? 'image/png' : 'image/webp'
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