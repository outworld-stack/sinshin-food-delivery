ALTER TABLE "coupon_nudges" ALTER COLUMN "remaining_count" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "checkout_idempotency" ADD COLUMN "request_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "checkout_idempotency" ADD COLUMN "claim_token" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
-- Older deployments allowed orphan coupon references after concurrent deletion.
-- Preserve every order and its pricing snapshot while removing only dead links.
UPDATE "orders" SET "coupon_id" = NULL
WHERE "coupon_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "coupons" WHERE "coupons"."id" = "orders"."coupon_id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE set null ON UPDATE no action;
