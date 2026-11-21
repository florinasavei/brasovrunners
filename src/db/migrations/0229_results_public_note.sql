-- «Comentariu public» on one result (§NNN): a line the Administrator writes, printed under the row on the site. Expand only:
-- one nullable column, null on every row that exists, so nothing published changes until a note is written.
ALTER TABLE "event_results" ADD COLUMN "public_note" text;
