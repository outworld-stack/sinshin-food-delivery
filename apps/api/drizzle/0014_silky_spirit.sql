ALTER TABLE "categories" ADD COLUMN "purchase_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "main_categories" ADD COLUMN "purchase_enabled" boolean DEFAULT true NOT NULL;