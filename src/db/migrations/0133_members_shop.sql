CREATE TYPE "public"."shop_order_status" AS ENUM('PLACED', 'PAID', 'HANDED_OVER', 'CANCELLED');--> statement-breakpoint
ALTER TYPE "public"."email_message_type" ADD VALUE 'SHOP_ORDER_PLACED';--> statement-breakpoint
ALTER TYPE "public"."email_message_type" ADD VALUE 'SHOP_ORDER_PAID';--> statement-breakpoint
ALTER TYPE "public"."email_message_type" ADD VALUE 'SHOP_ORDER_CLUB_NOTICE';--> statement-breakpoint
CREATE TABLE "shop_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "shop_orders_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"member_staff_user_id" uuid,
	"member_name" text NOT NULL,
	"locale" "locale" DEFAULT 'ro' NOT NULL,
	"product_id" uuid,
	"variant_id" uuid,
	"product_title_ro" text NOT NULL,
	"product_title_en" text NOT NULL,
	"variant_label" text,
	"quantity" integer NOT NULL,
	"unit_price_bani" integer NOT NULL,
	"stock_taken" boolean DEFAULT false NOT NULL,
	"note" text,
	"status" "shop_order_status" DEFAULT 'PLACED' NOT NULL,
	"paid_at" timestamp with time zone,
	"handed_over_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"cancelled_by_staff_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_orders_quantity_range" CHECK ("shop_orders"."quantity" BETWEEN 1 AND 5),
	CONSTRAINT "shop_orders_unit_price_not_negative" CHECK ("shop_orders"."unit_price_bani" >= 0),
	CONSTRAINT "shop_orders_note_length" CHECK ("shop_orders"."note" IS NULL OR length("shop_orders"."note") <= 300),
	CONSTRAINT "shop_orders_cancelled_by_known" CHECK ("shop_orders"."cancelled_by" IS NULL OR "shop_orders"."cancelled_by" IN ('MEMBER', 'CLUB'))
);
--> statement-breakpoint
CREATE TABLE "shop_product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"label" text,
	"stock" integer,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_product_variants_stock_not_negative" CHECK ("shop_product_variants"."stock" IS NULL OR "shop_product_variants"."stock" >= 0),
	CONSTRAINT "shop_product_variants_label_present" CHECK ("shop_product_variants"."label" IS NULL OR length(btrim("shop_product_variants"."label")) > 0)
);
--> statement-breakpoint
CREATE TABLE "shop_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title_ro" text NOT NULL,
	"title_en" text NOT NULL,
	"description_ro" text,
	"description_en" text,
	"price_bani" integer NOT NULL,
	"photo_media_asset_id" uuid,
	"photo_crop" jsonb,
	"visible" boolean DEFAULT false NOT NULL,
	"position" integer NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by_staff_user_id" uuid,
	"updated_by_staff_user_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_products_title_ro_present" CHECK (length(btrim("shop_products"."title_ro")) > 0),
	CONSTRAINT "shop_products_title_en_present" CHECK (length(btrim("shop_products"."title_en")) > 0),
	CONSTRAINT "shop_products_price_not_negative" CHECK ("shop_products"."price_bani" >= 0),
	CONSTRAINT "shop_products_position_positive" CHECK ("shop_products"."position" >= 1),
	CONSTRAINT "shop_products_version_positive" CHECK ("shop_products"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_member_staff_user_id_staff_users_id_fk" FOREIGN KEY ("member_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_product_id_shop_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."shop_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_variant_id_shop_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."shop_product_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_cancelled_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("cancelled_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_product_variants" ADD CONSTRAINT "shop_product_variants_product_id_shop_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."shop_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_products" ADD CONSTRAINT "shop_products_photo_media_asset_id_media_assets_id_fk" FOREIGN KEY ("photo_media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_products" ADD CONSTRAINT "shop_products_created_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("created_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_products" ADD CONSTRAINT "shop_products_updated_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("updated_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shop_orders_status_idx" ON "shop_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "shop_orders_created_at_idx" ON "shop_orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "shop_orders_member_idx" ON "shop_orders" USING btree ("member_staff_user_id");--> statement-breakpoint
CREATE INDEX "shop_orders_product_idx" ON "shop_orders" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "shop_product_variants_product_idx" ON "shop_product_variants" USING btree ("product_id","position");--> statement-breakpoint
CREATE INDEX "shop_products_visible_position_idx" ON "shop_products" USING btree ("visible","position");