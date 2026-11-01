CREATE TABLE "product_similarity" (
	"product_id" uuid NOT NULL,
	"similar_id" uuid NOT NULL,
	"score" real NOT NULL,
	"co_views" integer DEFAULT 0 NOT NULL,
	"co_purchases" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_similarity_product_id_similar_id_pk" PRIMARY KEY("product_id","similar_id")
);
--> statement-breakpoint
CREATE INDEX "product_similarity_score_idx" ON "product_similarity" USING btree ("product_id","score");