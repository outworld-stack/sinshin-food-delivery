//src/http/routes/live.routes.ts
import { Elysia, t } from "elysia";

import type { SessionService } from "#/domain/auth/session.service";
import type { Admin2Service } from "#/domain/admin2/admin2.service";
import type { LiveService } from "#/domain/live/live.service";
import type { OrderService } from "#/domain/order/order.service";
import { requireAdmin2 } from "#/http/hooks/require-admin2";

const DISPLAY_PATTERN = "^ord-[a-z0-9]{8}$";
const UUID_PATTERN =
	"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

export interface LiveRoutesDeps {
	sessions: SessionService;
	admin2: Admin2Service;
	live: LiveService;
	orders: OrderService;
}

export const liveRoutes = (deps: LiveRoutesDeps) =>
	new Elysia({ prefix: "/live", tags: ["Live Panel"] })
		.use(requireAdmin2({ sessions: deps.sessions, admin2: deps.admin2 }))

		/**
		 * سشن پنل زنده — round-13: ادمین اصلی هم سشن کامل می‌گیرد
		 * (isAdmin2LoggedIn=true + صف کل) تا همان پنل را مثل ادمین۲ ببیند.
		 * مصرف‌کننده‌های قدیمی فقط برای role==='admin2' به این فیلد نگاه می‌کنند.
		 */
		.get(
			"/session",
			async ({ user, admin2 }) => {
				if (user.role === "admin") {
					return {
						isAdmin2LoggedIn: true,
						admin: {
							userId: user.id,
							firstName: user.name ?? "ادمین اصلی",
							lastName: null,
							permissions: {
								hall: true,
								takeaway: true,
								productsRead: true,
								productsWrite: true,
								usersRead: true,
								usersWrite: true,
								couriersRead: true,
								couriersWrite: true,
								mainCategoriesRead: true,
								mainCategoriesWrite: true,
								orderDetailsRead: true,
								canToggleTemporaryClose: true,
								canEditPackagingFee: true,
							},
						},
						queueCount: await deps.admin2.queueCountFor(user.id, user.role),
					};
				}
				if (user.role !== "admin2" || !admin2) {
					return { isAdmin2LoggedIn: false, admin: null };
				}
				// round-13 — اسم ادمین۲ هم در سشن (قبلاً خالی بود)
				const p = await deps.admin2.profile(user.id);
				return {
					isAdmin2LoggedIn: true,
					admin: {
						userId: user.id,
						firstName: p?.firstName ?? null,
						lastName: p?.lastName ?? null,
						permissions: admin2,
					},
					queueCount: await deps.admin2.queueCountFor(user.id, user.role),
				};
			},
			{
				detail: {
					summary: "Live-panel session + queue count (admin + admin2)",
				},
			},
		)

		/** لیست زنده — صفِ scope + مالِ خودش؛ ادمین اصلی: کل صف + همهٔ فعال‌ها */
		.get("/orders", ({ user }) => deps.live.liveOrders(user.id, user.role), {
			detail: {
				summary:
					"Live orders — queue (scope) + own confirmed; main admin sees all",
				description:
					"Queue = PAID without confirmedBy, filtered by scope (hall=DINE_IN, takeaway=DELIVERY+PICKUP). Own = CONFIRMED/ON_THE_WAY by me. Main admin (role=admin): full queue + ALL active orders. deliveryType drives panel colors (blue/purple/green).",
			},
		})

		/** آمار داشبورد ادمین۲ */
		.get("/stats", ({ user }) => deps.live.admin2Stats(user.id), {
			detail: { summary: "My stats — only orders I confirmed" },
		})

		/** گزینه‌های پیک — مودال تخصیص */
		.get("/couriers", () => deps.live.courierOptions(), {
			detail: { summary: "Active couriers for assignment" },
		})

		/** دیدن نکته‌ی مشتری — قبل از تایید اجباری (ادمین اصلی آزاد) */
		.post(
			"/orders/:displayId/note",
			({ user, params }) =>
				deps.live.viewNote(user.id, user.role, params.displayId),
			{
				params: t.Object({ displayId: t.String({ pattern: DISPLAY_PATTERN }) }),
				detail: { summary: "View customer note (marks noteSeen)" },
			},
		)

		/** تایید سفارش — قلب پنل (ادمین اصلی = scope کامل) */
		.post(
			"/orders/:displayId/confirm",
			({ user, params, body }) =>
				deps.live.confirmOrder(user.id, user.role, params.displayId, {
					courierId: body.courierId ?? null,
					courierNote: body.courierNote ?? null,
					notePrintOnInvoice: body.notePrintOnInvoice ?? false,
					securityEnabled: body.securityEnabled ?? false,
				}),
			{
				params: t.Object({ displayId: t.String({ pattern: DISPLAY_PATTERN }) }),
				body: t.Object({
					courierId: t.Optional(
						t.Nullable(t.String({ pattern: UUID_PATTERN })),
					),
					courierNote: t.Optional(t.Nullable(t.String({ maxLength: 300 }))),
					/** round-14 — یادداشت روی فاکتور فروش (بیرون‌بر) چاپ شود؟ */
					notePrintOnInvoice: t.Optional(t.Boolean()),
					/** امنیت احراز پیک — پیش‌فرض خاموش */
					securityEnabled: t.Optional(t.Boolean()),
				}),
				detail: {
					summary: "Confirm order — ownership + courier + print queue",
					description:
						"Requires noteSeen when customerNote exists. scope-checked. securityEnabled=false by default (open QR scan). notePrintOnInvoice: print the admin note on the sales (takeaway) invoice.",
				},
			},
		)

		/** تغییر/تخصیص پیک — تا قبل از رسیدن (ادمین اصلی: هر سفارشی) */
		.post(
			"/orders/:displayId/reassign",
			({ user, params, body }) =>
				deps.live.reassignCourier(
					user.id,
					user.role,
					params.displayId,
					body.courierId ?? null,
				),
			{
				params: t.Object({ displayId: t.String({ pattern: DISPLAY_PATTERN }) }),
				body: t.Object({
					courierId: t.Optional(
						t.Nullable(t.String({ pattern: UUID_PATTERN })),
					),
				}),
				detail: { summary: "Reassign courier (before arrival only)" },
			},
		)

		/** جزئیات سفارش — نقش‌محور */
		.get(
			"/orders/:displayId",
			({ user, params }) =>
				deps.live.orderDetail(user.id, user.role, params.displayId),
			{
				params: t.Object({ displayId: t.String({ pattern: DISPLAY_PATTERN }) }),
				detail: { summary: "Order detail (role-aware)" },
			},
		)

		/**
		 * round-12 — دیتای فاکتور چاپی (اشپزخانه + فروش) برای پنل.
		 * ادمین اصلی و ادمین‌های سطح ۲ (تاییدکنندهٔ سفارش) — سند عملیاتی
		 * مشتری/آشپزخانه/پیک است؛ ریز سود داخلی ندارد.
		 */
		.get(
			"/orders/:displayId/invoice",
			({ params }) => deps.orders.invoiceForStaff(params.displayId),
			{
				params: t.Object({ displayId: t.String({ pattern: DISPLAY_PATTERN }) }),
				detail: {
					summary: "Invoice print data — kitchen + sales (staff)",
					description:
						"Full print payload: items with prices, breakdown, customer info, delivery type/address and courier fields for the sales QR. No ownership check — staff route.",
				},
			},
		);
