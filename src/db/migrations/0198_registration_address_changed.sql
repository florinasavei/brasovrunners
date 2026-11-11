-- «Schimbă adresa»: when an Administrator last moved a registration to another address, and who. Two nullable
-- columns, the account's `ON DELETE SET NULL` as every staff column of the table. Expand only.
ALTER TABLE "registrations" ADD COLUMN "address_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "address_changed_by_staff_user_id" uuid;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_address_changed_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("address_changed_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;