ALTER TABLE "devices" ADD COLUMN "device_type" varchar(12);--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "device_brand" varchar(30);--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "device_model" varchar(80);--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "registered_owner_phone" varchar(11);--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "prev_canvas_hash" varchar(64);--> statement-breakpoint
CREATE UNIQUE INDEX "devices_client_id_uidx" ON "devices" USING btree ("client_id") WHERE client_id is not null;--> statement-breakpoint
CREATE INDEX "devices_type_idx" ON "devices" USING btree ("device_type");