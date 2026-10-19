CREATE TABLE "printers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(60) NOT NULL,
	"host" varchar(64) NOT NULL,
	"port" integer DEFAULT 9100 NOT NULL,
	"width_dots" integer DEFAULT 576 NOT NULL,
	"auto_cut" boolean DEFAULT true NOT NULL,
	"last_status" varchar(16) DEFAULT 'unknown' NOT NULL,
	"last_status_detail" varchar(140),
	"last_status_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "printers_host_port_key" ON "printers" USING btree ("host","port");--> statement-breakpoint
CREATE INDEX "printers_status_idx" ON "printers" USING btree ("last_status");