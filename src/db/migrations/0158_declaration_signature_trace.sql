ALTER TABLE "declaration_acceptances" ADD COLUMN "ip" text;--> statement-breakpoint
ALTER TABLE "declaration_acceptances" ADD COLUMN "user_agent" text;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD COLUMN "agreement_ip" text;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD COLUMN "agreement_user_agent" text;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD COLUMN "guardian_ip" text;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD COLUMN "guardian_user_agent" text;--> statement-breakpoint
ALTER TABLE "group_run_declarations" ADD COLUMN "ip" text;--> statement-breakpoint
ALTER TABLE "group_run_declarations" ADD COLUMN "user_agent" text;