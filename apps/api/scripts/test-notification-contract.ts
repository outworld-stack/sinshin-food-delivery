// src/../scripts/test-notification-contract.ts
/**
 * تست عمیق قرارداد صندوق اعلان (stage-77) — روی PG واقعی.
 *
 *   DATABASE_URL='postgres://…' bun scripts/test-notification-contract.ts   (از apps/api)
 *
 * سه قراردادِ stage-77:
 *  NC1) broadcast: ردیف صندوق برای کاربرانِ عادی (نه ادمین/بن‌شده) +
 *       «یک» publish روی کانال عمومی notify:all (زنده‌سازی صندوقِ باز — N2؛
 *       قبلاً پخش هیچ SSE‌ای نداشت و صفحه‌ی اعلان تا focus/navigation کور بود)
 *  NC2) notifyUser: publish روی کانال شخصی notify:{userId} (رفتار موجود)
 *  NC3) markAllRead فقط پنجره‌ی TTL (۷ روز) را علامت می‌زند (N5) —
 *       «همه را خواندم» دیگر ردیف‌های نامرئیِ (>۷ روز) را نمی‌شمارد؛
 *       هم‌راستا با list/unreadCount
 *  NC4) unreadCount/list همان پنجره — سازگاری سه‌گانه بعد از markAllRead
 */
import { SQL } from 'bun'
import { eq } from 'drizzle-orm'

interface UrlParts {
  admin: string
  target: string
}

function parseUrl(): UrlParts {
  const fromEnv = process.env.DATABASE_URL
  const raw =
    fromEnv && fromEnv.startsWith('postgres')
      ? fromEnv
      : 'postgres://sinshin:sinshin_local@127.0.0.1:5432/sinshin'
  const admin = new URL(raw)
  admin.pathname = '/postgres'
  return { admin: admin.toString(), target: raw }
}

const { admin } = parseUrl()
const scratch = `sinshin_e2e_notif_${process.pid}_${Math.random().toString(36).slice(2, 8)}`

let pass = 0
let fail = 0
function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

