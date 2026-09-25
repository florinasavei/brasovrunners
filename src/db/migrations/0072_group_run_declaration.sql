ALTER TYPE "public"."email_message_type" ADD VALUE 'GROUP_RUN_DECLARATION_SIGNED';--> statement-breakpoint
ALTER TYPE "public"."email_message_type" ADD VALUE 'GROUP_RUN_DECLARATION_ARCHIVE';--> statement-breakpoint
ALTER TYPE "public"."legal_document_key" ADD VALUE 'GROUP_RUN_DECLARATION_ASPHALT';--> statement-breakpoint
ALTER TYPE "public"."legal_document_key" ADD VALUE 'GROUP_RUN_DECLARATION_TRAIL';--> statement-breakpoint
CREATE TABLE "group_run_declarations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"legal_document_id" uuid NOT NULL,
	"declaration_version" integer NOT NULL,
	"content_sha256" text NOT NULL,
	"locale" "locale" NOT NULL,
	"typed_name" text NOT NULL,
	"id_document" text,
	"email" text NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_run_declarations_version_positive" CHECK ("group_run_declarations"."declaration_version" >= 1),
	CONSTRAINT "group_run_declarations_hash_is_sha256_hex" CHECK ("group_run_declarations"."content_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "offers_group_run_declaration" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "group_run_declarations" ADD CONSTRAINT "group_run_declarations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_run_declarations" ADD CONSTRAINT "group_run_declarations_legal_document_id_legal_documents_id_fk" FOREIGN KEY ("legal_document_id") REFERENCES "public"."legal_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_run_declarations_event_accepted_at_idx" ON "group_run_declarations" USING btree ("event_id","accepted_at");