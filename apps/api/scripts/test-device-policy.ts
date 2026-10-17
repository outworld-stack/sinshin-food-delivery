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
import { devices as deviceTable, sessions, users } from '../src/infra/db/schema'
import { sha256 } from '../src/domain/shared/crypto'

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
  const database = new Database(url.toString(), { max: 4 })
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

    // ═════════════════════════════════════════════════════════════
    // stage-80 — هوشِ جمعیتی + وراثتِ مسدودی + دروازه‌ی هم‌بستگی
    // ═════════════════════════════════════════════════════════════

    /** سیگنال‌های «یکتا» — الگوی دستگاهِ واقعیِ قابل‌ردگیری */
    const uniqueSignals = (tag: string, clientId?: string | null) => ({
      ...strongSignals(clientId),
      canvasHash: `${tag}-c`.repeat(20).slice(0, 64),
      webglHash: `${tag}-w`.repeat(20).slice(0, 64),
      audioHash: `${tag}-a`.repeat(20).slice(0, 64),
      fontsHash: `${tag}-f`.repeat(20).slice(0, 64),
    })

    const finalizeSignals = async (
      peek: Awaited<ReturnType<typeof devices.peek>>,
      phone: string,
      signals: ReturnType<typeof strongSignals>,
    ) =>
      database.db.transaction(async (tx) =>
        devices.finalize(tx, { signals, phone, peek, event: 'REGISTER' }),
      )

    // ── S1 — جمعیتِ هم‌مدل: لینکِ کاذب دیگر ساخته نمی‌شود (IDF) ──
    // ۱۲ دستگاهِ هم‌مدلِ تازه (همان چهار هشِ strongSignals) + ردیف‌های A/B
    for (let i = 0; i < 12; i++) {
      await database.db.execute(
        sql`insert into devices (fingerprint_hash, canvas_hash, webgl_hash, audio_hash, fonts_hash)
            values (${'crowd-fp-' + i}, ${'a'.repeat(64)}, ${'b'.repeat(64)}, ${'c'.repeat(64)}, ${'d'.repeat(64)})`,
      )
    }
    const PHONE_D = '09150000004'
    const peekD = await devices.peek(strongSignals(), PHONE_D)
    const finD = await finalizeSignals(peekD, PHONE_D, strongSignals())
    const linksOfD = (await database.db.query.deviceLinks.findMany({})).filter(
      (l) => l.deviceA === finD.device.id || l.deviceB === finD.device.id,
    )
    ok(
      'S1: ثبت‌نامِ دستگاهِ هم‌مدل در جمعیتِ ۱۵تایی → هیچ لینکِ کاذبی (وزنِ جمعیتی)',
      linksOfD.length === 0,
      `links=${linksOfD.length}`,
    )
    ok('S1: ریسکِ crowded-cluster هم نگرفت (خوشه‌ی تنها)', finD.device.riskFlags.length === 0, JSON.stringify(finD.device.riskFlags))

    // ── S2 — وراثتِ مسدودی: فرارِ «پاک‌کردنِ storage + شماره‌ی جدید» ──
    const PHONE_E = '09150000005'
    const PHONE_F = '09150000006'
    const peekE = await devices.peek(uniqueSignals('e'), PHONE_E)
    const finE = await finalizeSignals(peekE, PHONE_E, uniqueSignals('e'))
    ok('S2: دستگاهِ E (سیگنال‌های یکتا) ثبت‌نام کرد و سالم است', !finE.device.isBlocked)
    await devices.setBlocked(finE.device.id, true, 'admin-test', null)
    // متخلف: storage پاک (clientId تازه/هیچ) + شماره‌ی جدید + همان سیگنال‌ها
    const peekF = await devices.peek(uniqueSignals('e'), PHONE_F)
    ok(
      'S2: peek شماره F ردیفِ مسدودِ E را پیدا نمی‌کند (هشِ scope-شماره) — فرارِ خاموش',
      peekF.device === null,
    )
    const finF = await finalizeSignals(peekF, PHONE_F, uniqueSignals('e'))
    ok(
      'S2: ثبت‌نام F کامل شد اما دستگاهش «مسدودِ وارثی» شد (cluster-block-inherit)',
      finF.device.isBlocked === true && finF.device.blockedReason === 'cluster-block-inherit',
      `blocked=${finF.device.isBlocked} reason=${finF.device.blockedReason}`,
    )
    const evadeEvents = await database.db.query.deviceEvents.findMany({
      where: sql`device_id = ${finF.device.id} and event = 'EVADED_BLOCK_LINK'`,
    })
    ok('S2: رویدادِ ممیزی EVADED_BLOCK_LINK با جزئیات ثبت شد', evadeEvents.length === 1)
    const inheritLink = (await database.db.query.deviceLinks.findMany({})).find(
      (l) =>
        (l.deviceA === finE.device.id && l.deviceB === finF.device.id) ||
        (l.deviceA === finF.device.id && l.deviceB === finE.device.id),
    )
    ok('S2: رابطه‌ی E↔F در گرافِ دستگاه ثبت شد (پنل ادمین)', Boolean(inheritLink))

    // ── S3 — دستگاهِ بی‌گناهِ هم‌مدل: مصون از وراثت (وزنِ جمعیتی) ──
    // یکی از جمعیتِ هم‌مدل را مسدود می‌کنیم؛ شخصِ بعدیِ همان مدل نباید وارثِ مسدودی شود
    const crowdRow = await database.db.query.devices.findFirst({
      where: sql`fingerprint_hash like 'crowd-fp-%'`,
    })
    await devices.setBlocked(crowdRow!.id, true, 'admin-test', null)
    const PHONE_G = '09150000007'
    const peekG = await devices.peek(strongSignals(), PHONE_G)
    const finG = await finalizeSignals(peekG, PHONE_G, strongSignals())
    ok(
      'S3: دستگاهِ هم‌مدل در جمعیتِ «مسدوددار» → وارثِ مسدودی «نشد» (df تخفیف کرد)',
      finG.device.isBlocked === false,
      `blocked=${finG.device.isBlocked} reason=${finG.device.blockedReason}`,
    )
    const evadeG = await database.db.query.deviceEvents.findMany({
      where: sql`device_id = ${finG.device.id} and event = 'EVADED_BLOCK_LINK'`,
    })
    ok('S3: هیچ EVADED_BLOCK_LINKی برای بی‌گناه ثبت نشد', evadeG.length === 0)

    // ── S4 — دروازه‌ی هم‌بستگیِ auto-block (با آستانه‌ی ۶۰ برای آزمون) ──
    const configGate = new AppConfig({
      NODE_ENV: 'development',
      DATABASE_URL: url.toString(),
      DEVICE_ENFORCEMENT: 'true',
      DEVICE_MAX_PHONES_PER_DEVICE: '1',
      DEVICE_AUTOBLOCK_SCORE: '60',
      DEVICE_LINK_THRESHOLD: '0.7',
      DEVICE_SIMILARITY_WINDOW_DAYS: '7',
    })
    const devicesGate = new DeviceService({ db: database.db, config: configGate })
    const finalizeGate = async (phone: string, signals: ReturnType<typeof strongSignals>) => {
      const peek = await devicesGate.peek(signals, phone)
      return database.db.transaction(async (tx) =>
        devicesGate.finalize(tx, { signals, phone, peek, event: 'REGISTER' }),
      )
    }
    // فقط شواهدِ ضعیف: low-memory(25) + mobile-no-touch(20) + platform-mismatch(20) = 65 ≥ 60
    const weakSignals: ReturnType<typeof strongSignals> = {
      ...uniqueSignals('w'),
      deviceMemory: 2,
      touch: false,
      platform: 'Android',
    }
    const PHONE_H = '09150000008'
    const finH = await finalizeGate(PHONE_H, weakSignals)
    ok(
      'S4: انبارِ شواهدِ ضعیف (65 ≥ 60) → مسدود «نشد» (AUTO_BLOCK_DEFERRED)',
      finH.device.isBlocked === false && finH.device.riskScore === 65,
      `blocked=${finH.device.isBlocked} score=${finH.device.riskScore}`,
    )
    const deferredH = await database.db.query.deviceEvents.findMany({
      where: sql`device_id = ${finH.device.id} and event = 'AUTO_BLOCK_DEFERRED'`,
    })
    ok('S4: رویدادِ معوق با دلیلِ weak-flags-only ثبت شد (بازبینیِ ادمین)', deferredH.length === 1)
    // یک شاهدِ قوی: headless-ua(35) + low-memory(25) = 60
    const headlessSignals: ReturnType<typeof strongSignals> = {
      ...uniqueSignals('s'),
      deviceMemory: 2,
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/124.0.0.0',
    }
    const PHONE_I = '09150000009'
    const finI = await finalizeGate(PHONE_I, headlessSignals)
    ok(
      'S4: فلگِ قویِ headless-ua (60) → مسدود «شد»',
      finI.device.isBlocked === true,
      `blocked=${finI.device.isBlocked} reason=${finI.device.blockedReason}`,
    )

    // ── S5 — رویدادِ تصمیم (forensics) ──
    const decisions = await database.db.query.deviceEvents.findMany({
      where: sql`device_id = ${finF.device.id} and event = 'DEVICE_DECISION'`,
    })
    const metaF = (decisions[0]?.metadata ?? {}) as Record<string, unknown>
    ok(
      'S5: DEVICE_DECISION ثبت شد — لایه/ریسک/وراثت در یک رویداد',
      decisions.length >= 1 &&
        metaF['matchedBy'] === 'none' &&
        metaF['evadedBlock'] !== null &&
        metaF['autoBlock'] === 'no',
      JSON.stringify(metaF).slice(0, 160),
    )

    // Regression: a duplicate fingerprint UPDATE must not poison the outer
    // PostgreSQL transaction. The clientId row remains the resolved identity.
    const collisionA = uniqueSignals('collision', 'collision-client-a')
    const collisionB = uniqueSignals('collision', 'collision-client-b')
    const phoneJ = '09150000010'
    const phoneK = '09150000011'
    const rowJ = await finalizeSignals(await devices.peek(collisionA, phoneJ), phoneJ, collisionA)
    const rowK = await finalizeSignals(await devices.peek(collisionB, phoneK), phoneK, collisionB)
    const collisionPeek = await devices.peek(collisionA, phoneK)
    const collision = await database.db.transaction((tx) => devices.finalize(tx, {
      signals: collisionA, phone: phoneK, peek: collisionPeek, event: 'LOGIN',
    }))
    ok('R1: fingerprint conflict recovers inside the transaction', collision.device.id === rowJ.device.id)
    ok('R1: fingerprint conflict preserves both device keys',
      collision.device.fingerprintHash === rowJ.device.fingerprintHash &&
      collision.device.fingerprintHash !== rowK.device.fingerprintHash)
    const retries = await database.db.query.deviceEvents.findMany({
      where: sql`device_id = ${rowJ.device.id} and event = 'UNIQUE_RETRY'`,
    })
    ok('R1: savepoint recovery retains its audit events', retries.length === 2)

    const quotaConfig = new AppConfig({
      NODE_ENV: 'development', DATABASE_URL: url.toString(),
      DEVICE_ENFORCEMENT: 'true', MAX_DEVICES_PER_USER: '1',
    })
    const quotaDevices = new DeviceService({ db: database.db, config: quotaConfig })
    let knownQuotaError = ''
    try { await quotaDevices.assertQuota(phoneK, 'user', rowJ.device.id) }
    catch (error) { knownQuotaError = String(error) }
    ok('R2: existing devices can log in after the quota is lowered', !knownQuotaError)
    let newQuotaError = ''
    try { await quotaDevices.assertQuota(phoneK, 'user') }
    catch (error) { newQuotaError = (error as { code: string }).code }
    ok('R2: lowered quota still rejects a new device', newQuotaError === 'DEVICE_LIMIT_REACHED')

    // Both requests peek before either transaction inserts the shared client.
    const concurrentSignals = uniqueSignals('race', 'race-client')
    const racePhones = ['09150000012', '09150000013']
    const racePeeks = await Promise.all(racePhones.map((phone) => devices.peek(concurrentSignals, phone)))
    const raceResults = await Promise.allSettled(racePhones.map((phone, index) =>
      finalizeSignals(racePeeks[index]!, phone, concurrentSignals),
    ))
    ok('R3: concurrent registrations claim a shared client exactly once',
      raceResults.filter((r) => r.status === 'fulfilled').length === 1 &&
      raceResults.some((r) => r.status === 'rejected' && r.reason?.code === 'DEVICE_PHONE_LIMIT'))
    const raceRows = await database.db.query.devices.findMany({ where: sql`client_id = 'race-client'` })
    ok('R3: concurrent registrations keep one device row', raceRows.length === 1)

    // A stale fingerprint match must not defeat a clientId claimed afterwards.
    const staleSignals = uniqueSignals('stale', 'stale-client')
    const stalePhone = '09150000014'
    const stalePeek = await devices.peek(staleSignals, stalePhone)
    const [staleFingerprint] = await database.db.insert(deviceTable).values({
      canvasHash: staleSignals.canvasHash, webglHash: staleSignals.webglHash,
      audioHash: staleSignals.audioHash, fontsHash: staleSignals.fontsHash,
      fingerprintHash: stalePeek.fingerprintHash,
    }).returning()
    const [staleClient] = await database.db.insert(deviceTable).values({
      clientId: staleSignals.clientId,
      canvasHash: staleSignals.canvasHash, webglHash: staleSignals.webglHash,
      audioHash: staleSignals.audioHash, fontsHash: staleSignals.fontsHash,
      fingerprintHash: 'stale-client-original', registeredOwnerPhone: '09150000015',
    }).returning()
    let staleCode = ''
    try { await finalizeSignals(stalePeek, stalePhone, staleSignals) }
    catch (error) { staleCode = (error as { code: string }).code }
    ok('R4: stale peek resolves clientId before the conflicting fingerprint', staleCode === 'DEVICE_PHONE_LIMIT')
    const untouchedStale = await database.db.query.deviceIdentities.findMany({
      where: sql`device_id in (${staleClient!.id}, ${staleFingerprint!.id})`,
    })
    ok('R4: rejected stale registration attaches no identities', untouchedStale.length === 0)

    const blockSignals = uniqueSignals('block', 'block-client')
    const blockPhone = '09150000016'
    const blockRow = await finalizeSignals(await devices.peek(blockSignals, blockPhone), blockPhone, blockSignals)
    const unblockedPeek = await devices.peek(blockSignals, '09150000017')
    await devices.setBlocked(blockRow.device.id, true, 'concurrent-admin-block', null)
    let blockedCode = ''
    try { await finalizeSignals(unblockedPeek, '09150000017', blockSignals) }
    catch (error) { blockedCode = (error as { code: string }).code }
    ok('R5: a block added after peek prevents registration', blockedCode === 'FORBIDDEN')
    let blockedLoginCode = ''
    try {
      await database.db.transaction((tx) => devices.finalize(tx, {
        signals: blockSignals, phone: blockPhone, peek: unblockedPeek, event: 'LOGIN',
      }))
    } catch (error) { blockedLoginCode = (error as { code: string }).code }
    ok('R5: a block added after peek prevents login', blockedLoginCode === 'FORBIDDEN')

    const [sessionUser] = await database.db.insert(users).values({ phone: phoneJ }).returning()
    const [liveSession] = await database.db.insert(sessions).values({
      userId: sessionUser!.id as typeof sessions.$inferInsert.userId,
      deviceId: rowJ.device.id, refreshHash: 'device-revoke-session',
      expiresAt: new Date(Date.now() + 60_000),
    }).returning()
    // Failure injection: an audit failure must roll back the identity deletion.
    await database.db.execute(sql`alter table device_events add constraint test_identity_audit_failure
      check (event <> 'IDENTITY_REMOVED') not valid`)
    let revokeFailed = false
    try { await devices.revokeIdentity(sessionUser!.id, phoneJ, rowJ.device.id) }
    catch { revokeFailed = true }
    await database.db.execute(sql`alter table device_events drop constraint test_identity_audit_failure`)
    const retainedIdentity = await database.db.query.deviceIdentities.findFirst({
      where: sql`device_id = ${rowJ.device.id} and phone = ${phoneJ}`,
    })
    const retainedSession = await database.db.query.sessions.findFirst({ where: sql`id = ${liveSession!.id}` })
    ok('R6: identity removal rolls back completely when auditing fails',
      revokeFailed && Boolean(retainedIdentity) && retainedSession?.revokedAt === null)
    ok('R6: a subsequent removal succeeds', await devices.revokeIdentity(sessionUser!.id, phoneJ, rowJ.device.id))
    const revokedSession = await database.db.query.sessions.findFirst({ where: sql`id = ${liveSession!.id}` })
    ok('R6: identity removal revokes the matching live session', revokedSession?.revokedReason === 'device-revoked')

    await database.db.execute(sql`alter table device_events add constraint test_block_audit_failure
      check (event <> 'BLOCK') not valid`)
    let blockFailed = false
    try { await devices.setBlocked(rowJ.device.id, true, 'failed-block', null) }
    catch { blockFailed = true }
    await database.db.execute(sql`alter table device_events drop constraint test_block_audit_failure`)
    const retainedDevice = await database.db.query.devices.findFirst({ where: sql`id = ${rowJ.device.id}` })
    ok('R7: device blocking rolls back when its audit write fails', blockFailed && retainedDevice?.isBlocked === false)

    const fractionalSignals = { ...uniqueSignals('fractional', 'fractional-client'), deviceMemory: 0.5 }
    const fractionalPhone = '09150000018'
    const fractional = await finalizeSignals(await devices.peek(fractionalSignals, fractionalPhone), fractionalPhone, fractionalSignals)
    ok('R8: fractional navigator.deviceMemory is stored exactly', fractional.device.deviceMemory === 0.5)

    const driftPhone = '09150000019'
    const driftSignals = uniqueSignals('drift', 'drift-client')
    const missingCanvas = { ...driftSignals, canvasHash: sha256('sinshin-missing-v1') }
    await finalizeSignals(await devices.peek(missingCanvas, driftPhone), driftPhone, missingCanvas)
    const loginSignals = async (signals: ReturnType<typeof strongSignals>, phone: string) => {
      const peek = await devices.peek(signals, phone)
      return database.db.transaction((tx) => devices.finalize(tx, { signals, phone, peek, event: 'LOGIN' }))
    }
    await loginSignals(driftSignals, driftPhone)
    const changedCanvas = { ...driftSignals, canvasHash: sha256('drift-change-1') }
    const firstDrift = await devices.peek(changedCanvas, driftPhone)
    ok('R9: recovering a missing canvas does not count as a prior drift', !firstDrift.riskFlags.includes('canvas-drift'))
    await loginSignals(changedCanvas, driftPhone)
    const repeatedDrift = await devices.peek({ ...driftSignals, canvasHash: sha256('drift-change-2') }, driftPhone)
    ok('R9: two consecutive real canvas changes still flag drift', repeatedDrift.riskFlags.includes('canvas-drift'))

    const emptyClientA = uniqueSignals('empty-a', '')
    const emptyClientB = uniqueSignals('empty-b', '')
    const noClientA = await finalizeSignals(await devices.peek(emptyClientA, '09150000020'), '09150000020', emptyClientA)
    const noClientB = await finalizeSignals(await devices.peek(emptyClientB, '09150000021'), '09150000021', emptyClientB)
    ok('R10: empty client IDs behave as absent rather than a shared unique key',
      noClientA.device.clientId === null && noClientB.device.clientId === null && noClientA.device.id !== noClientB.device.id)
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
