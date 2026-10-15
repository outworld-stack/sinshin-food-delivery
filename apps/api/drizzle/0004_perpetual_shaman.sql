ALTER TABLE "coupon_nudges" DROP CONSTRAINT "coupon_nudges_missing_condition_id_coupon_conditions_id_fk";
--> statement-breakpoint
ALTER TABLE "coupon_nudges" ALTER COLUMN "missing_condition_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "coupon_nudges" ADD CONSTRAINT "coupon_nudges_missing_condition_id_coupon_conditions_id_fk" FOREIGN KEY ("missing_condition_id") REFERENCES "public"."coupon_conditions"("id") ON DELETE set null ON UPDATE no action;