ALTER TABLE "reviews" ADD COLUMN "assigned_to" uuid;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "flagged" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reviews_org_reply_idx" ON "reviews" USING btree ("org_id","reply_status");