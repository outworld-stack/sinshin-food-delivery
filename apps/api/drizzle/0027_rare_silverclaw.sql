ALTER TABLE "article_categories" ADD COLUMN "translation_state" jsonb;--> statement-breakpoint
ALTER TABLE "article_sub_categories" ADD COLUMN "translation_state" jsonb;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "translation_state" jsonb;--> statement-breakpoint
ALTER TABLE "gallery_images" ADD COLUMN "translation_state" jsonb;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "translation_state" jsonb;--> statement-breakpoint
ALTER TABLE "main_categories" ADD COLUMN "translation_state" jsonb;--> statement-breakpoint
ALTER TABLE "packaging_items" ADD COLUMN "translation_state" jsonb;--> statement-breakpoint
ALTER TABLE "product_sizes" ADD COLUMN "translation_state" jsonb;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "translation_state" jsonb;--> statement-breakpoint
ALTER TABLE "content_about" ADD COLUMN "translation_state" jsonb;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "translation_state" jsonb;--> statement-breakpoint
ALTER TABLE "terms" ADD COLUMN "translation_state" jsonb;