async function main(): Promise<void> {
  // ── دیتابیس موقتی + زنجیره‌ی کامل مایگریشن ──
  const boot = new SQL(admin, { max: 1 })
  await boot.unsafe(`drop database if exists "${scratch}" with (force)`)
  await boot.unsafe(`create database "${scratch}"`)
  await boot.close({ timeout: 5 })
  const url = new URL(parseUrl().target)
  url.pathname = `/${scratch}`
  console.log(`\n══ دیتابیس موقتی: ${scratch} ══`)

  const proc = Bun.spawn(['bun', 'src/infra/db/migrate.ts'], {
    cwd: import.meta.dir + '/..',
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const out = await new Response(proc.stdout).text()
  const errTxt = await new Response(proc.stderr).text()
  if ((await proc.exited) !== 0) {
    console.log(out + errTxt)
    throw new Error('migrate ناموفق بود')
  }

  // ── سرویس واقعی + هابِ جاسوس (publish ها را ضبط می‌کند) ──
  const { Database } = await import('../src/infra/db/client')
  const { AppConfig } = await import('../src/infra/config/env')
  const { NotificationService } = await import('../src/domain/notification/notification.service')
  const { users, notifications } = await import('../src/infra/db/schema')

  const config = new AppConfig({
    NODE_ENV: 'development',
    DATABASE_URL: url.toString(),
    GATEWAY_MODE: 'direct',
    JWT_SECRET: 'x'.repeat(40),
    SITE_URL: 'https://sinshin.example',
  })
  const database = new Database(url.toString(), { max: 4 })
  const db = database.db

  const publishes: Array<{ channel: string; event: string }> = []
  const hub = {
    publish: (channel: string, payload: { event: string }) => {
      publishes.push({ channel, event: payload.event })
    },
    subscribe: () => () => undefined,
  }
  const notif = new NotificationService({ db, config, hub: hub as never })

  // ── داده: ۳ کاربر عادی + ۱ ادمین + ۱ بن‌شده ──
  const mkUser = async (phone: string, extra: Partial<typeof users.$inferInsert> = {}) =>
    (await db.insert(users).values({ phone, role: 'user', ...extra }).returning())[0]!
  const u1 = await mkUser('09150001001')
  await mkUser('09150001002')
  await mkUser('09150001003')
  await db.insert(users).values({ phone: '09150001009', role: 'admin' })
  await mkUser('09150001010', { bannedAt: new Date() })

  console.log('\n══ NC1) broadcast — ردیف‌ها + notify:all ══\n')
  publishes.length = 0
  const br = await notif.broadcast(
    { type: 'broadcast', title: 'اطلاعیه تست', body: 'متن اطلاعیه', url: '/products' },
    { role: 'admin2', name: 'تستر' },
  )
  ok('NC1: targeted = ۳ کاربرِ عادی (ادمین/بن‌شده بیرون)', br.targeted === 3, `got=${br.targeted}`)
  const rowsU1 = await db.select().from(notifications).where(eq(notifications.userId, u1.id))
  ok('NC1: ردیف صندوق برای کاربر عادی ساخته شد', rowsU1.length === 1 && rowsU1[0]!.title === 'اطلاعیه تست')
  const allNotifs = await db.select().from(notifications)
  ok('NC1: کل ردیف‌ها = ۳ (نه ۵)', allNotifs.length === 3, `got=${allNotifs.length}`)
  const allPubs = publishes.filter((p) => p.channel === 'notify:all')
  ok(
    'NC1: «دقیقاً یک» publish روی notify:all (رویداد notification)',
    allPubs.length === 1 && allPubs[0]!.event === 'notification',
    JSON.stringify(publishes),
  )
  ok('NC1: publish شخصی برای broadcast زده نشد', !publishes.some((p) => p.channel === `notify:${u1.id}`))

  console.log('\n══ NC2) notifyUser — کانال شخصی ══\n')
  publishes.length = 0
  const one = await notif.notifyUser(u1.id, {
    type: 'coupon',
    title: 'کوپن تست',
    body: 'بدنه',
    url: '/checkout',
  })
  ok('NC2: notifyUser ردیف ساخت (id)', one.id !== null)
  ok(
    'NC2: publish روی notify:{userId} با رویداد notification',
    publishes.some((p) => p.channel === `notify:${u1.id}` && p.event === 'notification'),
    JSON.stringify(publishes),
  )
  ok('NC2: notify:all برای اعلانِ تک‌کاربر زده نشد', !publishes.some((p) => p.channel === 'notify:all'))

  console.log('\n══ NC3) markAllRead — فقط پنجره‌ی TTL ══\n')
  // دو ردیف تازه (خوانده‌نشده) + یک ردیف ۸ روزه (خوانده‌نشده، بیرون از TTL)
  await notif.notifyUser(u1.id, { type: 'system', title: 'تازه ۱', body: 'b' })
  await notif.notifyUser(u1.id, { type: 'system', title: 'تازه ۲', body: 'b' })
  const old = await notif.notifyUser(u1.id, { type: 'system', title: 'کهنه', body: 'b' })
  await db.execute(
    // backdate — مستقیم SQL تا defaultNow دور زده شود
    (await import('drizzle-orm')).sql`update notifications set created_at = now() - interval '8 days' where id = ${old.id}`,
  )

  const freshUnread = await notif.unreadCount(u1.id)
  ok('NC3: unreadCount فقط ردیف‌های ۷ روز اخیر (۴ تازه؛ کهنه بیرون)', freshUnread === 4, `got=${freshUnread}`)

  const marked = await notif.markAllRead(u1.id)
  ok('NC3: markAllRead فقط ۴ ردیفِ مرئی را علامت زد (کهنه >۷ روز بیرون)', marked === 4, `got=${marked}`)

  const afterUnread = await notif.unreadCount(u1.id)
  ok('NC3: بج بعد از «همه خوانده» = صفر', afterUnread === 0, `got=${afterUnread}`)

  const oldRow = (await db.select().from(notifications).where(eq(notifications.id, old.id!)))[0]!
  ok('NC3: ردیفِ ۸ روزه هنوز خوانده‌نشده است (نامرئی — علامت‌زدنش بی‌معنا)', oldRow.readAt === null)

  console.log('\n══ NC4) list — همان پنجره ══\n')
  const list = await notif.list(u1.id, 30)
  ok('NC4: لیست ردیفِ کهنه را برنمی‌گرداند', !list.some((n) => n.title === 'کهنه'), `count=${list.length}`)
  ok('NC4: لیست ۴ ردیفِ مرئی دارد (broadcast+coupon+۲ تازه)', list.length === 4, `count=${list.length}`)

  // ── پاک‌سازی ──
  await database.close()
  const cleaner = new SQL(admin, { max: 1 })
  await cleaner.unsafe(`drop database if exists "${scratch}" with (force)`)
  await cleaner.close({ timeout: 5 })

  console.log(`\n══ نتیجه: ${pass} ✓ / ${fail} ✗ ══\n`)
  if (fail > 0) process.exit(1)
}

void main()
