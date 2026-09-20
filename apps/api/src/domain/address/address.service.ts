//src/domain/address/address.service.ts
import { and, asc, eq } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import { addresses, type AddressRow } from '#/infra/db/schema'
import { asAddressId } from '#/domain/shared/brand'

export class AddressService {
  constructor(private readonly deps: { db: Db }) {}

  async list(userId: string): Promise<AddressRow[]> {
    return this.deps.db
      .select()
      .from(addresses)
      .where(eq(addresses.userId, userId))
      .orderBy(asc(addresses.createdAt))
  }

  async create(
    userId: string,
    input: { title: string; address: string; lat: number; lng: number },
  ): Promise<AddressRow> {
    const [created] = await this.deps.db
      .insert(addresses)
      .values({ userId, ...input })
      .returning()
    return created!
  }

  async update(
    userId: string,
    id: string,
    input: { title: string; address: string; lat: number; lng: number },
  ): Promise<AddressRow | null> {
    // cast در مرز ورودی — تنها نقطه‌ی مجاز (قرارداد brand.ts)
    const addressId = asAddressId(id)
    const [updated] = await this.deps.db
      .update(addresses)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)))
      .returning()
    return updated ?? null
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const addressId = asAddressId(id)
    const removed = await this.deps.db
      .delete(addresses)
      .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)))
      .returning({ id: addresses.id })
    return removed.length > 0
  }
}