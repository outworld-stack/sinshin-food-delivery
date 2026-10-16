//src/../scripts/test-device-intel.ts
/**
 * تست واحدِ هوشِ دستگاهِ stage-80 — بدون PostgreSQL (توابعِ خالص).
 *
 *   bun scripts/test-device-intel.ts   (یا: bun run db:test:intel)
 *
 * موضوع: وزنِ جمعیتیِ سیگنال‌ها (idfFactor / weighted similarity — الگوی
 * Fellegi–Sunter)، دروازه‌ی وراثتِ مسدودی (strongEvasionMatch)، دروازه‌ی
 * هم‌بستگیِ مسدودسازیِ خودکار (autoBlockEligible) و رگرسیونِ سازگاریِ
 * عقب (بدون stats رفتار بایت‌به‌بایت همانِ پیش از ۸۰).
 */
import {
  autoBlockEligible,
  EVADE_MIN_HASH_SIGNALS,
  EVADE_MIN_SCORE,
  EVADE_MIN_WEIGHTED,
  idfFactor,
  RARE_DF_CAP,
  signalSimilarity,
  strongEvasionMatch,
  type SignalPopulationStats,
} from '../src/domain/device/device-signals'

let pass = 0
let fail = 0
function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

/** چهار سیگنالِ واقعیِ «هم‌مدل» — الگوی iOS روی سخت‌افزار یکسان */
const SIGNALS_A = {
  canvasHash: 'a'.repeat(64),
  webglHash: 'b'.repeat(64),
  audioHash: 'c'.repeat(64),
  fontsHash: 'd'.repeat(64),
  screen: '390x844x24@3',
  platform: 'iPhone',
  timezone: 'Asia/Tehran',
  language: 'fa-IR',
}

function statsOf(df: number): SignalPopulationStats {
  return { canvasDf: df, webglDf: df, audioDf: df, fontsDf: df }
}

function approx(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) < eps
}

