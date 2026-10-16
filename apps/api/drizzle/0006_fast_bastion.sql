CREATE TABLE "backfill_runs" (
	"name" varchar(64) PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL
);
