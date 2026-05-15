ALTER TABLE "tasks" ADD COLUMN "pull_request_url" text;
ALTER TABLE "tasks" ADD COLUMN "pull_request_merged_at" timestamp with time zone;
