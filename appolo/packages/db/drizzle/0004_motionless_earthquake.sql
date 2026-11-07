CREATE TYPE "public"."media_kind" AS ENUM('movie', 'tv', 'music', 'podcast', 'book');--> statement-breakpoint
CREATE TABLE "catalog_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "media_kind" NOT NULL,
	"title" text NOT NULL,
	"subtitle" text DEFAULT '' NOT NULL,
	"year" integer,
	"image_url" text,
	"external_ref" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_matchups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"opponent_id" uuid NOT NULL,
	"result" text NOT NULL,
	"item_elo_before" integer NOT NULL,
	"item_elo_after" integer NOT NULL,
	"opponent_elo_before" integer NOT NULL,
	"opponent_elo_after" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"elo" integer DEFAULT 1500 NOT NULL,
	"matches" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"skips" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "item_matchups" ADD CONSTRAINT "item_matchups_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_matchups" ADD CONSTRAINT "item_matchups_item_id_catalog_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."catalog_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_matchups" ADD CONSTRAINT "item_matchups_opponent_id_catalog_items_id_fk" FOREIGN KEY ("opponent_id") REFERENCES "public"."catalog_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_ratings" ADD CONSTRAINT "item_ratings_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_ratings" ADD CONSTRAINT "item_ratings_item_id_catalog_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."catalog_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_items_kind_title_uq" ON "catalog_items" USING btree ("kind","title","subtitle");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_items_external_ref_uq" ON "catalog_items" USING btree ("external_ref");--> statement-breakpoint
CREATE INDEX "catalog_items_kind_idx" ON "catalog_items" USING btree ("kind","title");--> statement-breakpoint
CREATE INDEX "item_matchups_org_item_idx" ON "item_matchups" USING btree ("org_id","item_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "item_ratings_org_item_uq" ON "item_ratings" USING btree ("org_id","item_id");--> statement-breakpoint
CREATE INDEX "item_ratings_org_elo_idx" ON "item_ratings" USING btree ("org_id","elo");