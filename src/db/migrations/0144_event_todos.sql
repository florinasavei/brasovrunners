CREATE TYPE "public"."event_todo_priority" AS ENUM('URGENT', 'HIGH', 'NORMAL', 'LOW');--> statement-breakpoint
CREATE TABLE "event_todos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"text" text NOT NULL,
	"priority" "event_todo_priority" DEFAULT 'NORMAL' NOT NULL,
	"assignee_staff_user_id" uuid,
	"due_on" date,
	"done_at" timestamp with time zone,
	"done_by_staff_user_id" uuid,
	"created_by_staff_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_todos_text_length" CHECK (char_length("event_todos"."text") BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE "event_todos" ADD CONSTRAINT "event_todos_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_todos" ADD CONSTRAINT "event_todos_assignee_staff_user_id_staff_users_id_fk" FOREIGN KEY ("assignee_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_todos" ADD CONSTRAINT "event_todos_done_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("done_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_todos" ADD CONSTRAINT "event_todos_created_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("created_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_todos_event_idx" ON "event_todos" USING btree ("event_id");