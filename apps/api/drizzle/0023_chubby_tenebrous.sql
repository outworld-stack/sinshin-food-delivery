CREATE TABLE "product_ranking" (
	"product_id" uuid PRIMARY KEY NOT NULL,
	"score" double precision NOT NULL,
	"alpha" double precision NOT NULL,
	"beta" double precision NOT NULL,
	"rank" integer NOT NULL,
	"computed_day" date NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "product_ranking_score_idx" ON "product_ranking" USING btree ("score");