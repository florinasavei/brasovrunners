ALTER TABLE "shop_orders" ADD COLUMN "currency" text DEFAULT 'RON' NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_products" ADD COLUMN "currency" text DEFAULT 'RON' NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_currency_known" CHECK ("shop_orders"."currency" IN ('RON', 'EUR'));--> statement-breakpoint
ALTER TABLE "shop_products" ADD CONSTRAINT "shop_products_currency_known" CHECK ("shop_products"."currency" IN ('RON', 'EUR'));