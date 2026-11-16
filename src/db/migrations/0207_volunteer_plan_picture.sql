-- The picture of «Planul voluntarilor»: one nullable `volunteer_plan_media_asset_id` on events — the stored picture (media_assets) the
-- organizers uploaded as the plan's map, none meaning no picture. Expand only: the one column. No foreign key, as `cover_media_asset_id`
-- has none (the schema files would import each other): the reference check counts the column and the plan's read joins the store.
-- Nothing is backfilled; no row reads differently until an organizer uploads a picture.
ALTER TABLE "events" ADD COLUMN "volunteer_plan_media_asset_id" uuid;