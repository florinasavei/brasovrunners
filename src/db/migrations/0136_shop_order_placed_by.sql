ALTER TABLE "shop_orders" ADD COLUMN "placed_by" text DEFAULT 'MEMBER' NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN "placed_by_staff_user_id" uuid;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_placed_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("placed_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_placed_by_known" CHECK ("shop_orders"."placed_by" IN ('MEMBER', 'CLUB'));