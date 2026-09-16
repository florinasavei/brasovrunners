ALTER TABLE "staff_users" ADD COLUMN "zitadel_subject" text;--> statement-breakpoint
-- The previous migration dropped auth_subject; any row that had one (a real dev-switcher
-- sign-in on a developer's own database — never in qa or production, where the switcher is
-- refused at startup) now has first_signed_in_at set with no subject to match it. That old
-- subject named an identity this application no longer authenticates against, so the honest
-- state is "not yet signed in again", not a value invented to satisfy the constraint below.
UPDATE "staff_users" SET "first_signed_in_at" = NULL WHERE "zitadel_subject" IS NULL;--> statement-breakpoint
ALTER TABLE "staff_users" ADD CONSTRAINT "staff_users_zitadel_subject_unique" UNIQUE("zitadel_subject");--> statement-breakpoint
ALTER TABLE "staff_users" ADD CONSTRAINT "staff_users_signed_in_has_subject" CHECK (("staff_users"."zitadel_subject" IS NULL) = ("staff_users"."first_signed_in_at" IS NULL));