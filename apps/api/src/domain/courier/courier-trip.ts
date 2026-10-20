import { and, asc, eq, isNull } from 'drizzle-orm'
import type { DbOrTx } from '#/infra/db/client'
import { couriers, courierTrips, orders } from '#/infra/db/schema'
import type { CourierId } from '#/domain/shared/brand'
import { Err } from '#/domain/shared/errors'

/** Call inside a transaction, after locking the order. The courier row serializes
 * trip creation and completion across different orders assigned to one courier. */
export async function lockCourierTrips(db: DbOrTx, courierId: CourierId): Promise<void> {
  const [courier] = await db.select({ id: couriers.id }).from(couriers)
    .where(eq(couriers.id, courierId)).for('update')
  if (!courier) throw Err.notFound('پیک یافت نشد.')
}

export async function startCourierTrip(db: DbOrTx, courierId: CourierId, startedAt: Date) {
  await lockCourierTrips(db, courierId)
  const [active] = await db.select().from(courierTrips)
    .where(and(eq(courierTrips.courierId, courierId), isNull(courierTrips.completedAt)))
    .orderBy(asc(courierTrips.startedAt)).limit(1)
  if (active) return active
  const [created] = await db.insert(courierTrips).values({ courierId, startedAt }).returning()
  return created!
}

/** Call after changing an order's status, with its order row and courier already
 * locked in this transaction. Closing all idle trips also repairs legacy duplicates. */
export async function closeIdleCourierTrips(db: DbOrTx, courierId: CourierId, completedAt: Date): Promise<void> {
  const [remaining] = await db.select({ id: orders.id }).from(orders)
    .where(and(eq(orders.courierId, courierId), eq(orders.deliveryType, 'DELIVERY'), eq(orders.status, 'ON_THE_WAY')))
    .limit(1)
  if (remaining) return
  await db.update(courierTrips).set({ completedAt })
    .where(and(eq(courierTrips.courierId, courierId), isNull(courierTrips.completedAt)))
}
