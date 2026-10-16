CREATE TABLE "registration_permits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" varchar(11) NOT NULL,
	"status" varchar(12) DEFAULT 'pending' NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_device_id" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid
);
--> statement-breakpoint
ALTER TABLE "registration_permits" ADD CONSTRAINT "registration_permits_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "registration_permits_pending_phone_uidx" ON "registration_permits" USING btree ("phone") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "registration_permits_phone_idx" ON "registration_permits" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "registration_permits_status_idx" ON "registration_permits" USING btree ("status");--> statement-breakpoint
CREATE INDEX "registration_permits_created_idx" ON "registration_permits" USING btree ("created_at");