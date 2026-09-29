CREATE TYPE "public"."registration_cancel_reason_kind" AS ENUM('INJURY_OR_ILLNESS', 'OTHER_PLANS', 'OTHER');--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "cancel_reason_kind" "registration_cancel_reason_kind";--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "cancel_reason" text;