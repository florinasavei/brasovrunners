CREATE TABLE "gallery_album_translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"album_id" uuid NOT NULL,
	"locale" "locale" NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gallery_album_translations_album_locale_unique" UNIQUE("album_id","locale"),
	CONSTRAINT "gallery_album_translations_locale_slug_unique" UNIQUE("locale","slug"),
	CONSTRAINT "gallery_album_translations_required_fields_present" CHECK (length(btrim("gallery_album_translations"."title")) > 0 AND length(btrim("gallery_album_translations"."slug")) > 0)
);
--> statement-breakpoint
CREATE TABLE "gallery_albums" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"editorial_status" "editorial_status" DEFAULT 'DRAFT' NOT NULL,
	"published_at" timestamp with time zone,
	"event_id" uuid,
	"taken_on" timestamp with time zone NOT NULL,
	"cover_media_asset_id" uuid,
	"created_by_staff_user_id" uuid,
	"updated_by_staff_user_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gallery_albums_version_positive" CHECK ("gallery_albums"."version" >= 1),
	CONSTRAINT "gallery_albums_published_has_date" CHECK ("gallery_albums"."editorial_status" <> 'PUBLISHED' OR "gallery_albums"."published_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "gallery_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"album_id" uuid NOT NULL,
	"media_asset_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gallery_items_album_asset_unique" UNIQUE("album_id","media_asset_id"),
	CONSTRAINT "gallery_items_position_positive" CHECK ("gallery_items"."position" >= 1)
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key_prefix" text NOT NULL,
	"original_filename" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"byte_size" integer NOT NULL,
	"created_by_staff_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_assets_key_prefix_unique" UNIQUE("key_prefix"),
	CONSTRAINT "media_assets_dimensions_positive" CHECK ("media_assets"."width" > 0 AND "media_assets"."height" > 0 AND "media_assets"."byte_size" > 0)
);
--> statement-breakpoint
ALTER TABLE "gallery_album_translations" ADD CONSTRAINT "gallery_album_translations_album_id_gallery_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."gallery_albums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_albums" ADD CONSTRAINT "gallery_albums_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_albums" ADD CONSTRAINT "gallery_albums_cover_media_asset_id_media_assets_id_fk" FOREIGN KEY ("cover_media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_albums" ADD CONSTRAINT "gallery_albums_created_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("created_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_albums" ADD CONSTRAINT "gallery_albums_updated_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("updated_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_items" ADD CONSTRAINT "gallery_items_album_id_gallery_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."gallery_albums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_items" ADD CONSTRAINT "gallery_items_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_created_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("created_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gallery_albums_status_taken_on_idx" ON "gallery_albums" USING btree ("editorial_status","taken_on");--> statement-breakpoint
CREATE INDEX "gallery_items_album_position_idx" ON "gallery_items" USING btree ("album_id","position");