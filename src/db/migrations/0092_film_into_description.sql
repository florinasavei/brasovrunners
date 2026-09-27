-- expand: data only (§481) — nothing is dropped, renamed or tightened. `events.video_url`, `events.video_poster_url` and their check stay, unread and unwritten, until a later contract migration drops them (AGENTS.md §7.6).
--
-- The event page's own film section (§69, «Filmul» in the editor since §406) is retired: a film is
-- a figure in the description (§266). Every event whose `video_url` carries a YouTube video id gets
-- that film appended, as a `youtube` node, to the END of each of its translations' `body_json` —
-- the shape `rich-text/domain/schema.ts#youtubeNode` parses: the id, no caption, the picture's
-- defaults (100 %, `block`), and the event's stored poster when it is one this site stored (the
-- schema's `posterSrc` rule), else none, which the next save fetches outside any transaction (§403).
--
-- - The id is read by the same rules as `events/domain/video.ts#youtubeVideoId`: https only;
--   youtu.be/<id>, /watch?v=<id>, /embed|shorts|live|v/<id>; eleven characters of [A-Za-z0-9_-].
--   A link no id can be read from (the page never drew one) is left alone.
-- - A translation whose description already holds that film is left alone, so running it on a
--   database where the organizer pasted the film by hand adds no second copy.
-- - A translation with no description gets one that is only the film.
-- - Each touched translation's `version` moves on, so an editor tab opened before the migration
--   is refused as stale rather than saving the description back without the film (AGENTS.md §11.5).
WITH "films" AS (
  SELECT
    "events"."id" AS "event_id",
    COALESCE(
      substring("events"."video_url" FROM '^https://youtu\.be/([A-Za-z0-9_-]{11})(?:[/?#]|$)'),
      substring("events"."video_url" FROM '^https://(?:(?:www\.|m\.)?youtube\.com|www\.youtube-nocookie\.com)/watch\?(?:[^#]*&)?v=([A-Za-z0-9_-]{11})(?:[&#]|$)'),
      substring("events"."video_url" FROM '^https://(?:(?:www\.|m\.)?youtube\.com|www\.youtube-nocookie\.com)/(?:embed|shorts|live|v)/([A-Za-z0-9_-]{11})(?:[/?#]|$)')
    ) AS "video_id",
    CASE
      WHEN "events"."video_poster_url" ~ '/(?:yt-[A-Za-z0-9_-]{11}|[0-9a-f-]{36})/web\.webp$'
        AND ("events"."video_poster_url" LIKE 'https://%' OR "events"."video_poster_url" LIKE '/api/media/%')
        AND length("events"."video_poster_url") <= 2048
      THEN "events"."video_poster_url"
    END AS "poster"
  FROM "events"
  WHERE "events"."video_url" IS NOT NULL
),
"nodes" AS (
  SELECT
    "event_id",
    "video_id",
    jsonb_build_object(
      'type', 'youtube',
      'attrs', jsonb_build_object(
        'videoId', "video_id",
        'caption', '',
        'widthPercent', 100,
        'align', 'block',
        'poster', "poster",
        'posterSource', CASE WHEN "poster" IS NULL THEN NULL ELSE 'youtube' END
      )
    ) AS "node"
  FROM "films"
  WHERE "video_id" IS NOT NULL
)
UPDATE "event_translations"
SET
  "body_json" = CASE
    WHEN jsonb_typeof("event_translations"."body_json") = 'object'
    THEN jsonb_set(
      "event_translations"."body_json",
      '{content}',
      COALESCE("event_translations"."body_json" -> 'content', '[]'::jsonb) || jsonb_build_array("nodes"."node"),
      true
    )
    ELSE jsonb_build_object('type', 'doc', 'content', jsonb_build_array("nodes"."node"))
  END,
  "version" = "event_translations"."version" + 1,
  "updated_at" = now()
FROM "nodes"
WHERE "event_translations"."event_id" = "nodes"."event_id"
  -- A description that is not a document with a list of blocks is never rewritten (none is
  -- stored that way; the guard keeps a malformed one from being replaced by the film alone).
  AND (
    "event_translations"."body_json" IS NULL
    OR jsonb_typeof("event_translations"."body_json") = 'null'
    OR (
      jsonb_typeof("event_translations"."body_json") = 'object'
      AND jsonb_typeof(COALESCE("event_translations"."body_json" -> 'content', '[]'::jsonb)) = 'array'
    )
  )
  -- Not twice: a description that already shows this film keeps its own (a NULL test is "no").
  AND NOT COALESCE(
    jsonb_typeof("event_translations"."body_json" -> 'content') = 'array'
    AND ("event_translations"."body_json" -> 'content') @> jsonb_build_array(
      jsonb_build_object('type', 'youtube', 'attrs', jsonb_build_object('videoId', "nodes"."video_id"))
    ),
    false
  );
