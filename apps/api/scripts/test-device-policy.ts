//src/../scripts/test-device-policy.ts
/**
 * تست E2E سیاست دستگاه (stage-73 — یافته‌های ۳/۴) — PostgreSQL واقعی.
 *
 *   bun scripts/test-device-policy.ts   (یا: bun run db:test:device)
 *
 * روی «دیتابیس موقتیِ» همان سرور (sinshin_e2e_…) — به دیتابیس اصلی دست
 * نمی‌زند. سرویسِ واقعی DeviceService (peek + finalize) را با درایور
 * خودِ اپ اجرا می‌کند و سیاستِ جدید را ثابت می‌کند:
 *
 *  P0) unit: compositeFingerprintHash با شماره‌ی متفاوت = هش متفاوت
 *      (scope شماره در مسیر کامل)؛ lowq هم‌رقم صادر نمی‌کند
 *  P1) همان شماره + storage پاک‌شده (clientId تازه) → همان ردیف پیدا
 *      می‌شود (matchedBy='fingerprint') — تاریخچه/سهمیه ادامه می‌یابد
 *  P2) «غریبه با سخت‌افزار مشابه» (سیگنال‌های یکسان، شماره‌ی متفاوت):
 *      peek دستگاهِ دیگری را پیدا نمی‌کند؛ ثبت‌نام موفق؛ ردیف جدا +
 *      لینک شباهت — نه PHONE_LIMIT_BLOCKED کاذب (یافته‌ی ۳)
 *  P3) سقف سختِ «هر پروفایل مرورگر یک ثبت‌نام» (لایه‌ی clientId):
 *      شماره‌ی دوم روی همان clientId → claim رد → DEVICE_PHONE_LIMIT
 *      (سیاستِ انتخابی: سخت فقط روی پروفایل؛ نرم روی خوشه)
 *  P4) خوشه‌ی شباهت فقط «سیگنال نرم» است: ریسک‌فلگ‌ها/لینک‌ها نوشته
 *      می‌شوند اما ورود/ثبت‌نامِ شماره‌ی جدید مسدود نمی‌شود
 */
import { SQL } from 'bun'
import { sql } from 'drizzle-orm'

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

