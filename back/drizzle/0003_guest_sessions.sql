CREATE TABLE "guest_sessions" (
  "id" text PRIMARY KEY,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "user_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "guest_id" text;
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_guest_id_guest_sessions_id_fk"
  FOREIGN KEY ("guest_id") REFERENCES "guest_sessions"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX "projects_guest_id_idx" ON "projects" USING btree ("guest_id");
