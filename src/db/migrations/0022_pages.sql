CREATE TABLE "page_translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"locale" "locale" NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"body_json" jsonb,
	"seo_title" text,
	"seo_description" text,
	"author_staff_user_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_translations_page_locale_unique" UNIQUE("page_id","locale"),
	CONSTRAINT "page_translations_locale_slug_unique" UNIQUE("locale","slug"),
	CONSTRAINT "page_translations_version_positive" CHECK ("page_translations"."version" >= 1),
	CONSTRAINT "page_translations_required_fields_present" CHECK (length(btrim("page_translations"."title")) > 0 AND length(btrim("page_translations"."slug")) > 0)
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"editorial_status" "editorial_status" DEFAULT 'DRAFT' NOT NULL,
	"published_at" timestamp with time zone,
	"nav_order" integer DEFAULT 0 NOT NULL,
	"created_by_staff_user_id" uuid,
	"updated_by_staff_user_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pages_version_positive" CHECK ("pages"."version" >= 1),
	CONSTRAINT "pages_published_has_date" CHECK ("pages"."editorial_status" <> 'PUBLISHED' OR "pages"."published_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "page_translations" ADD CONSTRAINT "page_translations_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_translations" ADD CONSTRAINT "page_translations_author_staff_user_id_staff_users_id_fk" FOREIGN KEY ("author_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_created_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("created_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_updated_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("updated_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;