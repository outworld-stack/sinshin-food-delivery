// ═══════════════════════════════════════════════════════════════
// stage-88 — sinshin-food-delivery
// مسیر مقصد: apps/api/src/infra/db/schema/print.ts (فایل جدید)
// رجیستری چاپگرهای شبکهٔ رستوران — «پل چاپِ» سمت سرور.
//
// چرا جدول جدا (نه settings JSON)؟ چاپگر یک «دستگاه» است نه یک تنظیم:
//   · (host, port) یکتاست — افزودنِ تکراری رد می‌شود (مثل شعاعِ ناحیهٔ ارسال)
//   · وضعیت آخرین probe (آنلاین/آفلاین/کاغذ) روی خودِ ردیف می‌نشیند تا
//     مودال بدون اسکنِ دوباره نشانش بدهد؛ عوض‌شدنش «تنظیم» نیست.
//   · حذفِ چاپگر باید تخصیصِ فاکتورها (کلید settings) را پاک کند —
//     جدول یعنی FK-مانندِ قابلِ پیگیری.
//
// فقط پروتکل RAW/9100 (JetDirect) — استانداردِ عملیِ POS: هر چاپگر فیشِ
// شبکهٔ ESC/POS سازگار (Xprinter/Posiflex/Epson TM و…) پورت 9100 را
// باز می‌کند و بایت‌ها را همان‌جا چاپ می‌کند. بدون هیچ ابزار شخص ثالث.
// ═══════════════════════════════════════════════════════════════

//src/infra/db/schema/print.ts
import {
  boolean,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

/** عرض‌های مجاز (dots) — ۸۰mm=۵۷۶ · ۵۸mm کلون=۳۸۴ · اپسون ۵۸mm=۴۲۰ */
export const PRINTER_WIDTH_DOTS = [576, 384, 420] as const
export type PrinterWidthDots = (typeof PRINTER_WIDTH_DOTS)[number]

export const printers = pgTable(
  'printers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** نام نمایشی — «چاپگر آشپزخانه» و… */
    name: varchar('name', { length: 60 }).notNull(),
    /** IP یا hostname در شبکهٔ محلی رستوران */
    host: varchar('host', { length: 64 }).notNull(),
    /** پورت خام TCP — پیش‌فرض 9100 (JetDirect/RAW) */
    port: integer('port').notNull().default(9100),
    /** عرض کاغذ در dot سرِ چاپ (576=80mm, 384=58mm, 420=Epson 58) */
    widthDots: integer('width_dots').notNull().default(576),
    /** برش خودکار در پایان رسید (GS V) — خاموش برای چاپگرهای بدون برش */
    autoCut: boolean('auto_cut').notNull().default(true),
    /** آخرین probe: online | offline | unknown */
    lastStatus: varchar('last_status', { length: 16 }).notNull().default('unknown'),
    /** جزئیات وضعیت — «کاغذ تمام»، «بدون پاسخ وضعیت» و… */
    lastStatusDetail: varchar('last_status_detail', { length: 140 }),
    lastStatusAt: timestamp('last_status_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // یک دستگاه = یک ردیف؛ افزودنِ تکراریِ همان IP:پورت خطای صریح می‌دهد
    uniqueIndex('printers_host_port_key').on(t.host, t.port),
    index('printers_status_idx').on(t.lastStatus),
  ],
)
