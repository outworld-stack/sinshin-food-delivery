import { eq, sql } from 'drizzle-orm'
import type { DbOrTx, Tx } from '#/infra/db/client'
import { users } from '#/infra/db/schema'
import { Err } from './errors'
import { isUniqueViolation } from './pg'

const REF_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/** The caller persists the code in this transaction, keeping its reservation locked. */
export async function generateUniqueReferralCode(tx: Tx): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const bytes = crypto.getRandomValues(new Uint8Array(attempt < 4 ? 6 : 10))
    const code = `SIN-${Array.from(bytes, (byte) => REF_ALPHABET[byte % REF_ALPHABET.length]).join('')}`
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('referral-code'), hashtext(${code}))`)
    const clash = await tx.query.users.findFirst({
      columns: { id: true },
      where: sql`upper(${users.referralCode}) = ${code}`,
    })
    if (!clash) return code
  }
  throw Err.internal('ساخت کد معرف ناموفق بود؛ دوباره تلاش کنید.')
}

/** Repair older accounts without replacing a code already assigned by another request. */
export async function ensureUserReferralCode(db: DbOrTx, userId: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        const [user] = await tx.select({ referralCode: users.referralCode }).from(users)
          .where(eq(users.id, userId)).for('update')
        if (!user) throw Err.notFound('کاربر پیدا نشد.')
        if (user.referralCode?.trim()) return user.referralCode

        const referralCode = await generateUniqueReferralCode(tx)
        await tx.update(users).set({ referralCode, updatedAt: new Date() }).where(eq(users.id, userId))
        return referralCode
      })
    } catch (error) {
      // A main-admin edit may claim a candidate without using the allocator lock.
      // The transaction/savepoint rolls that collision back before we retry.
      if (!isUniqueViolation(error) || attempt === 4) throw error
    }
  }
  throw Err.internal('ساخت کد معرف ناموفق بود؛ دوباره تلاش کنید.')
}
