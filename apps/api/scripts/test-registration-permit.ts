//src/../scripts/test-registration-permit.ts
/**
 * تست E2E مجوز ثبت‌نام ویژه (stage-79) — PostgreSQL واقعی.
 *
 *   bun scripts/test-registration-permit.ts   (یا: bun run db:test:permit)
 *
 * روی «دیتابیس موقتیِ» همان سرور (sinshin_e2e_…) — به دیتابیس اصلی دست
 * نمی‌زند. سرویس‌های واقعی (AuthService + DeviceService +
 * RegistrationPermitService + SessionService) روی درایور خودِ اپ؛ فقط
 * OTP و admin2 استاب می‌شوند (موضوع تست، منطقِ دستگاه/مجوز است نه پیامک).
 *
 *  گروه A — رگرسیونِ «بدون مجوز»: رفتارِ پیش از stage-79 بایت‌به‌بایت
 *  گروه B — جریانِ کاملِ مجوز: مسدود/سوخته → ثبت‌نام → سوختنِ سخت
 *  گروه C — سرویس مجوز: صدور/تازه‌سازی/لغو/اتمی‌بودن/انقضا
 */
import { SQL } from 'bun'
import { eq, sql } from 'drizzle-orm'

interface UrlParts {
  admin: string
  target: string
}

function parseUrl(): UrlParts {
  const raw = process.env.DATABASE_URL ?? 'postgres://sinshin:sinshin_local@127.0.0.1:5432/sinshin'
  const admin = new URL(raw)
  admin.pathname = '/postgres'
  return { admin: admin.toString(), target: raw }
}

const { admin } = parseUrl()

