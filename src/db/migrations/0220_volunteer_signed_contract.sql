CREATE TYPE "public"."event_volunteer_document_format" AS ENUM('PDF', 'DOCX', 'DOC', 'JPEG', 'PNG', 'HEIC', 'HEIF');--> statement-breakpoint
CREATE TABLE "event_volunteer_document_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"volunteer_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"size" integer NOT NULL,
	"received" "bytea" NOT NULL,
	"started_by_staff_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_volunteer_document_uploads_volunteer_unique" UNIQUE("volunteer_id"),
	CONSTRAINT "event_volunteer_document_uploads_size" CHECK ("event_volunteer_document_uploads"."size" BETWEEN 1 AND 10485760 AND octet_length("event_volunteer_document_uploads"."received") <= "event_volunteer_document_uploads"."size"),
	CONSTRAINT "event_volunteer_document_uploads_file_name_length" CHECK (char_length("event_volunteer_document_uploads"."file_name") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "event_volunteer_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"volunteer_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"format" "event_volunteer_document_format" NOT NULL,
	"size" integer NOT NULL,
	"bytes" "bytea" NOT NULL,
	"uploaded_by_staff_user_id" uuid,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_volunteer_documents_volunteer_unique" UNIQUE("volunteer_id"),
	CONSTRAINT "event_volunteer_documents_size" CHECK ("event_volunteer_documents"."size" BETWEEN 1 AND 10485760 AND octet_length("event_volunteer_documents"."bytes") = "event_volunteer_documents"."size"),
	CONSTRAINT "event_volunteer_documents_file_name_length" CHECK (char_length("event_volunteer_documents"."file_name") BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE "event_volunteer_document_uploads" ADD CONSTRAINT "event_volunteer_document_uploads_volunteer_id_event_volunteers_id_fk" FOREIGN KEY ("volunteer_id") REFERENCES "public"."event_volunteers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_volunteer_document_uploads" ADD CONSTRAINT "event_volunteer_document_uploads_started_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("started_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_volunteer_documents" ADD CONSTRAINT "event_volunteer_documents_volunteer_id_event_volunteers_id_fk" FOREIGN KEY ("volunteer_id") REFERENCES "public"."event_volunteers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_volunteer_documents" ADD CONSTRAINT "event_volunteer_documents_uploaded_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("uploaded_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;