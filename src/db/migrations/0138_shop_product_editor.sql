CREATE TABLE "shop_product_pictures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"media_asset_id" uuid,
	"crop" jsonb,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_product_pictures_position_positive" CHECK ("shop_product_pictures"."position" >= 1)
);
--> statement-breakpoint
ALTER TABLE "shop_products" ADD COLUMN "description_ro_json" jsonb;
--> statement-breakpoint
ALTER TABLE "shop_products" ADD COLUMN "description_en_json" jsonb;
--> statement-breakpoint
ALTER TABLE "shop_products" ADD COLUMN "size_chart" jsonb;
--> statement-breakpoint
ALTER TABLE "shop_product_pictures" ADD CONSTRAINT "shop_product_pictures_product_id_shop_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."shop_products"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "shop_product_pictures" ADD CONSTRAINT "shop_product_pictures_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "shop_product_pictures_product_idx" ON "shop_product_pictures" USING btree ("product_id","position");
--> statement-breakpoint
ALTER TABLE "shop_products" ADD CONSTRAINT "shop_products_size_chart_shape" CHECK ("shop_products"."size_chart" IS NULL OR (jsonb_typeof("shop_products"."size_chart") = 'object' AND jsonb_typeof("shop_products"."size_chart" -> 'columns') = 'array' AND jsonb_array_length("shop_products"."size_chart" -> 'columns') <= 4 AND jsonb_typeof("shop_products"."size_chart" -> 'rows') = 'object'));

--> statement-breakpoint
-- A product's one photo of §683 becomes its first picture (the cover, with its crop); idempotent: a product that already has a picture is left alone.
INSERT INTO "shop_product_pictures" ("product_id", "media_asset_id", "crop", "position") SELECT "id", "photo_media_asset_id", "photo_crop", 1 FROM "shop_products" WHERE "photo_media_asset_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "shop_product_pictures" WHERE "shop_product_pictures"."product_id" = "shop_products"."id");