const scratch = `sinshin_e2e_permit_${process.pid}_${Math.random().toString(36).slice(2, 8)}`

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
  // ── دیتابیس موقتی + زنجیره‌ی کامل ──
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
  const code = await proc.exited
  if (code !== 0) {
    console.log(out + errTxt)
    throw new Error('migrate ناموفق بود')
  }
  ok('P0: زنجیره‌ی کامل + registration_permits اعمال شد', /migrations applied/.test(out))

  // ── سرویس‌های واقعی (OTP و admin2 استاب — خارج از موضوع تست) ──
  const { Database } = await import('../src/infra/db/client')
  const { AppConfig } = await import('../src/infra/config/env')
  const { DeviceService } = await import('../src/domain/device/device.service')
  const { RegistrationPermitService } = await import('../src/domain/auth/registration-permit.service')
  const { AuthService } = await import('../src/domain/auth/auth.service')
  const { SessionService } = await import('../src/domain/auth/session.service')
  const { TokenService } = await import('../src/domain/auth/token.service')
  const { AppError } = await import('../src/domain/shared/errors')
  const { users } = await import('../src/infra/db/schema')

  const config = new AppConfig({
    NODE_ENV: 'development',
    DATABASE_URL: url.toString(),
    JWT_SECRET: 'test-jwt-secret-for-permit-e2e-not-prod',
    DEVICE_ENFORCEMENT: 'true',
    DEVICE_MAX_PHONES_PER_DEVICE: '1',
    DEVICE_REFERRAL_BLOCK_AFTER: '3',
    DEVICE_LINK_THRESHOLD: '0.7',
    DEVICE_SIMILARITY_WINDOW_DAYS: '7',
    MAX_DEVICES_PER_USER: '5',
  })
  // max: 2 — داخل tx ثبت‌نام، generateUniqueReferralCode از pool بیرونِ tx
  // کوئری می‌زند (رفتارِ موجود)؛ با max:1 استخر قفل می‌شود و ایونت‌لوپ
  // خالی می‌شود (خروجِ خاموشِ bun) — مشکلِ محیطِ تست، نه کد.
  const database = new Database(url.toString(), { max: 2 })
  const db = database.db
  const devices = new DeviceService({ db, config })
  const permits = new RegistrationPermitService({ db })
  const sessions = new SessionService({ db, config, tokens: new TokenService(config) })

  const noopOtp = {
    verify: async () => {},
    send: async () => ({ cooldownSeconds: 60 }),
  } as unknown as ConstructorParameters<typeof AuthService>[0]['otp']
  const noopAdmin2 = {
    assertLoginAllowed: async () => {},
    onLogin: async () => ({ queueCount: 0 }),
  } as unknown as ConstructorParameters<typeof AuthService>[0]['admin2']

  const auth = new AuthService({
    db,
    config,
    otp: noopOtp,
    sessions,
    devices,
    admin2: noopAdmin2,
    permits,
  })

  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'

  // stage-81 — هش‌های «یکتا per-client»: تا ۷۹ همه‌ی clientها هش‌های ثابتِ
  // یکسان داشتند (fixture بی‌ضرر)؛ stage-80 وراثتِ مسدودی (cluster-block-inherit)
  // به‌درستی دستگاهِ تازه‌ای را که هش‌هایش با دستگاهِ «مسدود» بایت‌یکسان
  // باشد همان فراریِ storage-پاک می‌گیرد — پس «دستگاه تازه» در تست باید
  // هش‌های یکتا داشته باشد (همان الگوی test-device-policy). ثبت‌نام‌های
  // repeat روی یک clientId همچنان همان سیگنال‌ها را می‌گیرند (تکرارپذیر).
  const deviceHash = (clientId: string, salt: string): string =>
    new Bun.CryptoHasher('sha256').update(`${clientId}:${salt}`).digest('hex')

  const signals = (clientId?: string | null) => {
    const id = clientId ?? 'anon'
    return {
      clientId: clientId ?? null,
      canvasHash: deviceHash(id, 'canvas'),
      webglHash: deviceHash(id, 'webgl'),
      audioHash: deviceHash(id, 'audio'),
      fontsHash: deviceHash(id, 'fonts'),
      screen: '390x844x24@3',
      platform: 'iPhone',
      timezone: 'Asia/Tehran',
      language: 'fa-IR',
      hardwareConcurrency: 6,
      deviceMemory: 4,
      touch: true,
      networkType: '4g',
      userAgent: UA,
    }
  }

  /** خطای AppError را با کد برمی‌گرداند (یا '__none__') */
  const login = async (phone: string, clientId: string | null, opts?: { terms?: boolean }) => {
    try {
      const r = await auth.loginWithOtp(phone, '123456', signals(clientId), '127.0.0.1', {
        termsAccepted: opts?.terms ?? true,
        termsVersion: 'test',
      })
      return { code: '__ok__', result: r }
    } catch (e) {
      if (e instanceof AppError) return { code: e.code, message: e.message, result: null }
      return { code: '__throw__', message: String(e), result: null }
    }
  }

  const PHONE_A = '09150000001'
  const PHONE_B = '09150000002'
  const PHONE_C = '09150000003'
  const PHONE_D = '09150000004'
  const PHONE_E = '09150000005'
  const PHONE_F = '09150000006'
  const PHONE_G = '09150000007'

  // ادمینِ آزمایشی — FK صدور مجوز (users.id)
  const [adminUser] = await db
    .insert(users)
    .values({ phone: '09120000000', role: 'admin', referralCode: 'SIN-ADMIN', termsAcceptedAt: new Date() })
    .returning()
  const adminId = adminUser!.id

  try {
    // ═══════════ گروه A — بدون مجوز: رفتارِ پیش از ۷۹ ═══════════
    console.log('\n══ گروه A — رگرسیون بدون مجوز ══')

    const a1 = await login(PHONE_A, 'client-A')
    ok(
      'A1: ثبت‌نام عادی از دستگاه تازه موفق + سشن صادر',
      a1.code === '__ok__' && a1.result?.isNewUser === true,
      `code=${a1.code}`,
    )
    const devA = a1.result?.device?.id
    const rowA = devA ? await db.query.devices.findFirst({ where: eq(sql`id`, sql`${devA}`) }) : null
    ok(
      'A1: مالک claim شد، دستگاه مسدود نیست (همان سیاست قبل)',
      rowA?.registeredOwnerPhone === PHONE_A && rowA?.isBlocked === false,
    )

    const a2 = await login(PHONE_B, 'client-A')
    ok(
      'A2: شماره‌ی دوم از همان دستگاه → DEVICE_PHONE_LIMIT (سوختنِ عادی)',
      a2.code === 'DEVICE_PHONE_LIMIT',
      `code=${a2.code}`,
    )

    // مسدودسازی دستی توسط ادمین (ابزار موجود)
    if (devA) await devices.setBlocked(devA, true, 'admin', adminUser!.phone)
    const a3 = await login(PHONE_C, 'client-A')
    ok(
      'A3: دستگاهِ مسدود + شماره‌ی تازه بدون مجوز → FORBIDDEN',
      a3.code === 'FORBIDDEN',
      `code=${a3.code}`,
    )
    const a4 = await login(PHONE_A, 'client-A')
    ok(
      'A4: دستگاهِ مسدود + کاربرِ موجود (ورود) → FORBIDDEN — مجوز هیچ‌وقت ورود را باز نمی‌کند',
      a4.code === 'FORBIDDEN',
      `code=${a4.code}`,
    )

    // ═══════════ گروه B — جریانِ کاملِ مجوز ═══════════
    console.log('\n══ گروه B — مجوز: ثبت‌نام از دستگاه مسدود/سوخته → سوختن ══')

    const b1 = await permits.issue({ rawPhone: PHONE_C, note: 'مشتری حضوری — تست', ttlHours: 24, adminId })
    ok(
      'B1: صدور مجوز → pending با انقضای ۲۴ ساعته',
      b1.status === 'pending' && b1.note === 'مشتری حضوری — تست',
    )
    const peekC = await permits.peekActivePermit(PHONE_C)
    ok('B1: peek مجوزِ فعال را می‌بیند', peekC?.id === b1.id)

    const b3 = await login(PHONE_C, 'client-A')
    const userC = await db.query.users.findFirst({ where: eq(users.phone, PHONE_C) })
    const rowAfter = devA ? await db.query.devices.findFirst({ where: eq(sql`id`, sql`${devA}`) }) : null
    const permitAfter = await db.query.registrationPermits.findFirst({
      where: eq(sql`id`, sql`${b1.id}`),
    })
    ok(
      'B3: ثبت‌نام از دستگاهِ مسدود با مجوز → کاربر ساخته شد',
      Boolean(userC) && b3.code === 'FORBIDDEN',
      `code=${b3.code}`,
    )
    ok(
      'B3: سشن صادر نشد (همان قاعده‌ی طلاییِ auto-block) + پیامِ متمایزِ مجوز',
      b3.code === 'FORBIDDEN' && (b3.message ?? '').includes('مجوز'),
      `msg=${b3.message}`,
    )
    ok(
      'B3: دستگاه مسدود ماند (PERMIT_BURN) و دلیلِ اصلیِ ادمین دست‌نخورده',
      rowAfter?.isBlocked === true && rowAfter?.blockedReason === 'admin',
      `reason=${rowAfter?.blockedReason}`,
    )
    ok(
      'B3: مالک دستگاه بازنویسی شد به شماره‌ی مجوزدار',
      rowAfter?.registeredOwnerPhone === PHONE_C,
      `owner=${rowAfter?.registeredOwnerPhone}`,
    )
    ok(
      'B3: مجوز اتمیک مصرف شد (used + usedDeviceId ثبت)',
      permitAfter?.status === 'used' && permitAfter?.usedDeviceId === devA,
      `status=${permitAfter?.status} dev=${permitAfter?.usedDeviceId}`,
    )
    ok(
      'B3: رویدادهای PERMIT_BYPASS و PERMIT_BURN روی دستگاه ثبت شدند',
      Boolean(
        await db.query.deviceEvents.findFirst({
          where: eq(sql`device_id`, sql`${devA}`) && eq(sql`event`, sql`'PERMIT_BYPASS'`),
        }),
      ) &&
        Boolean(
          await db.query.deviceEvents.findFirst({
            where: eq(sql`device_id`, sql`${devA}`) && eq(sql`event`, sql`'PERMIT_BURN'`),
          }),
        ),
    )

    ok('B4: مجوزِ مصرف‌شده دیگر فعال نیست', (await permits.peekActivePermit(PHONE_C)) === null)

    // B5 — مجوزِ دوم روی همان دستگاهِ مسدود (بلاکِ باقی‌مانده، دوباره)
    const b5p = await permits.issue({ rawPhone: PHONE_D, adminId })
    const b5 = await login(PHONE_D, 'client-A')
    const rowAfterD = devA ? await db.query.devices.findFirst({ where: eq(sql`id`, sql`${devA}`) }) : null
    ok(
      'B5: مجوزِ دوم روی همان دستگاهِ بسته → ثبت‌نام باز هم ممکن + بازنویسی مالک',
      b5.code === 'FORBIDDEN' && rowAfterD?.registeredOwnerPhone === PHONE_D,
      `code=${b5.code} owner=${rowAfterD?.registeredOwnerPhone}`,
    )
    const b5permit = await db.query.registrationPermits.findFirst({
      where: eq(sql`id`, sql`${b5p.id}`),
    })
    ok('B5: مجوزِ دوم هم اتمیک مصرف شد', b5permit?.status === 'used')

    // B6 — دستگاهِ «سوخته‌یِ نرم» (owner بدون isBlocked): مجوز → سوختنِ سخت
    const a6 = await login(PHONE_E, 'client-E') // دستگاه تازه، ثبت‌نام عادی
    ok('B6: پیش‌نیاز — ثبت‌نام عادی روی دستگاه تازه', a6.code === '__ok__')
    const devE = a6.result?.device?.id
    if (devE) {
      // شبیه‌سازیِ سوختنِ نرم: دستگاهِ owner دار که مسدود نیست (ادمین رفع کرده)
      // → مجوزِ شماره‌ی F باید ثبت‌نام بگذراند و دستگاه را «سخت» ببندد
      const b6p = await permits.issue({ rawPhone: PHONE_F, adminId })
      const b6 = await login(PHONE_F, 'client-E')
      const rowE = await db.query.devices.findFirst({ where: eq(sql`id`, sql`${devE}`) })
      const b6permit = await db.query.registrationPermits.findFirst({
        where: eq(sql`id`, sql`${b6p.id}`),
      })
      ok(
        'B6: دستگاهِ سوخته‌ی نرم + مجوز → ثبت‌نام گذشت و دستگاه «سخت» بسته شد',
        rowE?.isBlocked === true && rowE?.blockedReason === 'permit-burn' && b6.code === 'FORBIDDEN',
        `blocked=${rowE?.isBlocked} reason=${rowE?.blockedReason} code=${b6.code}`,
      )
      ok(
        'B6: سشنِ مسیرِ مجوز صادر نشد (پیامِ مجوز)',
        b6.code === 'FORBIDDEN' && (b6.message ?? '').includes('مجوز'),
      )
      ok('B6: مالک بازنویسی شد به شماره‌ی مجوزدار', rowE?.registeredOwnerPhone === PHONE_F)
      ok('B6: مجوز مصرف شد', b6permit?.status === 'used')
    }

    // B7 — انقضای مجوز: رفتار به حالتِ سختِ عادی برمی‌گردد
    const b7p = await permits.issue({ rawPhone: PHONE_G, ttlHours: 1, adminId })
    await db.execute(
      sql`update registration_permits set expires_at = now() - interval '1 hour' where id = ${b7p.id}`,
    )
    ok('B7: لیست، مجوزِ گذشته را expired نشان می‌دهد', (await permits.list())[0]?.status === 'expired')
    const b7 = await login(PHONE_G, 'client-A') // دستگاهِ مسدودِ A
    ok(
      'B7: مجوزِ منقضی → همان FORBIDDENِ قبلی (بدون هیچ باقی‌ماندنی از استثنا)',
      b7.code === 'FORBIDDEN' && (b7.message ?? '').includes('مسدود'),
      `code=${b7.code} msg=${b7.message}`,
    )

    // B8 — لغوِ هم‌زمانِ (mid-flight): peek دید، claim نکرد
    const b8p = await permits.issue({ rawPhone: PHONE_G, adminId })
    // شبیه‌سازیِ لغو بین peek و tx: claim را null برمی‌گردانیم (دقیقاً حالتِ race)
    const svc = permits as unknown as Record<string, unknown>
    const originalConsume = svc.consumeForRegistration as typeof permits.consumeForRegistration
    svc.consumeForRegistration = async () => null
    const b8 = await login(PHONE_G, 'client-A')
    svc.consumeForRegistration = originalConsume
    ok(
      'B8: لغوِ هم‌زمان (claim ناموفق) → تصمیمِ گذر برمی‌گردد → FORBIDDEN سخت',
      b8.code === 'FORBIDDEN' && (b8.message ?? '').includes('مسدود') && !(b8.message ?? '').includes('مجوز'),
      `code=${b8.code} msg=${b8.message}`,
    )
    const b8row = await db.query.registrationPermits.findFirst({ where: eq(sql`id`, sql`${b8p.id}`) })
    ok('B8: مجوزِ لغو-شبیه‌سازی‌شده مصرف «نشد» (pending ماند)', b8row?.status === 'pending')
    await permits.revoke({ permitId: b8p.id, adminId })

    // B9 — شکستِ داخل tx مجوز را هدر نمی‌دهد (اتمی‌بودن claim)
    const b9Phone = '09150000008'
    const b9p2 = await permits.issue({ rawPhone: b9Phone, adminId })
    const svcD = devices as unknown as Record<string, unknown>
    const originalFinalize = svcD.finalize as typeof devices.finalize
    svcD.finalize = (async () => {
      throw new Error('simulated finalize failure')
    }) as typeof devices.finalize
    const b9 = await login(b9Phone, 'client-A')
    svcD.finalize = originalFinalize
    const b9row = await db.query.registrationPermits.findFirst({ where: eq(sql`id`, sql`${b9p2.id}`) })
    const b9user = await db.query.users.findFirst({ where: eq(users.phone, b9Phone) })
    ok(
      'B9: شکست داخل tx → rollback کامل (نه کاربر، نه مصرف مجوز)',
      b9.code === '__throw__' && !b9user && b9row?.status === 'pending',
      `code=${b9.code} user=${Boolean(b9user)} permit=${b9row?.status}`,
    )
    await permits.revoke({ permitId: b9p2.id, adminId })

    // ═══════════ گروه C — سرویس مجوز ═══════════
    console.log('\n══ گروه C — سرویس مجوز ══')

    const c1 = await permits.issue({ rawPhone: '09150000009', adminId })
    const c1b = await permits.issue({ rawPhone: '۰۹۱۵۰۰۰۰۰۰۹', note: 'refreshed', adminId })
    ok(
      'C1: صدورِ دوباره = تازه‌سازیِ همان ردیف (ارقام فارسی هم نرمال می‌شود)',
      c1.id === c1b.id && c1b.note === 'refreshed',
    )

    let conflict = false
    try {
      await permits.issue({ rawPhone: PHONE_A, adminId })
    } catch (e) {
      conflict = e instanceof AppError && e.code === 'CONFLICT'
    }
    ok('C2: صدور برای شماره‌ی ثبت‌نام‌کرده → CONFLICT', conflict)

    const c3 = await permits.issue({ rawPhone: '09150000010', adminId })
    await permits.revoke({ permitId: c3.id, adminId })
    let revokeAgain = false
    try {
      await permits.revoke({ permitId: c3.id, adminId })
    } catch (e) {
      revokeAgain = e instanceof AppError && e.code === 'CONFLICT'
    }
    ok('C3: لغوِ دوباره → CONFLICT (فقط pending قابل لغو است)', revokeAgain)

    // C4 — بعد از used/revoked، صدورِ مجدد = ردیفِ pendingِ جدید؛ تاریخچه می‌ماند
    const c4 = await permits.issue({ rawPhone: '09150000010', adminId })
    ok('C4: پس از revoke، صدورِ مجدد = ردیفِ جدید pending', c4.id !== c3.id && c4.status === 'pending')
    const all = await permits.list()
    ok('C4: تاریخچه (used/revoked/expired) در لیست می‌ماند', all.length >= 8)

    let badPhone = false
    try {
      await permits.issue({ rawPhone: '12345', adminId })
    } catch (e) {
      badPhone = e instanceof AppError && e.code === 'VALIDATION_ERROR'
    }
    ok('C5: شماره‌ی نامعتبر → VALIDATION_ERROR', badPhone)
  } finally {
    // ── پاک‌سازی ──
    await database.close?.()
    const cleanup = new SQL(admin, { max: 1 })
    await cleanup.unsafe(`drop database if exists "${scratch}" with (force)`)
    await cleanup.close({ timeout: 5 })
  }

  console.log(`\n══ نتیجه: ${pass} ✓ / ${fail} ✗ ══`)
  if (fail > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
