CREATE TYPE "public"."coupon_condition_mode" AS ENUM('AND', 'OR');--> statement-breakpoint
CREATE TYPE "public"."coupon_discount_scope" AS ENUM('ALL_PRODUCTS', 'CATEGORY', 'PRODUCT');--> statement-breakpoint
ALTER TYPE "public"."coupon_condition_type" ADD VALUE 'FIRST_PURCHASE' BEFORE 'MIN_ORDERS_COUNT';--> statement-breakpoint
CREATE TABLE "first_purchase_reservations" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "condition_mode" "coupon_condition_mode" DEFAULT 'AND' NOT NULL;--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "discount_scope" "coupon_discount_scope" DEFAULT 'ALL_PRODUCTS' NOT NULL;--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "discount_category_id" uuid;--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "discount_product_id" uuid;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "coupon_discount_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "coupon_eligible_subtotal" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "first_purchase_reservations" ADD CONSTRAINT "first_purchase_reservations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "first_purchase_reservations" ADD CONSTRAINT "first_purchase_reservations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "first_purchase_reservations_order_key" ON "first_purchase_reservations" USING btree ("order_id");--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_discount_category_id_categories_id_fk" FOREIGN KEY ("discount_category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_discount_product_id_products_id_fk" FOREIGN KEY ("discount_product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_discount_scope_target_check" CHECK (
      ("coupons"."discount_scope" = 'ALL_PRODUCTS' and "coupons"."discount_category_id" is null and "coupons"."discount_product_id" is null)
      or ("coupons"."discount_scope" = 'CATEGORY' and "coupons"."discount_category_id" is not null and "coupons"."discount_product_id" is null)
      or ("coupons"."discount_scope" = 'PRODUCT' and "coupons"."discount_product_id" is not null and "coupons"."discount_category_id" is null)
    );