const scratch = `sinshin_e2e_policy_${process.pid}_${Math.random().toString(36).slice(2, 8)}`

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
  const err = await new Response(proc.stderr).text()
  const code = await proc.exited
  if (code !== 0) {
    console.log(out + err)
    throw new Error('migrate ناموفق بود')
  }
  ok('P0: زنجیره‌ی کامل + backfill_runs اعمال شد', /migrations applied/.test(out))

  // ── سرویس واقعی روی همان درایورِ اپ ──
  const { Database } = await import('../src/infra/db/client')
  const { AppConfig } = await import('../src/infra/config/env')
  const { DeviceService } = await import('../src/domain/device/device.service')
  const { compositeFingerprintHash } = await import('../src/domain/device/device-signals')

  const config = new AppConfig({
    NODE_ENV: 'development',
    DATABASE_URL: url.toString(),
    DEVICE_ENFORCEMENT: 'true',
    DEVICE_MAX_PHONES_PER_DEVICE: '1',
    DEVICE_REFERRAL_BLOCK_AFTER: '3',
    DEVICE_LINK_THRESHOLD: '0.7',
    DEVICE_SIMILARITY_WINDOW_DAYS: '7',
    MAX_DEVICES_PER_USER: '5',
  })
  const database = new Database(url.toString(), { max: 1 })
  const devices = new DeviceService({ db: database.db, config })

  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'

  /** ۴ سیگنال واقعیِ یکسان — شبیه‌سازیِ دو آیفونِ هم‌مدل (یافته‌ی ۳) */
  const strongSignals = (clientId?: string | null) => ({
    clientId: clientId ?? null,
    canvasHash: 'a'.repeat(64),
    webglHash: 'b'.repeat(64),
    audioHash: 'c'.repeat(64),
    fontsHash: 'd'.repeat(64),
    screen: '390x844x24@3',
    platform: 'iPhone',
    timezone: 'Asia/Tehran',
    language: 'fa-IR',
    hardwareConcurrency: 6,
    deviceMemory: 4,
    touch: true,
    networkType: '4g',
    userAgent: UA,
  })

  const PHONE_A = '09150000001'
  const PHONE_B = '09150000002'

  // در جریان واقعی، finalize همیشه «داخل تراکنشِ ثبت‌نام» صدا زده می‌شود
  // (auth.service) — اینجا هم همین الگو: با رد شدنِ claim، آپدیت‌های ردیف هم
  // rollback می‌شوند (رفع artifact تست: آپدیتِ autocommit ردیف را آلوده می‌کرد)
  const registerOn = async (
    peek: Awaited<ReturnType<typeof devices.peek>>,
    phone: string,
    clientId: string | null,
  ) =>
    database.db.transaction(async (tx) =>
      devices.finalize(tx, {
        signals: strongSignals(clientId),
        phone,
        peek,
        event: 'REGISTER',
      }),
    )

  try {
    // ═══ P0 — unit: scope شماره در هش ═══
    const hA = compositeFingerprintHash(strongSignals(), UA, PHONE_A)
    const hA2 = compositeFingerprintHash(strongSignals(), UA, PHONE_A)
    const hB = compositeFingerprintHash(strongSignals(), UA, PHONE_B)
    ok('P0: هشِ همان شماره deterministic است', hA === hA2)
    ok('P0: شماره‌ی متفاوت = هش متفاوت (سیگنال‌های یکسان، دو آیفون هم‌مدل)', hA !== hB)

    // ═══ P1 — همان شماره، storage پاک‌شده → همان ردیف ═══
    const peekA1 = await devices.peek(strongSignals(), PHONE_A)
    ok('P1: نخستین peek دستگاه تازه است', peekA1.device === null && peekA1.matchedBy === 'none')
    const finA = await registerOn(peekA1, PHONE_A, null)
    ok('P1: ثبت‌نام شماره A موفق', Boolean(finA.device.id))
    ok('P1: مالک ردیف = شماره A', finA.device.registeredOwnerPhone === PHONE_A)

    // storage پاک شده → clientId تازه (تصادفی) و همان سیگنال‌ها/شماره
    const peekA2 = await devices.peek(strongSignals('fresh-client-uuid-1'), PHONE_A)
    ok(
      'P1: بعد از پاک‌شدن storage همان ردیف پیدا می‌شود (matchedBy=fingerprint)',
      peekA2.device?.id === finA.device.id && peekA2.matchedBy === 'fingerprint',
      `device=${peekA2.device?.id} row=${finA.device.id} by=${peekA2.matchedBy}`,
    )
    const finA2 = await database.db.transaction(async (tx) =>
      devices.finalize(tx, {
        signals: strongSignals('fresh-client-uuid-1'),
        phone: PHONE_A,
        peek: peekA2,
        event: 'LOGIN',
      }),
    )
    ok('P1: finalize LOGIN روی همان ردیف (تکثیر ردیف نه)', finA2.device.id === finA.device.id)

    // ═══ P2 — غریبه با سخت‌افزار مشابه (یافته‌ی ۳) ═══
    const peekB = await devices.peek(strongSignals(), PHONE_B)
    ok(
      'P2: شماره‌ی B با سیگنال‌های یکسان، ردیفِ A را پیدا «نمی‌کند» (scope شماره)',
      peekB.device === null && peekB.matchedBy === 'none',
      `device=${peekB.device?.id}`,
    )
    let blocked = false
    let finB: Awaited<ReturnType<typeof devices.finalize>> | null = null
    try {
      finB = await registerOn(peekB, PHONE_B, null)
    } catch (error) {
      blocked = true
      console.log('    (خطای غیرمنتظره:', String(error).slice(0, 120), ')')
    }
    ok('P2: ثبت‌نامِ شماره‌ی B موفق — بدون PHONE_LIMIT_BLOCKEDِ کاذب', !blocked && Boolean(finB))
    ok('P2: ردیف B جدا از ردیف A است', finB ? finB.device.id !== finA.device.id : false)
    ok('P2: مالکِ ردیف B = شماره B', finB?.device.registeredOwnerPhone === PHONE_B)

    const linkRows = (await database.db.query.deviceLinks.findMany({})).filter(
      (l) => l.deviceA === finA.device.id || l.deviceB === finA.device.id,
    )
    ok(
      'P2: لینکِ شباهت A↔B ثبت شد (سیگنال نرم برای ریسک/معرف — نه ردِ قطعی)',
      linkRows.length >= 1,
      `links=${linkRows.length}`,
    )
    const sim = linkRows[0]?.similarity ?? 0
    ok('P2: شباهت لینک = ۱.۰ (همه‌ی سیگنال‌ها برابر)', sim >= 0.99, String(sim))

    // ردیف‌ها: دقیقاً ۲ (نه یک ردیف مشترکِ فشرده)
    const allDevices = await database.db.query.devices.findMany({})
    ok('P2: دو ردیف مستقل در devices (ادغام کاذب رخ نداد)', allDevices.length === 2, `count=${allDevices.length}`)

    // ═══ P3 — سقف سخت روی پروفایل مرورگر (clientId) ═══
    // ردیف B حالا clientId می‌گیرد (شبیه‌سازیِ مرورگرِ با-storage)
    const PHONE_C = '09150000003'
    await database.db.execute(
      sql`update devices set client_id = 'cid-of-B' where id = ${finB!.device.id}`,
    )
    const peekC = await devices.peek(strongSignals('cid-of-B'), PHONE_C)
    ok(
      'P3: clientId ردیف B را پیدا می‌کند (لایه ۱ — مستقل از شماره)',
      peekC.device?.id === finB?.device.id && peekC.matchedBy === 'client-id',
    )
    let phoneLimit = ''
    try {
      await registerOn(peekC, PHONE_C, 'cid-of-B')
    } catch (error) {
      phoneLimit = String((error as { code?: string }).code ?? (error as Error).message)
    }
    ok(
      'P3: ثبت‌نام شماره‌ی دوم روی همان پروفایل → DEVICE_PHONE_LIMIT (سقف سخت)',
      phoneLimit.includes('DEVICE_PHONE_LIMIT'),
      phoneLimit.slice(0, 120),
    )
    // ردیف B باید بعد از rollbackِ claim، آلوده نباشد (hash همچنان scope شماره B)
    const rowB = await database.db.query.devices.findFirst({
      where: sql`id = ${finB!.device.id}`,
    })
    ok(
      'P3: rollback تراکنش — ردیف B دست‌نخورده ماند (هش همچنان scope شماره B)',
      rowB?.fingerprintHash === compositeFingerprintHash(strongSignals('cid-of-B'), UA, PHONE_B),
    )

    // ═══ P4 — خوشه فقط سیگنال نرم ═══
    // شماره‌ی C روی «بدون-clientId» (storage پاک) آزاد است — سیاستِ انتخابی
    const peekC3 = await devices.peek(strongSignals(), PHONE_C)
    ok(
      'P4: شماره C بدون clientId اصلاً ردیفِ مالِ دیگران را نمی‌بیند (نرم)',
      peekC3.device === null,
    )
  } finally {
    await database.close()
    const cleaner = new SQL(admin, { max: 1 })
    try {
      await cleaner.unsafe(`drop database if exists "${scratch}" with (force)`)
    } finally {
      await cleaner.close({ timeout: 5 })
    }
  }

  console.log(`\n══ نتیجه: ${pass} پاس / ${fail} خطا ══`)
  if (fail > 0) process.exitCode = 1
}

await main()
