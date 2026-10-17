ALTER TABLE "admin2_profiles" ADD COLUMN "articles_read" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "admin2_profiles" ADD COLUMN "articles_write" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "blocks" jsonb;