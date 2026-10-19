// ═══════════════════════════════════════════════════════════════
// stage-88 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/http/routes/print.routes.ts (فایل جدید)
// روت‌های پل چاپ — تشخیص/پیکربندی/انتخاب/چاپِ چاپگرهای شبکه.
//
// مدلِ دسترسی (آینهٔ admin-settings):
//  · shared (ادمین اصلی + ادمین۲ فعال): لیستِ چاپگرها + وضعیتِ زنده،
//    تخصیصِ هر فاکتور، و ارسالِ رسید (هر دو پنلِ سفارشات این را لازم
//    دارند — مودالِ چاپ در هر دو نقش باز می‌شود).
//  · owner (فقط ادمین اصلی): افزودن/ویرایش/حذف/تست/اسکن — مدیریتِ
//    سخت‌افزار کارِ رئیس است (الگوی ناحیه‌های ارسال و درگاه‌ها).
// ═══════════════════════════════════════════════════════════════

// src/http/routes/print.routes.ts
import { Elysia, t } from 'elysia'
import type { SessionService } from '#/domain/auth/session.service'
import type { Admin2Service } from '#/domain/admin2/admin2.service'
import type { PrinterService } from '#/domain/print/print.service'
import type { AuditService } from '#/domain/audit/audit.service'
import { requireAdmin } from '#/http/hooks/require-auth'
import { requireAdmin2 } from '#/http/hooks/require-admin2'

export interface PrintRoutesDeps {
  sessions: SessionService
  admin2: Admin2Service
  print: PrinterService
  audit: AuditService
}

const widthDotsSchema = t.Union([t.Literal(576), t.Literal(384), t.Literal(420)])