async function main(): Promise<void> {
  console.log('\n══ T1: idfFactor — سقفِ کمیابی و تخفیفِ جمعیت ══')
  ok('df ≤ RARE_DF_CAP → وزن کامل (۱)', idfFactor(1) === 1 && idfFactor(RARE_DF_CAP) === 1)
  ok('df = 6 → 3/6 = 0.5', approx(idfFactor(6), 0.5))
  ok('df = 30 → 3/30 = 0.1', approx(idfFactor(30), 0.1))
  ok('df = 300 → 0.01 و سقفِ ۱ رعایت می‌شود', approx(idfFactor(300), 0.01) && idfFactor(1e9) <= 1)
  ok('df = 0 (missing/بی‌استفاده) → بدون کرش', Number.isFinite(idfFactor(0)))

  console.log('\n══ T2: شباهتِ جمعیت‌وزن‌دار — جمعیتِ هم‌مدل فرو می‌ریزد ══')
  const plain = signalSimilarity(SIGNALS_A, SIGNALS_A)
  ok('جفتِ یکسان: score = 1.0', approx(plain.score, 1.0), `score=${plain.score}`)
  ok('جفتِ یکسان: agreeingHashes = 4', plain.agreeingHashes === 4)
  const crowd = signalSimilarity(SIGNALS_A, SIGNALS_A, statsOf(30))
  ok(
    'جمعیتِ ۳۰تایی: score هنوز 1.0 اما weighted ≈ 0.235 (سقوطِ تمییزدهندگی — هش‌ها ۰٫۰۸۵ + غیر-هش‌ها ۰٫۱۵ کامل)',
    approx(crowd.score, 1.0) && approx(crowd.weighted, 0.235, 1e-6),
    `score=${crowd.score} weighted=${crowd.weighted}`,
  )
  ok('جمعیتِ ۳۰تایی: هش‌های برابر باز هم شمرده می‌شوند (شواهد خام مستقل از وزن)', crowd.agreeingHashes === 4)

  console.log('\n══ T3: جفتِ کمیاب — وزن کامل (لینکِ واقعی زنده می‌ماند) ══')
  const uniquePair = signalSimilarity(SIGNALS_A, SIGNALS_A, statsOf(2))
  ok('df=2: weighted === score === 1.0', approx(uniquePair.weighted, uniquePair.score) && approx(uniquePair.score, 1.0))
  const smallDb = signalSimilarity(SIGNALS_A, SIGNALS_A, statsOf(RARE_DF_CAP))
  ok(`df=${RARE_DF_CAP} (دیتابیسِ کوچک/خانواده): وزن کامل`, approx(smallDb.weighted, smallDb.score))

  console.log('\n══ T4: رگرسیونِ سازگاری — بدون stats رفتارِ پیش از ۸۰ ══')
  const noStats = signalSimilarity(SIGNALS_A, SIGNALS_A)
  ok('بدون stats: weighted === score (بایت‌به‌بایتِ قبل)', approx(noStats.weighted, noStats.score))
  ok(
    'بدون stats: comparableWeight/comparableCount همانِ قبل (۱٫۰ / ۷)',
    approx(noStats.comparableWeight, 1.0, 1e-9) && noStats.comparableCount === 7,
    `cw=${noStats.comparableWeight} cc=${noStats.comparableCount}`,
  )
  const partlyDifferent = signalSimilarity(SIGNALS_A, {
    ...SIGNALS_A,
    canvasHash: 'z'.repeat(64),
    fontsHash: 'y'.repeat(64),
  })
  ok(
    'دو هشِ متفاوت: score = webgl+audio+غیر-هش‌ها = 0.60',
    approx(partlyDifferent.score, 0.6) && partlyDifferent.agreeingHashes === 2,
    `score=${partlyDifferent.score}`,
  )

  console.log('\n══ T5: strongEvasionMatch — دروازه‌ی وراثتِ مسدودی ══')
  ok('جفتِ یکسانِ کمیاب (df=2): شاهدِ قوی', strongEvasionMatch(uniquePair))
  ok('جمعیتِ ۳۰تایی: قوی نیست (بی‌گناهِ هم‌مدل مصون)', !strongEvasionMatch(crowd))
  const twoHashesDiffer = signalSimilarity(SIGNALS_A, { ...SIGNALS_A, canvasHash: 'z'.repeat(64), fontsHash: 'y'.repeat(64) }, statsOf(2))
  ok(
    `دو هشِ متفاوت (score ۰٫۶ < ${EVADE_MIN_SCORE}): قوی نیست`,
    !strongEvasionMatch(twoHashesDiffer),
    `score=${twoHashesDiffer.score}`,
  )
  const fontsDrifted = signalSimilarity(SIGNALS_A, { ...SIGNALS_A, fontsHash: 'y'.repeat(64) }, statsOf(2))
  ok(
    'فقط فونت عوض شده (مرورگر آپدیت شد): ۳ هش + محیط کامل — قوی است (فرارِ واقعی همین است)',
    strongEvasionMatch(fontsDrifted),
    `score=${fontsDrifted.score} hashes=${fontsDrifted.agreeingHashes}`,
  )
  const envDrifted = signalSimilarity(SIGNALS_A, { ...SIGNALS_A, platform: 'iPad' }, statsOf(2))
  ok(
    'محیط متفاوت اما چهار هشِ یکسان: باز هم قوی (GPU شاهدِ اصلی است)',
    strongEvasionMatch(envDrifted),
    `score=${envDrifted.score}`,
  )
  ok('آستانه‌های صادرشده منطقی‌اند', EVADE_MIN_SCORE === 0.85 && EVADE_MIN_WEIGHTED === 0.5 && EVADE_MIN_HASH_SIGNALS === 3)

  console.log('\n══ T6: autoBlockEligible — هم‌بستگیِ تصمیمِ سخت ══')
  const weakStack = ['low-memory', 'mobile-no-touch', 'platform-mismatch', 'crowded-cluster']
  ok('انبارِ شواهدِ ضعیف (۸۰): واجدِ مسدودسازی نیست (requireStrong)', !autoBlockEligible(80, weakStack, true))
  ok('یک فلگِ قوی (headless-ua): واجد است', autoBlockEligible(80, [...weakStack, 'headless-ua'], true))
  ok('canvas-drift هم قوی است', autoBlockEligible(45, ['low-memory', 'canvas-drift'], true))
  ok('requireStrong=false → رفتارِ قبل (فقط امتیاز)', autoBlockEligible(80, weakStack, false))
  ok('امتیازِ صفر: هرگز', !autoBlockEligible(0, ['headless-ua'], true))

  console.log('\n══ T7: پروتکلِ missing — حتی با stats هم وزن نمی‌گیرد ══')
  const MISSING = 'f020fbda2d9a8b1bdf1f7016373e52ecb26742cddd3a32f7cd7ee8f1a66c9bb5'
  const withMissing = signalSimilarity(
    { ...SIGNALS_A, canvasHash: MISSING, webglHash: MISSING },
    { ...SIGNALS_A, canvasHash: MISSING, webglHash: MISSING },
    statsOf(1),
  )
  ok('دو سیگنالِ missing: امتیازِ فقط audio+fonts+غیر-هش = 0.5', approx(withMissing.score, 0.5), `score=${withMissing.score}`)
  ok('missing ها هرگز comparable نمی‌شوند', withMissing.comparableCount === 5)
  ok('weighted هم همان مقیاس را نگه می‌دارد', approx(withMissing.weighted, 0.5, 1e-6))

  console.log(`\n────────────────────────\n  ${pass} ✓ · ${fail} ✗\n`)
  if (fail > 0) process.exit(1)
}

await main()
