-- «Link Google Photos» on an album (§1050): where its photos live. Expand only: one nullable column, null on every album
-- that exists, so nothing published changes until an editor writes a link.
ALTER TABLE "gallery_albums" ADD COLUMN "external_url" text;
