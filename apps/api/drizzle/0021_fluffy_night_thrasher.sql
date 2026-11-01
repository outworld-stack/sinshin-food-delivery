CREATE TABLE "product_daily_stats" (
	"product_id" uuid NOT NULL,
	"day" date NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"cart_adds" integer DEFAULT 0 NOT NULL,
	"orders" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_daily_stats_product_id_day_pk" PRIMARY KEY("product_id","day")
);
--> statement-breakpoint
CREATE TABLE "product_view_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"visitor_id" varchar(64) NOT NULL,
	"day" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "product_daily_stats_day_idx" ON "product_daily_stats" USING btree ("day");--> statement-breakpoint
CREATE INDEX "product_view_log_product_idx" ON "product_view_log" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_view_log_day_idx" ON "product_view_log" USING btree ("day");--> statement-breakpoint
CREATE INDEX "product_view_log_visitor_idx" ON "product_view_log" USING btree ("visitor_id");