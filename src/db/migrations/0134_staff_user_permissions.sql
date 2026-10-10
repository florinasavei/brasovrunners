CREATE TABLE "staff_user_permissions" (
	"staff_user_id" uuid NOT NULL,
	"permission" text NOT NULL,
	"granted_by_staff_user_id" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_user_permissions_staff_user_id_permission_pk" PRIMARY KEY("staff_user_id","permission"),
	CONSTRAINT "staff_user_permissions_permission_known" CHECK ("staff_user_permissions"."permission" IN ('shop.manage'))
);
--> statement-breakpoint
ALTER TABLE "staff_user_permissions" ADD CONSTRAINT "staff_user_permissions_staff_user_id_staff_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_user_permissions" ADD CONSTRAINT "staff_user_permissions_granted_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("granted_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;