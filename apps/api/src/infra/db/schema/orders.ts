//src/infra/db/schema/orders.ts
import {
	boolean,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";
import type {
	CampaignId,
	CourierId,
	OrderId,
	ProductId,
	SizeId,
} from "#/domain/shared/brand";
import { users } from "./users";
import { addresses } from "./addresses";
import { couriers } from "./couriers";

/**
 * وضعیت‌ها:
 *  PENDING_PAYMENT → PAID (پرداخت موفق) → CONFIRMED (تایید ادمین۲) → ON_THE_WAY (اسکن پیک) → DELIVERED (تحویل مشتری)
 *  CANCELED = پایان ناموفق (پرداخت ناموفق) — قرارداد فرانت.
 *
 * «صف» = PAID بدون confirmedBy — وضعیت نمایشی، بدون سد: هر PAID بلافاصله قابل تایید است.
 * queuedAt فقط گزارشی است: «در زمان بسته ثبت شد».
 */
export const orderStatusEnum = pgEnum("order_status", [
	"PENDING_PAYMENT",
	"PAID",
	"CONFIRMED",
	"ON_THE_WAY",
	"DELIVERED",
	"CANCELED",
]);

/**
 * سه نوع تحویل — قرارداد جدید:
 *  DELIVERY → پیک (آبی در پنل)         → scope takeaway
 *  PICKUP   → بسته‌بندی، بردن با خود (بنفش) → scope takeaway
 *  DINE_IN  → سرو در سالن (سبز)          → scope hall
 */
export const deliveryTypeEnum = pgEnum("delivery_type", [
	"DELIVERY",
	"PICKUP",
	"DINE_IN",
]);

export type OrderBreakdown = {
	foodTotal: number;
	discount: number;
	walletDeduction: number;
	deliveryFee: number;
	packagingFee: number;
	totalAmount: number;
	amountPaidOnline: number;
};

export const orders = pgTable(
	"orders",
	{
		id: uuid("id").primaryKey().defaultRandom().$type<OrderId>(),
		displayId: varchar("display_id", { length: 20 }).notNull(),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id),
		status: orderStatusEnum("status").notNull().default("PENDING_PAYMENT"),

		deliveryType: deliveryTypeEnum("delivery_type").notNull(),
		addressId: uuid("address_id").references(() => addresses.id, {
			onDelete: "set null",
		}),
		addressSnapshot: text("address_snapshot"),

		customerNote: varchar("customer_note", { length: 300 }),
		internalNote: varchar("internal_note", { length: 300 }),
		noteSeen: boolean("note_seen").notNull().default(true),
		/** round-14 — یادداشت ادمین تاییدکننده روی فاکتور فروش (بیرون‌بر) چاپ شود؟ */
		internalNotePrint: boolean("internal_note_print").notNull().default(false),

		/** تاییدکننده — ادمین۲ (مالکیت سفارش) */
		confirmedBy: uuid("confirmed_by").references(() => users.id),
		courierId: uuid("courier_id")
			.$type<CourierId>()
			.references(() => couriers.id, { onDelete: "set null" }),
		courierSecurityEnabled: boolean("courier_security_enabled")
			.notNull()
			.default(false),
		courierArrivedAt: timestamp("courier_arrived_at", { withTimezone: true }),
		deliveredAt: timestamp("delivered_at", { withTimezone: true }),

		paymentStatus: varchar("payment_status", { length: 20 })
			.notNull()
			.default("PENDING"),
		paymentMethod: varchar("payment_method", { length: 20 })
			.notNull()
			.default("GATEWAY"),
		totalAmount: integer("total_amount").notNull(),
		breakdown: jsonb("breakdown").$type<OrderBreakdown>().notNull(),
		couponId: uuid("coupon_id").$type<CampaignId>(),

		/** snapshot لحظه‌ی ثبت — سفارش‌های قبل از فعال‌سازی ردیابی نمی‌گیرند */
		trackingEnabled: boolean("tracking_enabled").notNull().default(false),
		courierLocation: jsonb("courier_location").$type<{
			lat: number;
			lng: number;
		}>(),
		customerLocation: jsonb("customer_location").$type<{
			lat: number;
			lng: number;
		}>(),

		/** فقط گزارشی: «در زمان بسته بودن ثبت شد» — هیچ سدی نیست */
		queuedAt: timestamp("queued_at", { withTimezone: true }),

		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		uniqueIndex("orders_display_id_key").on(t.displayId),
		index("orders_user_idx").on(t.userId),
		index("orders_status_idx").on(t.status),
		index("orders_created_idx").on(t.createdAt),
		index("orders_confirmed_by_idx").on(t.confirmedBy),
		index("orders_courier_idx").on(t.courierId),
		index("orders_queued_idx").on(t.queuedAt),
		/** پنل زنده: لیست صف بر اساس (status, deliveryType) */
		index("orders_live_idx").on(t.status, t.deliveryType),
		/** round-16 — سفارش‌های مشتری (myOrders/myOrdersLight/پروفایل):
		 *  where user_id=… order by created_at desc — ایندکس تک‌ستونی user مجبور به sort کل ردیف‌های کاربر می‌کرد */
		index("orders_user_created_idx").on(t.userId, t.createdAt),
	],
);

export const orderItems = pgTable(
	"order_items",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		orderId: uuid("order_id")
			.notNull()
			.$type<OrderId>()
			.references(() => orders.id, { onDelete: "cascade" }),
		productId: uuid("product_id").$type<ProductId>(),
		sizeId: uuid("size_id").$type<SizeId>(),
		name: varchar("name", { length: 120 }).notNull(),
		sizeName: varchar("size_name", { length: 60 }),
		unitPrice: integer("unit_price").notNull(),
		quantity: integer("quantity").notNull(),
	},
	(t) => [
		index("order_items_order_idx").on(t.orderId),
		index("order_items_product_idx").on(t.productId),
	],
);

export type OrderRow = typeof orders.$inferSelect;
export type OrderItemRow = typeof orderItems.$inferSelect;
