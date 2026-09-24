CREATE TYPE "public"."admin2_scope" AS ENUM('hall', 'takeaway');--> statement-breakpoint
CREATE TYPE "public"."coupon_condition_type" AS ENUM('MIN_ORDERS_COUNT', 'MIN_TOTAL_SPEND', 'MIN_PRODUCT_ORDERS', 'MIN_CATEGORY_ORDERS', 'REGISTERED_DAYS_AGO', 'MIN_REFERRALS', 'MIN_REFERRAL_ORDERS', 'MIN_REFERRAL_SPEND', 'ORDERS_IN_LAST_DAYS');--> statement-breakpoint
CREATE TYPE "public"."delivery_type" AS ENUM('DELIVERY', 'PICKUP', 'DINE_IN');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('PENDING_PAYMENT', 'PAID', 'CONFIRMED', 'ON_THE_WAY', 'DELIVERED', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."wallet_tx_type" AS ENUM('DEPOSIT', 'WITHDRAW');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(60) NOT NULL,
	"address" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin2_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"action" varchar(30) NOT NULL,
	"order_display_id" varchar(20),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin2_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"first_name" text,
	"last_name" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"orders_confirmed" integer DEFAULT 0 NOT NULL,
	"scope_hall" boolean DEFAULT false NOT NULL,
	"scope_takeaway" boolean DEFAULT false NOT NULL,
	"products_read" boolean DEFAULT false NOT NULL,
	"products_write" boolean DEFAULT false NOT NULL,
	"users_read" boolean DEFAULT false NOT NULL,
	"users_write" boolean DEFAULT false NOT NULL,
	"couriers_read" boolean DEFAULT false NOT NULL,
	"couriers_write" boolean DEFAULT false NOT NULL,
	"main_categories_read" boolean DEFAULT false NOT NULL,
	"main_categories_write" boolean DEFAULT false NOT NULL,
	"order_details_read" boolean DEFAULT false NOT NULL,
	"can_toggle_temporary_close" boolean DEFAULT false NOT NULL,
	"can_edit_packaging_fee" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin2_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"login_at" timestamp with time zone DEFAULT now() NOT NULL,
	"logout_at" timestamp with time zone,
	"was_active" boolean DEFAULT false NOT NULL,
	"last_activity_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "article_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(60) NOT NULL,
	"slug" varchar(60) NOT NULL,
	"has_sub_categories" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "article_sub_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"name" varchar(60) NOT NULL,
	"slug" varchar(60) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(160) NOT NULL,
	"excerpt" text NOT NULL,
	"content" text NOT NULL,
	"author" varchar(120) DEFAULT 'سین شین' NOT NULL,
	"category_id" uuid NOT NULL,
	"sub_category_id" uuid,
	"profile_image" text,
	"gallery_images" jsonb DEFAULT '[]'::jsonb,
	"processes" jsonb DEFAULT '[]'::jsonb,
	"views" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"actor_id" uuid,
	"action" varchar(60) NOT NULL,
	"entity" varchar(40),
	"entity_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"ip" varchar(45),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coupon_conditions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coupon_id" uuid NOT NULL,
	"type" "coupon_condition_type" NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coupon_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coupon_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "coupon_nudges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"coupon_id" uuid NOT NULL,
	"missing_condition_id" uuid NOT NULL,
	"missing_count" integer,
	"scan_date" date NOT NULL,
	"sms_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coupon_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coupon_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"order_id" uuid,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(32) NOT NULL,
	"title" varchar(120),
	"discount_percentage" integer NOT NULL,
	"max_uses" integer DEFAULT 0 NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courier_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"address_snapshot" text NOT NULL,
	"delivered_at" timestamp with time zone NOT NULL,
	"amount" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courier_trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"courier_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "couriers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"phone" varchar(11) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_zones" (
	"id" integer PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY (sequence name "delivery_zones_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"radius_km" double precision NOT NULL,
	"fee" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"phone" varchar(11),
	"event" varchar(30) NOT NULL,
	"ip" varchar(45),
	"user_agent" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"phone" varchar(11) NOT NULL,
	"relation" varchar(20) DEFAULT 'SECONDARY' NOT NULL,
	"first_login_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "device_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_a" uuid NOT NULL,
	"device_b" uuid NOT NULL,
	"similarity" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" varchar(64),
	"fingerprint_hash" varchar(64) NOT NULL,
	"canvas_hash" varchar(64) NOT NULL,
	"webgl_hash" varchar(64) NOT NULL,
	"audio_hash" varchar(64) NOT NULL,
	"fonts_hash" varchar(64) NOT NULL,
	"screen" varchar(40),
	"platform" varchar(60),
	"timezone" varchar(60),
	"language" varchar(20),
	"hardware_concurrency" integer,
	"device_memory" integer,
	"touch" boolean DEFAULT false NOT NULL,
	"network_type" varchar(20),
	"user_agent" text,
	"label" varchar(100),
	"risk_score" integer DEFAULT 0 NOT NULL,
	"risk_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_blocked" boolean DEFAULT false NOT NULL,
	"blocked_at" timestamp with time zone,
	"blocked_reason" varchar(120),
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gallery_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"src" text NOT NULL,
	"alt" text NOT NULL,
	"span" varchar(10) DEFAULT 'normal' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" varchar(11) NOT NULL,
	"name" text,
	"email" text,
	"role" varchar(20) DEFAULT 'user' NOT NULL,
	"token_version" integer DEFAULT 0 NOT NULL,
	"banned_at" timestamp with time zone,
	"suspended_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"referral_code" varchar(16),
	"referred_by" uuid,
	"terms_accepted_at" timestamp with time zone,
	"terms_version" varchar(20),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"refresh_hash" varchar(64) NOT NULL,
	"previous_refresh_hash" varchar(64),
	"ip" varchar(45),
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" varchar(30)
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"main_category_id" uuid NOT NULL,
	"name" varchar(60) NOT NULL,
	"slug" varchar(60) NOT NULL,
	"has_sizes" boolean DEFAULT false NOT NULL,
	"size_names" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "main_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(60) NOT NULL,
	"slug" varchar(60) NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_sizes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"name" varchar(60) NOT NULL,
	"price" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"original_price" integer DEFAULT 0 NOT NULL,
	"discount_percentage" integer DEFAULT 0 NOT NULL,
	"prep_time" integer DEFAULT 15 NOT NULL,
	"sizes_enabled" boolean DEFAULT false NOT NULL,
	"packaging_cost" integer DEFAULT 0 NOT NULL,
	"ingredients" jsonb DEFAULT '[]'::jsonb,
	"profile_image" text,
	"gallery_images" jsonb DEFAULT '[]'::jsonb,
	"views" integer DEFAULT 0 NOT NULL,
	"sales" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid,
	"size_id" uuid,
	"name" varchar(120) NOT NULL,
	"size_name" varchar(60),
	"unit_price" integer NOT NULL,
	"quantity" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_id" varchar(20) NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "order_status" DEFAULT 'PENDING_PAYMENT' NOT NULL,
	"delivery_type" "delivery_type" NOT NULL,
	"address_id" uuid,
	"address_snapshot" text,
	"customer_note" varchar(300),
	"internal_note" varchar(300),
	"note_seen" boolean DEFAULT true NOT NULL,
	"internal_note_print" boolean DEFAULT false NOT NULL,
	"confirmed_by" uuid,
	"courier_id" uuid,
	"courier_security_enabled" boolean DEFAULT false NOT NULL,
	"courier_arrived_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"payment_status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"payment_method" varchar(20) DEFAULT 'GATEWAY' NOT NULL,
	"total_amount" integer NOT NULL,
	"breakdown" jsonb NOT NULL,
	"coupon_id" uuid,
	"tracking_enabled" boolean DEFAULT false NOT NULL,
	"courier_location" jsonb,
	"customer_location" jsonb,
	"queued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_about" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"hero_title" text NOT NULL,
	"hero_text" text NOT NULL,
	"hero_gradient" text NOT NULL,
	"team_title" text NOT NULL,
	"team_gradient" text NOT NULL,
	"team_alt" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" varchar(60) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"sections" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"gateway" varchar(30) NOT NULL,
	"mode" varchar(20) NOT NULL,
	"amount" integer NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"gateway_ref" varchar(120),
	"callback_url" text,
	"webhook_signature" varchar(64),
	"verified_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_profits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"base_amount" integer NOT NULL,
	"percent" integer DEFAULT 10 NOT NULL,
	"amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "wallet_tx_type" NOT NULL,
	"amount" integer NOT NULL,
	"description" varchar(200) NOT NULL,
	"order_id" uuid,
	"referral_profit_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"comment" text NOT NULL,
	"status" "review_status" DEFAULT 'pending' NOT NULL,
	"moderated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconcile_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"check_id" varchar(10) NOT NULL,
	"severity" varchar(12) NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"entity_type" varchar(16) NOT NULL,
	"entity_id" varchar(64) NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"occurrences" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin2_activities" ADD CONSTRAINT "admin2_activities_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin2_profiles" ADD CONSTRAINT "admin2_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin2_sessions" ADD CONSTRAINT "admin2_sessions_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_sub_categories" ADD CONSTRAINT "article_sub_categories_category_id_article_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."article_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_category_id_article_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."article_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_sub_category_id_article_sub_categories_id_fk" FOREIGN KEY ("sub_category_id") REFERENCES "public"."article_sub_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_conditions" ADD CONSTRAINT "coupon_conditions_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_grants" ADD CONSTRAINT "coupon_grants_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_grants" ADD CONSTRAINT "coupon_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_nudges" ADD CONSTRAINT "coupon_nudges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_nudges" ADD CONSTRAINT "coupon_nudges_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_nudges" ADD CONSTRAINT "coupon_nudges_missing_condition_id_coupon_conditions_id_fk" FOREIGN KEY ("missing_condition_id") REFERENCES "public"."coupon_conditions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courier_deliveries" ADD CONSTRAINT "courier_deliveries_trip_id_courier_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."courier_trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courier_trips" ADD CONSTRAINT "courier_trips_courier_id_couriers_id_fk" FOREIGN KEY ("courier_id") REFERENCES "public"."couriers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_events" ADD CONSTRAINT "device_events_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_identities" ADD CONSTRAINT "device_identities_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_links" ADD CONSTRAINT "device_links_device_a_devices_id_fk" FOREIGN KEY ("device_a") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_links" ADD CONSTRAINT "device_links_device_b_devices_id_fk" FOREIGN KEY ("device_b") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_referred_by_users_id_fk" FOREIGN KEY ("referred_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_main_category_id_main_categories_id_fk" FOREIGN KEY ("main_category_id") REFERENCES "public"."main_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_sizes" ADD CONSTRAINT "product_sizes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_address_id_addresses_id_fk" FOREIGN KEY ("address_id") REFERENCES "public"."addresses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_courier_id_couriers_id_fk" FOREIGN KEY ("courier_id") REFERENCES "public"."couriers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_profits" ADD CONSTRAINT "referral_profits_referrer_id_users_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_profits" ADD CONSTRAINT "referral_profits_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_profits" ADD CONSTRAINT "referral_profits_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_referral_profit_id_referral_profits_id_fk" FOREIGN KEY ("referral_profit_id") REFERENCES "public"."referral_profits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "addresses_user_idx" ON "addresses" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "admin2_activities_admin_idx" ON "admin2_activities" USING btree ("admin_user_id","created_at");--> statement-breakpoint
CREATE INDEX "admin2_activities_action_idx" ON "admin2_activities" USING btree ("action");--> statement-breakpoint
CREATE INDEX "admin2_active_idx" ON "admin2_profiles" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "admin2_sessions_admin_idx" ON "admin2_sessions" USING btree ("admin_user_id");--> statement-breakpoint
CREATE INDEX "admin2_sessions_login_idx" ON "admin2_sessions" USING btree ("login_at");--> statement-breakpoint
CREATE UNIQUE INDEX "article_categories_slug_key" ON "article_categories" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "article_sub_slug_key" ON "article_sub_categories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "article_sub_category_idx" ON "article_sub_categories" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "articles_category_idx" ON "articles" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "articles_status_idx" ON "articles" USING btree ("status");--> statement-breakpoint
CREATE INDEX "articles_created_idx" ON "articles" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_user_idx" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_actor_created_idx" ON "audit_logs" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "conditions_coupon_idx" ON "coupon_conditions" USING btree ("coupon_id");--> statement-breakpoint
CREATE UNIQUE INDEX "grants_coupon_user_key" ON "coupon_grants" USING btree ("coupon_id","user_id");--> statement-breakpoint
CREATE INDEX "grants_user_idx" ON "coupon_grants" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "nudges_once_per_day" ON "coupon_nudges" USING btree ("user_id","coupon_id","scan_date");--> statement-breakpoint
CREATE INDEX "nudges_pending_idx" ON "coupon_nudges" USING btree ("scan_date","sms_sent_at");--> statement-breakpoint
CREATE INDEX "redemptions_coupon_idx" ON "coupon_redemptions" USING btree ("coupon_id");--> statement-breakpoint
CREATE INDEX "redemptions_user_idx" ON "coupon_redemptions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons" USING btree ("code");--> statement-breakpoint
CREATE INDEX "coupons_active_idx" ON "coupons" USING btree ("is_active","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "courier_deliveries_trip_idx" ON "courier_deliveries" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "courier_deliveries_order_idx" ON "courier_deliveries" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "courier_deliveries_delivered_idx" ON "courier_deliveries" USING btree ("delivered_at");--> statement-breakpoint
CREATE INDEX "courier_trips_courier_idx" ON "courier_trips" USING btree ("courier_id");--> statement-breakpoint
CREATE INDEX "courier_trips_started_idx" ON "courier_trips" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "couriers_phone_key" ON "couriers" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "couriers_active_idx" ON "couriers" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_zones_radius_key" ON "delivery_zones" USING btree ("radius_km");--> statement-breakpoint
CREATE INDEX "delivery_zones_radius_idx" ON "delivery_zones" USING btree ("radius_km");--> statement-breakpoint
CREATE INDEX "device_events_device_idx" ON "device_events" USING btree ("device_id","created_at");--> statement-breakpoint
CREATE INDEX "device_events_event_idx" ON "device_events" USING btree ("event");--> statement-breakpoint
CREATE INDEX "device_events_phone_created_idx" ON "device_events" USING btree ("phone","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "device_identities_key" ON "device_identities" USING btree ("device_id","phone");--> statement-breakpoint
CREATE INDEX "device_identities_phone_idx" ON "device_identities" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "device_links_pair_key" ON "device_links" USING btree ("device_a","device_b");--> statement-breakpoint
CREATE INDEX "device_links_a_idx" ON "device_links" USING btree ("device_a");--> statement-breakpoint
CREATE INDEX "device_links_b_idx" ON "device_links" USING btree ("device_b");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_fingerprint_hash_key" ON "devices" USING btree ("fingerprint_hash");--> statement-breakpoint
CREATE INDEX "devices_client_id_idx" ON "devices" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "devices_last_seen_idx" ON "devices" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "devices_blocked_idx" ON "devices" USING btree ("is_blocked");--> statement-breakpoint
CREATE INDEX "devices_risk_idx" ON "devices" USING btree ("risk_score");--> statement-breakpoint
CREATE INDEX "gallery_order_idx" ON "gallery_images" USING btree ("is_active","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_key" ON "users" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "users_token_version_idx" ON "users" USING btree ("token_version");--> statement-breakpoint
CREATE UNIQUE INDEX "users_referral_code_key" ON "users" USING btree ("referral_code");--> statement-breakpoint
CREATE INDEX "users_referred_by_idx" ON "users" USING btree ("referred_by");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_refresh_hash_key" ON "sessions" USING btree ("refresh_hash");--> statement-breakpoint
CREATE INDEX "sessions_prev_hash_idx" ON "sessions" USING btree ("previous_refresh_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_device_idx" ON "sessions" USING btree ("device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_slug_key" ON "categories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "categories_main_idx" ON "categories" USING btree ("main_category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "main_categories_slug_key" ON "main_categories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "main_categories_order_idx" ON "main_categories" USING btree ("is_active","sort_order");--> statement-breakpoint
CREATE INDEX "product_sizes_product_idx" ON "product_sizes" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_sizes_product_name_key" ON "product_sizes" USING btree ("product_id","name");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "products_status_idx" ON "products" USING btree ("status");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_product_idx" ON "order_items" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_display_id_key" ON "orders" USING btree ("display_id");--> statement-breakpoint
CREATE INDEX "orders_user_idx" ON "orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "orders_created_idx" ON "orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "orders_confirmed_by_idx" ON "orders" USING btree ("confirmed_by");--> statement-breakpoint
CREATE INDEX "orders_courier_idx" ON "orders" USING btree ("courier_id");--> statement-breakpoint
CREATE INDEX "orders_queued_idx" ON "orders" USING btree ("queued_at");--> statement-breakpoint
CREATE INDEX "orders_live_idx" ON "orders" USING btree ("status","delivery_type");--> statement-breakpoint
CREATE INDEX "orders_user_created_idx" ON "orders" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_queue_partial_idx" ON "orders" USING btree ("created_at") WHERE "orders"."status" = 'PAID' and "orders"."confirmed_by" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "terms_version_key" ON "terms" USING btree ("version");--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payments_user_idx" ON "payments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payments_ref_idx" ON "payments" USING btree ("gateway_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_profits_referrer_order_key" ON "referral_profits" USING btree ("referrer_id","order_id");--> statement-breakpoint
CREATE INDEX "referral_profits_referrer_idx" ON "referral_profits" USING btree ("referrer_id");--> statement-breakpoint
CREATE INDEX "referral_profits_buyer_idx" ON "referral_profits" USING btree ("buyer_id");--> statement-breakpoint
CREATE INDEX "wallet_tx_user_created_idx" ON "wallet_transactions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "wallet_tx_user_type_amount_idx" ON "wallet_transactions" USING btree ("user_id","type","amount");--> statement-breakpoint
CREATE INDEX "wallet_tx_order_idx" ON "wallet_transactions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "wallet_tx_created_idx" ON "wallet_transactions" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_tx_withdraw_once_key" ON "wallet_transactions" USING btree ("order_id") WHERE type = 'WITHDRAW' and referral_profit_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_tx_reversal_once_key" ON "wallet_transactions" USING btree ("referral_profit_id") WHERE type = 'WITHDRAW' and referral_profit_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_order_product_key" ON "reviews" USING btree ("order_id","product_id");--> statement-breakpoint
CREATE INDEX "reviews_product_status_idx" ON "reviews" USING btree ("product_id","status");--> statement-breakpoint
CREATE INDEX "reviews_status_idx" ON "reviews" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "reconcile_finding_key" ON "reconcile_findings" USING btree ("check_id","entity_id");--> statement-breakpoint
CREATE INDEX "reconcile_finding_status_idx" ON "reconcile_findings" USING btree ("status","severity","first_seen_at");