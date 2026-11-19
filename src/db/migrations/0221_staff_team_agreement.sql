ALTER TYPE "public"."legal_document_key" ADD VALUE 'STAFF_DATA_AGREEMENT';--> statement-breakpoint
CREATE TABLE "staff_team_agreement_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"legal_document_id" uuid NOT NULL,
	"document_version" integer NOT NULL,
	"content_sha256" text NOT NULL,
	"locale" "locale" NOT NULL,
	"typed_name" text NOT NULL,
	"text_hash" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"accepted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_team_agreement_acceptances_once" UNIQUE("staff_user_id","legal_document_id"),
	CONSTRAINT "staff_team_agreement_acceptances_version_positive" CHECK ("staff_team_agreement_acceptances"."document_version" >= 1),
	CONSTRAINT "staff_team_agreement_acceptances_content_sha256" CHECK ("staff_team_agreement_acceptances"."content_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "staff_team_agreement_acceptances_text_sha256" CHECK ("staff_team_agreement_acceptances"."text_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "staff_team_agreement_acceptances_typed_name" CHECK (char_length(btrim("staff_team_agreement_acceptances"."typed_name")) BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE "staff_team_agreement_acceptances" ADD CONSTRAINT "staff_team_agreement_acceptances_staff_user_id_staff_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_team_agreement_acceptances" ADD CONSTRAINT "staff_team_agreement_acceptances_legal_document_id_legal_documents_id_fk" FOREIGN KEY ("legal_document_id") REFERENCES "public"."legal_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_team_agreement_acceptances_document_idx" ON "staff_team_agreement_acceptances" USING btree ("legal_document_id");