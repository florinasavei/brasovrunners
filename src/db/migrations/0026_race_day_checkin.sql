CREATE TYPE "public"."declaration_method" AS ENUM('EMAIL_LINK', 'PAPER');--> statement-breakpoint
ALTER TABLE "declaration_acceptances" ADD COLUMN "method" "declaration_method" DEFAULT 'EMAIL_LINK' NOT NULL;--> statement-breakpoint
ALTER TABLE "declaration_acceptances" ADD COLUMN "attested_by_staff_user_id" uuid;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "checkin_code" text;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "checked_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "checked_in_by_staff_user_id" uuid;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "email_confirmed_by_staff_user_id" uuid;--> statement-breakpoint
ALTER TABLE "declaration_acceptances" ADD CONSTRAINT "declaration_acceptances_attested_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("attested_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_checked_in_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("checked_in_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_email_confirmed_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("email_confirmed_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_checkin_code_unique" UNIQUE("checkin_code");--> statement-breakpoint
ALTER TABLE "declaration_acceptances" ADD CONSTRAINT "declaration_acceptances_paper_is_attested" CHECK (("declaration_acceptances"."method" = 'PAPER') = ("declaration_acceptances"."attested_by_staff_user_id" IS NOT NULL));