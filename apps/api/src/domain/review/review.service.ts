// src/domain/review/review.service.ts
import { and, desc, eq, sql } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import { orderItems, orders, products, reviews, users } from '#/infra/db/schema'
import { asProductId, asReviewId, asUserId } from '#/domain/shared/brand'
import { Err } from '#/domain/shared/errors'

const DISPLAY_RE = /^ord-[a-z0-9]{8}$/

/** ماسک شماره در API عمومی — شماره کامل فقط برای ادمین */
const maskPhone = (p: string): string =>
  p.length >= 7 ? `${p.slice(0, 4)}***${p.slice(-3)}` : '***'

/**
 * نظرات — سه‌حالته با مودریشن.
 * ثبت: فقط بعد از DELIVERED + فقط محصولِ همان سفارش + یک‌بار (unique).
 */
export class ReviewService {
  constructor(private readonly deps: { db: Db }) { }

  /** ثبت نظر مشتری — به‌ازای محصول انتخابی */
  async submit(userId: string, displayId: string, productId: string, feedback: string): Promise<{ success: boolean; message?: string }> {
    if (!DISPLAY_RE.test(displayId)) throw Err.notFound('سفارش پیدا نشد.')
    const order = (await this.deps.db.select().from(orders).where(eq(orders.displayId, displayId)))[0]
    if (!order || order.userId !== userId) throw Err.notFound('سفارش پیدا نشد.')
    if (order.status !== 'DELIVERED') {
      return { success: false, message: 'نظر فقط بعد از تحویل سفارش قابل ثبت است' }
    }

    const items = await this.deps.db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id))
    const pid = asProductId(productId)
    const item = items.find((i) => i.productId === pid)
    if (!item) return { success: false, message: 'این محصول در سفارش شما نیست' }

    const already = await this.deps.db.query.reviews.findFirst({
      where: and(eq(reviews.orderId, order.id), eq(reviews.productId, pid)),
    })
    if (already) return { success: false, message: 'برای این محصول قبلاً نظر ثبت کرده‌اید' }

    await this.deps.db.insert(reviews).values({
      orderId: order.id,
      productId: pid,
      userId: asUserId(userId),
      comment: feedback.slice(0, 500),
    })
    return { success: true }
  }

  /** محصولاتی از این سفارش که نظر ثبت شده — جلوگیری از تکرار در UI */
  async reviewedProducts(userId: string, displayId: string): Promise<{ productIds: string[] }> {
    if (!DISPLAY_RE.test(displayId)) throw Err.notFound('سفارش پیدا نشد.')
    const order = (await this.deps.db.select().from(orders).where(eq(orders.displayId, displayId)))[0]
    if (!order || order.userId !== userId) throw Err.notFound('سفارش پیدا نشد.')
    const rows = await this.deps.db
      .select({ productId: reviews.productId })
      .from(reviews)
      .where(eq(reviews.orderId, order.id))
    return { productIds: rows.map((r) => r.productId) }
  }

  /** همه‌ی نظرات برای مودریشن ادمین */
  async adminList(status?: 'pending' | 'approved' | 'rejected') {
    const rows = await this.deps.db
      .select({ r: reviews, u: users, p: products, o: orders })
      .from(reviews)
      .innerJoin(users, eq(users.id, reviews.userId))
      .innerJoin(products, eq(products.id, reviews.productId))
      .innerJoin(orders, eq(orders.id, reviews.orderId))
      .where(status ? eq(reviews.status, status) : sql`true`)
      .orderBy(desc(reviews.createdAt))
      // round-16 — سقف دفاعی: تنها لیست بی‌سقف باقی‌مانده بود؛ نظرات با تحویل‌ها
      // برای همیشه رشد می‌کنند و صفحهٔ مودریشن ادمین کل آن را می‌کشید
      .limit(300)

    return rows.map(({ r, u, p, o }) => ({
      id: r.id,
      orderId: o.displayId,
      productId: p.id,
      productName: p.name,
      firstName: (u.name ?? '').split(' ')[0] ?? null,
      lastName: (u.name ?? '').split(' ').slice(1).join(' ') || null,
      phone: u.phone,
      comment: r.comment,
      date: r.createdAt,
      status: r.status,
    }))
  }

  /** نظرات تاییدشده‌ی یک محصول — صفحه‌ی محصول (public) */
  async approvedByProduct(productId: string) {
    const rows = await this.deps.db
      .select({ r: reviews, u: users })
      .from(reviews)
      .innerJoin(users, eq(users.id, reviews.userId))
      .where(and(eq(reviews.productId, asProductId(productId)), eq(reviews.status, 'approved')))
      .orderBy(desc(reviews.createdAt))
      // round-16 — سقف نمایش عمومی (جدیدترین‌ها)
      .limit(100)
    return rows.map(({ r, u }) => ({
      id: r.id,
      orderId: r.orderId,
      productId: r.productId,
      productName: null,
      firstName: (u.name ?? '').split(' ')[0] ?? null,
      lastName: (u.name ?? '').split(' ').slice(1).join(' ') || null,
      phone: maskPhone(u.phone),
      comment: r.comment,
      date: r.createdAt,
      status: r.status,
    }))
  }

  /** مودریشن — تایید/رد */
  async moderate(reviewId: string, action: 'approve' | 'reject'): Promise<{ success: boolean }> {
    const [updated] = await this.deps.db
      .update(reviews)
      .set({ status: action === 'approve' ? 'approved' : 'rejected', moderatedAt: new Date() })
      .where(eq(reviews.id, asReviewId(reviewId)))
      .returning()
    if (!updated) throw Err.notFound('نظر پیدا نشد.')
    return { success: true }
  }
}