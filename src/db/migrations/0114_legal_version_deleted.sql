ALTER TABLE "legal_documents" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "legal_documents" ADD COLUMN "deleted_by_staff_user_id" uuid;--> statement-breakpoint
ALTER TABLE "legal_documents" ADD COLUMN "deleted_reason" text;--> statement-breakpoint
ALTER TABLE "legal_documents" ADD CONSTRAINT "legal_documents_deleted_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("deleted_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_documents" ADD CONSTRAINT "legal_documents_deleted_is_withdrawn" CHECK ("legal_documents"."deleted_at" is null or ("legal_documents"."withdrawn_at" is not null and "legal_documents"."deleted_reason" is not null));