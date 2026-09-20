CREATE TABLE "legal_document_numbering" (
	"key" "legal_document_key" PRIMARY KEY NOT NULL,
	"highest_retired_version" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_document_numbering_version_positive" CHECK ("legal_document_numbering"."highest_retired_version" >= 1)
);