export const printRoutes = (deps: PrintRoutesDeps) => {
  // ══ shared — هر دو ادمین: لیست/تخصیص/چاپ ══
  const shared = new Elysia({ prefix: '/admin/print', tags: ['Admin / Print'] })
    .use(requireAdmin2({ sessions: deps.sessions, admin2: deps.admin2 }))

    .get(
      '/printers',
      async () => ({ printers: await deps.print.list() }),
      {
        detail: {
          summary: 'Network printers + live status (DLE EOT probe)',
          description:
            'stage-88: server-side print bridge. Lists registered LAN printers (ESC/POS over TCP 9100) with fresh online/offline/paper status. Browsers cannot enumerate OS printers — the API is the source of truth.',
        },
      },
    )
    .get('/assignment', async () => deps.print.assignment(), {
      detail: {
        summary: 'Per-invoice-type printer assignment (sales/kitchen → printerId|null)',
        description: 'null means browser dialog fallback. Mirrors the payment-gateways settings pattern.',
      },
    })
    .post(
      '/assignment',
      async ({ body }) => {
        await deps.print.setAssignment({
          sales: body.sales ?? null,
          kitchen: body.kitchen ?? null,
        })
        return { success: true }
      },
      {
        body: t.Object({
          sales: t.Optional(t.Nullable(t.String({ format: 'uuid' }))),
          kitchen: t.Optional(t.Nullable(t.String({ format: 'uuid' }))),
        }),
        detail: {
          summary: 'Set per-invoice-type printer assignment',
          description:
            'Validated against the printers table — unknown ids are rejected. Removing a printer clears its assignment automatically.',
        },
      },
    )
    // ══ مسیرِ اصلیِ چاپ: بیت‌مپِ 1bpp از canvasِ مرورگر → GS v 0 روی سوکت ══
    .post(
      '/receipt',
      async ({ body }) => {
        const res = await deps.print.dispatch({
          printerId: body.printerId,
          widthPx: body.widthPx,
          heightPx: body.heightPx,
          rows: body.rows,
        })
        return { success: true, bytes: res.bytes }
      },
      {
        // بیت‌مپِ 576×4000 = ۲۸۸KB خام → base64 ≈ ۳۸۴KB؛ سقفِ ۸MB اطمینانِ کامل
        body: t.Object({
          printerId: t.String({ format: 'uuid' }),
          widthPx: t.Union([t.Literal(576), t.Literal(384), t.Literal(420)]),
          heightPx: t.Integer({ minimum: 1, maximum: 4000 }),
          rows: t.String({ minLength: 8, maxLength: 8_000_000 }),
        }),
        bodyLimit: 8 * 1024 * 1024,
        detail: {
          summary: 'Print a receipt bitmap (ESC/POS raster) to a network printer',
          description:
            'stage-88: the browser renders the Persian RTL receipt to a canvas (perfect text shaping), packs it 1-bit-per-pixel MSB-first row-major, and posts the rows here. The server frames them as fragmented GS v 0 + feed + partial cut and streams to printer:9100. Paper length == content length. Pre-flight DLE EOT: paper-end and offline are explicit errors.',
        },
      },
    )

  // ══ owner — فقط ادمین اصلی: مدیریتِ سخت‌افزار ══
  const ownerOnly = new Elysia({ prefix: '/admin/print', tags: ['Admin / Print'] })
    .use(requireAdmin(deps.sessions))

    .post(
      '/printers',
      async ({ body, user }) => {
        const printer = await deps.print.add({
          name: body.name,
          host: body.host,
          port: body.port,
          widthDots: body.widthDots,
          autoCut: body.autoCut,
        })
        await deps.audit.log({
          actorId: user.id,
          action: 'PRINTER_ADD',
          entity: 'printer',
          entityId: printer.id,
          metadata: { name: printer.name, host: printer.host, port: printer.port, widthDots: printer.widthDots },
        })
        return { printer }
      },
      {
        body: t.Object({
          name: t.String({ minLength: 1, maxLength: 60 }),
          host: t.String({ minLength: 3, maxLength: 64 }),
          port: t.Optional(t.Integer({ minimum: 1, maximum: 65535 })),
          widthDots: t.Optional(widthDotsSchema),
          autoCut: t.Optional(t.Boolean()),
        }),
        detail: {
          summary: 'Register a network printer — main admin only',
          description:
            'Duplicate (host+port) is rejected. Get the IP from the printer self-test page or POST /admin/print/discover.',
        },
      },
    )
    .patch(
      '/printers/:id',
      async ({ params, body, user }) => {
        const printer = await deps.print.update(params.id, {
          name: body.name,
          host: body.host,
          port: body.port,
          widthDots: body.widthDots,
          autoCut: body.autoCut,
        })
        await deps.audit.log({
          actorId: user.id,
          action: 'PRINTER_UPDATE',
          entity: 'printer',
          entityId: printer.id,
          metadata: { name: printer.name, host: printer.host, port: printer.port, widthDots: printer.widthDots, autoCut: printer.autoCut },
        })
        return { printer }
      },
      {
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        body: t.Object({
          name: t.Optional(t.String({ minLength: 1, maxLength: 60 })),
          host: t.Optional(t.String({ minLength: 3, maxLength: 64 })),
          port: t.Optional(t.Integer({ minimum: 1, maximum: 65535 })),
          widthDots: t.Optional(widthDotsSchema),
          autoCut: t.Optional(t.Boolean()),
        }),
        detail: { summary: 'Update printer — main admin only' },
      },
    )
    .delete(
      '/printers/:id',
      async ({ params, user }) => {
        await deps.print.remove(params.id)
        await deps.audit.log({
          actorId: user.id,
          action: 'PRINTER_REMOVE',
          entity: 'printer',
          entityId: params.id,
          metadata: {},
        })
        return { success: true }
      },
      {
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        detail: {
          summary: 'Remove printer (assignment auto-cleared) — main admin only',
        },
      },
    )
    .post(
      '/printers/:id/test',
      async ({ params, user }) => {
        const res = await deps.print.test(params.id)
        await deps.audit.log({
          actorId: user.id,
          action: 'PRINTER_TEST',
          entity: 'printer',
          entityId: params.id,
          metadata: { bytes: res.bytes },
        })
        return { success: true, bytes: res.bytes }
      },
      {
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        detail: {
          summary: 'ASCII test page over the raw socket — main admin only',
          description:
            'Server-side test (no browser): PC437 text + density pattern + cut. For a Persian test use the receipt path from the print modal (canvas raster).',
        },
      },
    )
    .post(
      '/discover',
      async ({ body, user }) => {
        const res = await deps.print.discover({ cidr: body.cidr })
        await deps.audit.log({
          actorId: user.id,
          action: 'PRINTER_DISCOVER',
          entity: 'printer',
          metadata: { scanned: res.scanned, found: res.found.length },
        })
        return res
      },
      {
        body: t.Object({
          cidr: t.Optional(t.String({ minLength: 7, maxLength: 18 })),
        }),
        timeout: 90_000,
        detail: {
          summary: 'Scan a subnet for printers (ports 9100/631) — main admin only',
          description:
            'Outbound NAT from the Docker bridge reaches the restaurant LAN. Default CIDRs come from PRINT_SCAN_CIDRS env (or the server interfaces). mDNS does not cross docker bridge — scanning + manual IP is the docker-safe path. Found hosts are NOT auto-registered — add them explicitly.',
        },
      },
    )

  return new Elysia().use(shared).use(ownerOnly)
}
