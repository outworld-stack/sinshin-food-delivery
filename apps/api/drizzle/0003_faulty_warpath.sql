ALTER TABLE "coupon_nudges" ADD COLUMN "remaining_count" integer;--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "max_per_user" integer DEFAULT 0 NOT NULL;