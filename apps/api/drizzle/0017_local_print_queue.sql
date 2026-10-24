CREATE TABLE "local_print_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(80) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"printers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "local_print_assignments" (
	"kind" varchar(8) PRIMARY KEY NOT NULL,
	"target" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "local_print_assignment_kind_check" CHECK ("local_print_assignments"."kind" in ('sales','kitchen'))
);
--> statement-breakpoint
CREATE TABLE "local_print_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"order_display_id" varchar(20) NOT NULL,
	"created_by" uuid NOT NULL,
	"kind" varchar(8) NOT NULL,
	"printer_name" varchar(256) NOT NULL,
	"mode" varchar(8) NOT NULL,
	"cut" integer DEFAULT 1 NOT NULL,
	"width_px" integer NOT NULL,
	"height_px" integer NOT NULL,
	"rows" text,
	"payload_hash" varchar(64) NOT NULL,
	"status" varchar(12) DEFAULT 'queued' NOT NULL,
	"claim_token_hash" varchar(64),
	"claimed_at" timestamp with time zone,
	"error" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "local_print_jobs_status_check" CHECK ("local_print_jobs"."status" in ('queued','claimed','spooled','failed','uncertain','cancelled')),
	CONSTRAINT "local_print_jobs_kind_check" CHECK ("local_print_jobs"."kind" in ('sales','kitchen')),
	CONSTRAINT "local_print_jobs_mode_check" CHECK ("local_print_jobs"."mode" in ('driver','escpos')),
	CONSTRAINT "local_print_jobs_size_check" CHECK ("local_print_jobs"."width_px" in (384,420,576) and "local_print_jobs"."height_px" between 1 and 4000)
);
--> statement-breakpoint
ALTER TABLE "local_print_jobs" ADD CONSTRAINT "local_print_jobs_agent_id_local_print_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."local_print_agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "local_print_jobs" ADD CONSTRAINT "local_print_jobs_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "local_print_jobs" ADD CONSTRAINT "local_print_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "local_print_agents_token_key" ON "local_print_agents" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "local_print_jobs_agent_queue_idx" ON "local_print_jobs" USING btree ("agent_id","status","created_at");--> statement-breakpoint
CREATE INDEX "local_print_jobs_order_idx" ON "local_print_jobs" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "local_print_jobs_stale_idx" ON "local_print_jobs" USING btree ("claimed_at") WHERE "local_print_jobs"."status" = 'claimed';--> statement-breakpoint
CREATE UNIQUE INDEX "local_print_jobs_active_order_kind_key" ON "local_print_jobs" USING btree ("order_id","kind") WHERE "local_print_jobs"."status" in ('queued','claimed');
--> statement-breakpoint
CREATE TABLE "local_print_discards" (
	"job_id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "local_print_discards" ADD CONSTRAINT "local_print_discards_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "local_print_discards" ADD CONSTRAINT "local_print_discards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;