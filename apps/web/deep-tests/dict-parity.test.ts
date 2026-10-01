// ═══════════════════════════════════════════════════════════════
// round-36 — sinshin-food-delivery — فایل 10 از 14
// مسیر مقصد: apps/web/deep-tests/dict-parity.test.ts
// وضعیت: فایل جدید — پوشه را در صورت نیاز بسازید
// کامیت پیشنهادی: stage thirty two
// ═══════════════════════════════════════════════════════════════

// تست عمیق ر۳۱ — توازن کلیدهای دیکشنری fa/ar + placeholder ها
import { describe, expect, test } from 'bun:test'
import { fa } from '#/i18n/fa'
import { ar } from '#/i18n/ar'

/** دیکشنری تخت است: کلیدها خودشان رشته‌های نقطه‌دارند — تجزیه‌ی مسیر لازم نیست */
function keysOf(obj: Record<string, unknown>): string[] {
        return Object.keys(obj)
}

function get(obj: Record<string, unknown>, key: string): unknown {
        return obj[key]
}

describe('R31 — dictionary parity (fa ↔ ar)', () => {
        test('هر دو دیکشنری دقیقاً همان کلیدها را دارند', () => {
                const faKeys = keysOf(fa).sort()
                const arKeys = keysOf(ar).sort()
                const missingInAr = faKeys.filter((k) => !arKeys.includes(k))
                const extraInAr = arKeys.filter((k) => !faKeys.includes(k))
                expect(missingInAr).toEqual([])
                expect(extraInAr).toEqual([])
                expect(faKeys.length).toBeGreaterThan(300)
        })

        test('هیچ مقدار عربی خالی یا undefined نیست (جز استثنای مستند)', () => {
                // استثنای آگاهانه: login.refInvitedSuffix در عربی خالی است چون
                // «لقد تمت دعوتك برمز الإحالة X» بدون پسوند کامل است (ترتیب کلمات عربی).
                const DOCUMENTED_EMPTY = new Set(['login.refInvitedSuffix'])
                const emptyFull = keysOf(ar).filter((k) => {
                        const v = get(ar as Record<string, unknown>, k)
                        return (v === undefined || v === null || v === '') && !DOCUMENTED_EMPTY.has(k)
                })
                expect(emptyFull).toEqual([])
        })

        test('جای‌نگذار {n} در هر دو زبان هم‌پوشان است', () => {
                const mismatches: string[] = []
                for (const k of keysOf(fa)) {
                        const faHas = String(get(fa as Record<string, unknown>, k)).includes('{n}')
                        const arHas = String(get(ar as Record<string, unknown>, k)).includes('{n}')
                        if (faHas !== arHas) mismatches.push(k)
                }
                expect(mismatches).toEqual([])
        })
})
