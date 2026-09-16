ALTER TABLE "staff_users" DROP CONSTRAINT "staff_users_auth_subject_unique";--> statement-breakpoint
ALTER TABLE "staff_users" DROP CONSTRAINT "staff_users_signed_in_has_subject";--> statement-breakpoint
ALTER TABLE "staff_users" DROP COLUMN "auth_subject";