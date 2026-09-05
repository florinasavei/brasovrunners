/*
  Five staff roles that nest, replacing three that did not quite (BR-REQ-060-01, DECISIONS.md §38).

      CONTRIBUTOR  proposes; edits their own drafts and submits them for approval
      MODERATOR    edits any event and approves
      DEV          the above, plus the configuration report. No participant data
      ADMIN        the above, plus registrations, participants and exports
      SUPERADMIN   the above, plus staff administration

  The generated version of this migration cast the column straight into the new type, which
  aborts the moment a row says 'AUTHOR' — a value the new enum does not have. The remap below is
  the whole point of hand-writing it, and it runs while the column is still `text`.

  **Every existing ADMIN becomes SUPERADMIN, deliberately.** Staff administration moved from
  ADMIN to SUPERADMIN, so mapping ADMIN to ADMIN would take away a power those accounts have
  today — and, worse, could leave the club with nobody able to manage staff at all. A role
  migration must never remove access somebody already had; demoting afterwards is a click in the
  backoffice, being locked out of it is not.
*/
ALTER TABLE "staff_users" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint

UPDATE "staff_users" SET "role" = CASE "role"
  WHEN 'AUTHOR' THEN 'CONTRIBUTOR'
  WHEN 'EDITOR' THEN 'MODERATOR'
  WHEN 'ADMIN'  THEN 'SUPERADMIN'
  ELSE "role"
END;--> statement-breakpoint

DROP TYPE "public"."staff_role";--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('CONTRIBUTOR', 'MODERATOR', 'DEV', 'ADMIN', 'SUPERADMIN');--> statement-breakpoint
ALTER TABLE "staff_users" ALTER COLUMN "role" SET DATA TYPE "public"."staff_role" USING "role"::"public"."staff_role";
