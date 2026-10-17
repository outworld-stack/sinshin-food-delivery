CREATE TABLE "packaging_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(60) NOT NULL,
	"title_ar" varchar(60),
	"price" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_packaging_items" (
	"product_id" uuid NOT NULL,
	"packaging_item_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_packaging_items_product_id_packaging_item_id_pk" PRIMARY KEY("product_id","packaging_item_id")
);
--> statement-breakpoint
ALTER TABLE "admin2_profiles" ADD COLUMN "can_announce_busy" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "product_packaging_items" ADD CONSTRAINT "product_packaging_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_packaging_items" ADD CONSTRAINT "product_packaging_items_packaging_item_id_packaging_items_id_fk" FOREIGN KEY ("packaging_item_id") REFERENCES "public"."packaging_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "packaging_items_active_idx" ON "packaging_items" USING btree ("is_active","sort_order");--> statement-breakpoint
CREATE INDEX "product_packaging_items_item_idx" ON "product_packaging_items" USING btree ("packaging_item_id");