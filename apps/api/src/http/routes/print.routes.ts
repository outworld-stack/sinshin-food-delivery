// ═══════════════════════════════════════════════════════════════
// stage-88 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/http/routes/print.routes.ts (فایل جدید)
// روت‌های پل چاپ — تشخیص/پیکربندی/انتخاب/چاپِ چاپگرهای شبکه.
//
// مدلِ دسترسی (آینهٔ admin-settings):
//  · shared (ادمین اصلی + ادمین۲ فعال): لیستِ چاپگرها + وضعیتِ زنده و
//    «خواندنِ» تخصیص — مودالِ چاپ در هر دو نقش همین را لازم دارد.
//  · manage (ادمین اصلی + ادمین۲ با مجوزِ اختصاصیِ printingManage —
//    stage-89): «تغییرِ تخصیصِ سراسریِ چاپگرها» و «ارسالِ کارِ چاپ».
//    بازبینیِ استیج-۸۸: این دو کنشِ جهانی‌اند، نه عملیاتِ روزمرهٔ سفارش —
//    پیش‌فرض برای ادمین۲ خاموش و فقط با مجوزِ صریحِ ادمین اصلی روشن می‌شود.
//  · owner (فقط ادمین اصلی): افزودن/ویرایش/حذف/تست/اسکن/گزارشِ شبکه —
//    مدیریتِ سخت‌افزار کارِ رئیس است (الگوی ناحیه‌های ارسال و درگاه‌ها).
// ═══════════════════════════════════════════════════════════════

// src/http/routes/print.routes.ts
import { Elysia, t } from 'elysia'
import type { SessionService } from '#/domain/auth/session.service'
import type { Admin2Service } from '#/domain/admin2/admin2.service'
import type { PrinterService } from '#/domain/print/print.service'
import type { AuditService } from '#/domain/audit/audit.service'
import { requireAdmin } from '#/http/hooks/require-auth'
import { requireAdmin2, requireAdmin2Permission } from '#/http/hooks/require-admin2'

export interface PrintRoutesDeps {
  sessions: SessionService
  admin2: Admin2Service
  print: PrinterService
  audit: AuditService
}

const widthDotsSchema = t.Union([t.Literal(576), t.Literal(384), t.Literal(420)])

export const printRoutes = (deps: PrintRoutesDeps) => {
  // ══ shared — هر دو ادمین: خواندنِ لیست/وضعیت/تخصیص ══
  const shared = new Elysia({ prefix: '/admin/print', tags: ['Admin / Print'] })
    .use(requireAdmin2({ sessions: deps.sessions, admin2: deps.admin2 }))

    .get(
      '/printers',
      async () => ({ printers: await deps.print.list() }),
      {
        detail: {
          summary: 'Network printers + live status (DLE EOT probe)',
          description:
            'stage-88: server-side print bridge. Lists registered LAN printers (ESC/POS over TCP 9100) with fresh online/offline/paper status. Browsers cannot enumerate OS printers — the API is the source of truth. stage-89: status combines TCP reachability AND the device-reported offline bit.',
        },
      },
    )
    .get('/assignment', async () => deps.print.assignment(), {
      detail: {
        summary: 'Per-invoice-type printer assignment (sales/kitchen → printerId|null)',
        description: 'null means browser dialog fallback. Mirrors the payment-gateways settings pattern.',
      },
    })

  // ══ manage — ادمین اصلی + ادمین۲ با مجوزِ printingManage (stage-89) ══
  const manage = new Elysia({ prefix: '/admin/print', tags: ['Admin / Print'] })
    .use(
      requireAdmin2Permission(
        { sessions: deps.sessions, admin2: deps.admin2 },
        'printingManage',
      ),
    )

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
          summary: 'Set per-invoice-type printer assignment (printingManage permission)',
          description:
            'stage-89: this is a GLOBAL station-wide setting — level-2 admins need the dedicated printingManage permission (default off). Validated against the printers table — unknown ids are rejected. Removing a printer clears its assignment automatically.',
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
            'stage-88: the browser renders the Persian RTL receipt to a canvas (perfect text shaping), packs it 1-bit-per-pixel MSB-first row-major, and posts the rows here. The server frames them as fragmented GS v 0 + feed + partial cut and streams to printer:9100. Paper length == content length. Pre-flight DLE EOT: paper-end and device-reported offline are explicit errors. stage-89: destination IP is policy-checked (RFC1918 only, DNS-resolved and pinned) and requires the printingManage permission.',
        },
      },
    )

  // ══ owner — فقط ادمین اصلی: مدیریتِ سخت‌افزار + گزارشِ شبکه ══
  const ownerOnly = new Elysia({ prefix: '/admin/print', tags: ['Admin / Print'] })
    .use(requireAdmin(deps.sessions))

    .get(
      '/network',
      async () => deps.print.networkReport(),
      {
        detail: {
          summary: 'Network topology report — main admin only',
          description:
            'stage-89 (P1): honest view of the real network path — server interfaces with their true netmasks, each printer IP classified against them, deployment mode (lan/remote/empty) and Persian guidance. A VPS outside the restaurant LAN cannot reach private printer IPs; this report says so explicitly instead of failing silently.',
        },
      },
    )
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
            'stage-89: host must resolve to a private LAN address (10/172.16-31/192.168) — public, link-local (cloud metadata), CGNAT and loopback targets are rejected; port must be 9100 (the only implemented transport: raw ESC/POS). Duplicate (host+port) is rejected. Get the IP from the printer self-test page or POST /admin/print/discover.',
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
        detail: { summary: 'Update printer — main admin only (same destination policy as add)' },
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
            'Server-side test (no browser): PC437 text + density pattern + cut. stage-89: refuses explicitly when the device reports itself offline or out of paper. For a Persian test use the receipt path from the print modal (canvas raster).',
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
          summary: 'Scan a subnet for printers (port 9100 only) — main admin only',
          description:
            'Only port 9100 is probed (raw ESC/POS; IPP is not supported). CIDRs must be private restaurant networks; loopback requires an explicit development flag. Defaults come from PRINT_SCAN_CIDRS or up to four RFC1918 server interfaces; networks broader than /23 are narrowed to the interface address’s /24. Each range is limited to 512 hosts and all ranges together to 2048. Concurrent equivalent scans share results and all scans share a 64-socket limit. The print center scans automatically and lists discoveries in both default-printer dropdowns. Selecting a discovered device registers it; scanning alone does not register devices or change defaults. The API must have a network route to the restaurant printers.',
        },
      },
    )

  return new Elysia().use(shared).use(manage).use(ownerOnly)
}
