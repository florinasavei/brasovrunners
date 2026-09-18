-- Expand only (AGENTS.md §7.6): a backfill, no shape change.
-- Canonicalization version 2 (DECISIONS.md §74, BR-REQ-032-02): Gmail dots are kept. Every
-- version-1 row is re-canonicalized from the delivery address it stored, so the code and the
-- rows agree. Distinct version-1 values stay distinct under version 2 (keeping dots can only
-- separate, never merge), so the unique constraint cannot trip.
UPDATE "participants"
SET "canonical_email" = lower(split_part(split_part("delivery_email", '@', 1), '+', 1)) || '@gmail.com',
    "canonicalization_version" = 2
WHERE "canonicalization_version" = 1
  AND lower(split_part("delivery_email", '@', 2)) IN ('gmail.com', 'googlemail.com');--> statement-breakpoint
UPDATE "participants" SET "canonicalization_version" = 2 WHERE "canonicalization_version" = 1;
