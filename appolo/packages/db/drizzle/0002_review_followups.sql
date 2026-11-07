ALTER TABLE "review_requests" ADD COLUMN "follow_up_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "review_requests" ADD COLUMN "last_follow_up_at" timestamp with time zone;