import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { eventTranslations, events } from "@/db/schema/events";
import { mediaAssets } from "@/db/schema/gallery";
import { pageTranslations } from "@/db/schema/pages";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import {
  createEvent,
  createEventAndPublish,
  saveEventAndTranslations,
  saveEventFields,
  saveEventTranslation,
} from "@/modules/content/events/service";
import { createPage, savePage } from "@/modules/content/pages/service";
import {
  attachYoutubePosters,
  ensureYoutubePoster,
  fetchYoutubeThumbnail,
  posterKeyPrefix,
  posterUrlFor,
  resolveEventVideoPoster,
} from "@/modules/media/video-poster";
import { countMediaAssets, sweepOrphanAssets } from "@/modules/media/references";
import { runRegistrationMaintenance } from "@/modules/registrations/maintenance";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * `DECISIONS.md` §NNN: a YouTube poster is fetched once, by the server, and stored in the
 * club's own bucket — so the facade a visitor's browser renders never asks `i.ytimg.com`
 * before the click (§69/§110). Save → poster stored → read model, and the orphan sweep counts
 * it, exactly as it counts any other picture (AGENTS.md §17).
 */

const JPEG = () => sharp({ create: { width: 480, height: 360, channels: 3, background: "#224488" } }).jpeg().toBuffer();

/** A `fetch` stand-in: `hqdefault` answers, the smaller sizes never asked. */
function fetchWithHqdefault(bytes: Buffer): typeof fetch {
  return vi.fn(async (url: string) => {
    if (url.includes("/hqdefault.jpg")) {
      return new Response(new Uint8Array(bytes), { status: 200 });
    }
    return new Response(null, { status: 404 });
  }) as unknown as typeof fetch;
}

/** `hqdefault` and `mqdefault` both fail; `default` answers — the last rung of the chain. */
function fetchWithDefaultOnly(bytes: Buffer): typeof fetch {
  return vi.fn(async (url: string) => {
    if (url.includes("/default.jpg")) return new Response(new Uint8Array(bytes), { status: 200 });
    return new Response(null, { status: 404 });
  }) as unknown as typeof fetch;
}

const fetchAlwaysFails: typeof fetch = vi.fn(async () => {
  throw new Error("network is down");
}) as unknown as typeof fetch;

describe("§NNN the club's own copy of a YouTube poster", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
  });

  describe("the fallback chain", () => {
    it("uses hqdefault when it answers", async () => {
      const bytes = await JPEG();
      const found = await fetchYoutubeThumbnail("dQw4w9WgXcQ", fetchWithHqdefault(bytes));
      expect(found?.equals(bytes)).toBe(true);
    });

    it("falls through hqdefault and mqdefault to default", async () => {
      const bytes = await JPEG();
      const found = await fetchYoutubeThumbnail("dQw4w9WgXcQ", fetchWithDefaultOnly(bytes));
      expect(found?.equals(bytes)).toBe(true);
    });

    it("answers null when every quality fails, rather than throwing", async () => {
      const alwaysNotFound: typeof fetch = vi.fn(async () => new Response(null, { status: 404 })) as unknown as typeof fetch;
      await expect(fetchYoutubeThumbnail("dQw4w9WgXcQ", alwaysNotFound)).resolves.toBeNull();
      await expect(fetchYoutubeThumbnail("dQw4w9WgXcQ", fetchAlwaysFails)).resolves.toBeNull();
    });
  });

  describe("ensureYoutubePoster", () => {
    it("stores one media_assets row, keyed by the video id, and answers with its address", async () => {
      const bytes = await JPEG();
      const url = await ensureYoutubePoster(db, "dQw4w9WgXcQ", { fetchImpl: fetchWithHqdefault(bytes) });
      expect(url).toBe(posterUrlFor("dQw4w9WgXcQ"));

      const [row] = await db.select().from(mediaAssets).where(eq(mediaAssets.keyPrefix, posterKeyPrefix("dQw4w9WgXcQ"))).limit(1);
      expect(row).toBeDefined();
      expect(row.width).toBeGreaterThan(0);
      expect(row.height).toBeGreaterThan(0);
    });

    it("does not fetch again for a video already stored — one row, whatever embeds it", async () => {
      const bytes = await JPEG();
      const firstFetch = fetchWithHqdefault(bytes);
      await ensureYoutubePoster(db, "dQw4w9WgXcQ", { fetchImpl: firstFetch });
      expect(firstFetch).toHaveBeenCalledTimes(1);

      const secondFetch = fetchWithHqdefault(bytes);
      const url = await ensureYoutubePoster(db, "dQw4w9WgXcQ", { fetchImpl: secondFetch });
      expect(secondFetch).not.toHaveBeenCalled();
      expect(url).toBe(posterUrlFor("dQw4w9WgXcQ"));

      const rows = await db.select().from(mediaAssets).where(eq(mediaAssets.keyPrefix, posterKeyPrefix("dQw4w9WgXcQ")));
      expect(rows).toHaveLength(1);
    });

    it("answers null on a fetch failure, and stores nothing", async () => {
      const url = await ensureYoutubePoster(db, "dQw4w9WgXcQ", { fetchImpl: fetchAlwaysFails });
      expect(url).toBeNull();
      const rows = await db.select().from(mediaAssets).where(eq(mediaAssets.keyPrefix, posterKeyPrefix("dQw4w9WgXcQ")));
      expect(rows).toHaveLength(0);
    });
  });

  describe("resolveEventVideoPoster — what an event save writes to video_poster_url", () => {
    const videoIdOf = (url: string | null | undefined) => {
      const match = /v=([\w-]{11})/.exec(url ?? "");
      return match?.[1] ?? null;
    };

    it("leaves the column untouched when videoUrl was not part of this save, and a poster is already stored", async () => {
      const result = await resolveEventVideoPoster(db, {
        nextVideoUrl: undefined,
        currentVideoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        currentPosterUrl: "https://media.example.test/old.webp",
        videoIdOf,
      });
      expect(result).toEqual({});
    });

    it("leaves the column untouched when videoUrl was not part of this save, and the row has no video at all", async () => {
      const result = await resolveEventVideoPoster(db, {
        nextVideoUrl: undefined,
        currentVideoUrl: null,
        currentPosterUrl: null,
        videoIdOf,
      });
      expect(result).toEqual({});
    });

    it("fetches one, even though videoUrl was not part of this save, for a row that already has a YouTube video_url but no poster yet (found by re-review: §266 means no form posts videoUrl any more, so this was the only way an existing event's blank rectangle was ever going to fill in)", async () => {
      const bytes = await JPEG();
      const result = await resolveEventVideoPoster(db, {
        nextVideoUrl: undefined,
        currentVideoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        currentPosterUrl: null,
        videoIdOf,
        fetchImpl: fetchWithHqdefault(bytes),
      });
      expect(result).toEqual({ videoPosterUrl: posterUrlFor("dQw4w9WgXcQ") });
    });

    it("clears the poster when the film is cleared", async () => {
      const result = await resolveEventVideoPoster(db, {
        nextVideoUrl: null,
        currentVideoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        currentPosterUrl: "https://media.example.test/old.webp",
        videoIdOf,
      });
      expect(result).toEqual({ videoPosterUrl: null });
    });

    it("stores the new poster on a successful fetch", async () => {
      const bytes = await JPEG();
      const result = await resolveEventVideoPoster(db, {
        nextVideoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        currentVideoUrl: null,
        currentPosterUrl: null,
        videoIdOf,
        fetchImpl: fetchWithHqdefault(bytes),
      });
      expect(result).toEqual({ videoPosterUrl: posterUrlFor("dQw4w9WgXcQ") });
    });

    it("keeps the old poster on a failed re-fetch of the *same* video (a transient failure)", async () => {
      const result = await resolveEventVideoPoster(db, {
        nextVideoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        currentVideoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        currentPosterUrl: "https://media.example.test/old.webp",
        videoIdOf,
        fetchImpl: fetchAlwaysFails,
      });
      expect(result).toEqual({ videoPosterUrl: "https://media.example.test/old.webp" });
    });

    it("falls back to no poster (the text facade) when a *new* video's first fetch fails", async () => {
      const result = await resolveEventVideoPoster(db, {
        nextVideoUrl: "https://www.youtube.com/watch?v=AAAAAAAAAAA",
        currentVideoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        currentPosterUrl: "https://media.example.test/old.webp",
        videoIdOf,
        fetchImpl: fetchAlwaysFails,
      });
      expect(result).toEqual({ videoPosterUrl: null });
    });
  });

  describe("a rich-text body's own films", () => {
    it("attaches a poster to a youtube block that has none, and leaves one that already has one", async () => {
      const bytes = await JPEG();
      const doc = {
        type: "doc" as const,
        content: [
          { type: "youtube", attrs: { videoId: "dQw4w9WgXcQ", poster: null } },
          { type: "youtube", attrs: { videoId: "AAAAAAAAAAA", poster: "https://media.example.test/kept.webp" } },
          { type: "paragraph", content: [] },
        ],
      };
      const attached = await attachYoutubePosters(db, doc, { fetchImpl: fetchWithHqdefault(bytes) });
      expect(attached.content?.[0]).toMatchObject({ attrs: { poster: posterUrlFor("dQw4w9WgXcQ") } });
      expect(attached.content?.[1]).toMatchObject({ attrs: { poster: "https://media.example.test/kept.webp" } });
      expect(attached.content?.[2]).toEqual({ type: "paragraph", content: [] });
    });
  });

  describe("save → poster stored → read model, and the orphan sweep", () => {
    it("an event's stored poster is read back through the public columns, and counted by the sweep", async () => {
      const bytes = await JPEG();
      const now = new Date("2026-09-25T10:00:00Z");
      const posterUrl = await ensureYoutubePoster(db, "dQw4w9WgXcQ", { now, fetchImpl: fetchWithHqdefault(bytes) });
      expect(posterUrl).not.toBeNull();

      const [event] = await db
        .insert(events)
        .values({
          type: "GROUP_RUN",
          eventStatus: "SCHEDULED",
          timezone: "Europe/Bucharest",
          startsAt: now,
          videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          videoPosterUrl: posterUrl,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      expect(event.videoPosterUrl).toBe(posterUrl);

      // Referenced by the event row it is on: the sweep must not take it.
      const before = await countMediaAssets(db, now);
      expect(before.total).toBe(1);
      expect(before.unreferenced).toBe(0);

      const deleted = await sweepOrphanAssets(db, new Date(now.getTime() + 8 * 24 * 60 * 60_000));
      expect(deleted).toBe(0);
      const stillThere = await db.select().from(mediaAssets).where(eq(mediaAssets.keyPrefix, posterKeyPrefix("dQw4w9WgXcQ")));
      expect(stillThere).toHaveLength(1);
    });

    it("sweeps a poster once its event no longer points at it, like any other unreferenced picture", async () => {
      const bytes = await JPEG();
      const t0 = new Date("2026-09-01T10:00:00Z");
      await ensureYoutubePoster(db, "AAAAAAAAAAA", { now: t0, fetchImpl: fetchWithHqdefault(bytes) });

      const eightDaysLater = new Date(t0.getTime() + 8 * 24 * 60 * 60_000);
      const deleted = await sweepOrphanAssets(db, eightDaysLater);
      expect(deleted).toBe(1);
      const rows = await db.select().from(mediaAssets).where(eq(mediaAssets.keyPrefix, posterKeyPrefix("AAAAAAAAAAA")));
      expect(rows).toHaveLength(0);
    });

    it("rides the registration-maintenance job like any other picture (AGENTS.md §17)", async () => {
      const bytes = await JPEG();
      const t0 = new Date("2026-08-01T10:00:00Z");
      await ensureYoutubePoster(db, "BBBBBBBBBBB", { now: t0, fetchImpl: fetchWithHqdefault(bytes) });

      const muchLater = new Date(t0.getTime() + 30 * 24 * 60 * 60_000);
      await runRegistrationMaintenance(db, muchLater);
      const rows = await db.select().from(mediaAssets).where(eq(mediaAssets.keyPrefix, posterKeyPrefix("BBBBBBBBBBB")));
      expect(rows).toHaveLength(0);
    });

    it("sweeps a poster whose id carries an underscore even though a look-alike address elsewhere differs only in that one character (found by re-review, `DECISIONS.md` §NNN)", async () => {
      const bytes = await JPEG();
      const t0 = new Date("2026-09-01T10:00:00Z");
      // A YouTube id may itself carry `_`, unlike the UUIDs every other `key_prefix` used to be.
      const posterUrl = await ensureYoutubePoster(db, "ab_cdefghij", { now: t0, fetchImpl: fetchWithHqdefault(bytes) });
      expect(posterUrl).not.toBeNull();

      // An unrelated event whose own poster address differs from the one above by exactly the
      // underscore's position — an unescaped `LIKE` reads `_` as "any one character" and would
      // count this as a reference to the asset above, over-retaining it forever.
      await db.insert(events).values({
        type: "GROUP_RUN",
        eventStatus: "SCHEDULED",
        timezone: "Europe/Bucharest",
        startsAt: t0,
        videoPosterUrl: (posterUrl as string).replace("ab_cdefghij", "abXcdefghij"),
        createdAt: t0,
        updatedAt: t0,
      });

      const eightDaysLater = new Date(t0.getTime() + 8 * 24 * 60 * 60_000);
      const deleted = await sweepOrphanAssets(db, eightDaysLater);
      expect(deleted).toBe(1);
      const rows = await db.select().from(mediaAssets).where(eq(mediaAssets.keyPrefix, posterKeyPrefix("ab_cdefghij")));
      expect(rows).toHaveLength(0);
    });
  });

  /**
   * The wiring, not just the fetch (found by re-review): the earlier tests here call
   * `ensureYoutubePoster`/`attachYoutubePosters`/`resolveEventVideoPoster` directly and insert
   * the event row by hand, which proves the fetch and the storage but nothing about whether the
   * real save services ever call them with the right arguments. These go the whole way through
   * `createEvent` and `saveEventAndTranslations` — the paths the editor and the create form
   * actually post to — using `fetchImpl` as the seam, never a live request.
   */
  describe("through the real save services", () => {
    const EVENT_FIELDS = {
      type: "GROUP_RUN",
      eventStatus: "SCHEDULED",
      timezone: "Europe/Bucharest",
      startsAtWallTime: "2026-10-11T09:00",
      endsAtWallTime: "",
      raceStartsAtWallTime: "",
      locationName: "Parcul Tractorul",
      locationAddress: "",
      surface: null,
      difficulty: null,
      costType: null,
      mapUrl: "",
      routeUrl: "",
      distanceMeters: "",
      elevationGainMeters: "",
      featured: false,
      registrationMode: "NONE",
      participantListVisibility: "HIDDEN" as const,
      capacity: "",
      registrationOpensAtWallTime: "",
      registrationClosesAtWallTime: "",
      declarationDocumentId: "",
      externalProvider: "",
      externalRegistrationUrl: "",
    };

    it("createEvent stores a poster for the event's own videoUrl, fetched before the row exists", async () => {
      const bytes = await JPEG();
      const created = await createEvent(db, {
        actor: admin,
        fields: {
          ...EVENT_FIELDS,
          videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          translations: {
            ro: { slug: "cros-video", title: "Cros cu film", excerpt: "" },
            en: { slug: "video-race", title: "Race with a film", excerpt: "" },
          },
        },
        fetchImpl: fetchWithHqdefault(bytes),
      });
      const [row] = await db.select().from(events).where(eq(events.id, created.id));
      expect(row.videoPosterUrl).toBe(posterUrlFor("dQw4w9WgXcQ"));
    });

    it("createEvent attaches a poster to a film pasted straight into a new event's description", async () => {
      const bytes = await JPEG();
      const body = JSON.stringify({ type: "doc", content: [{ type: "youtube", attrs: { videoId: "AAAAAAAAAAA" } }] });
      const created = await createEvent(db, {
        actor: admin,
        fields: {
          ...EVENT_FIELDS,
          translations: {
            ro: { slug: "cros-cu-film-in-descriere", title: "Cros", excerpt: "", body },
            en: { slug: "race-with-a-film-in-the-body", title: "Race", excerpt: "", body },
          },
        },
        fetchImpl: fetchWithHqdefault(bytes),
      });
      const [translation] = await db
        .select()
        .from(eventTranslations)
        .where(eq(eventTranslations.eventId, created.id));
      const stored = translation.bodyJson as { content?: { type: string; attrs?: { poster?: string } }[] };
      expect(stored.content?.[0]).toMatchObject({ attrs: { poster: posterUrlFor("AAAAAAAAAAA") } });
    });

    it("saveEventAndTranslations attaches a poster to a film pasted into a translation, fetched before the capacity lock opens", async () => {
      const bytes = await JPEG();
      const created = await createEvent(db, {
        actor: admin,
        fields: {
          ...EVENT_FIELDS,
          translations: {
            ro: { slug: "cros-fara-film", title: "Cros", excerpt: "" },
            en: { slug: "race-without-a-film", title: "Race", excerpt: "" },
          },
        },
      });
      const translations = await db.select().from(eventTranslations).where(eq(eventTranslations.eventId, created.id));
      const ro = translations.find((row) => row.locale === "ro");
      if (!ro) throw new Error("expected a Romanian translation");

      const body = JSON.stringify({ type: "doc", content: [{ type: "youtube", attrs: { videoId: "BBBBBBBBBBB" } }] });
      await saveEventAndTranslations(db, {
        actor: admin,
        eventId: created.id,
        translations: [{ translationId: ro.id, expectedVersion: ro.version, fields: { slug: ro.slug, title: ro.title, excerpt: "", body } }],
        fetchImpl: fetchWithHqdefault(bytes),
      });

      const [saved] = await db.select().from(eventTranslations).where(eq(eventTranslations.id, ro.id));
      const stored = saved.bodyJson as { content?: { type: string; attrs?: { poster?: string } }[] };
      expect(stored.content?.[0]).toMatchObject({ attrs: { poster: posterUrlFor("BBBBBBBBBBB") } });
    });

    /**
     * No poster fetch ever runs inside a transaction, on any entry point (`DECISIONS.md` §NNN).
     *
     * The proof is recorded, never thrown: `db.transaction` is wrapped to count how many are open,
     * and every call to the global `fetch` — the one every poster fetch reaches when no
     * `fetchImpl` is passed, which is how the admin actions call these services — writes down
     * whether one was. A fetch that threw instead would prove nothing: `fetchYoutubeThumbnail`
     * catches every error and tries the next quality, so the save would succeed either way.
     *
     * One film in each save never answers (`NEVER_ANSWERS`): a poster that failed before the
     * transaction is exactly the one a second pass inside it would try again, which is the case
     * the review found.
     */
    describe("no poster fetch ever runs inside a transaction, on any entry point", () => {
      const NEVER_ANSWERS = "never-answr";
      const film = (...videoIds: string[]) =>
        JSON.stringify({ type: "doc", content: videoIds.map((videoId) => ({ type: "youtube", attrs: { videoId } })) });
      const watchUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`;

      afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
      });

      function watchPosterFetches(bytes: Buffer) {
        let open = 0;
        const realTransaction = db.transaction.bind(db);
        vi.spyOn(db, "transaction").mockImplementation((async (...args: Parameters<typeof db.transaction>) => {
          open += 1;
          try {
            return await realTransaction(...args);
          } finally {
            open -= 1;
          }
        }) as typeof db.transaction);
        const calls: { videoId: string; insideTransaction: boolean }[] = [];
        vi.stubGlobal(
          "fetch",
          vi.fn(async (url: string | URL | Request) => {
            const address = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
            const videoId = /\/vi\/([\w-]{11})\//.exec(address)?.[1] ?? address;
            calls.push({ videoId, insideTransaction: open > 0 });
            if (videoId !== NEVER_ANSWERS && address.endsWith("/hqdefault.jpg")) {
              return new Response(new Uint8Array(bytes), { status: 200 });
            }
            return new Response(null, { status: 404 });
          }),
        );
        return calls;
      }

      /** Every film was asked for, nothing else was, and not one request ran with a transaction open. */
      function expectFetchedOutside(calls: { videoId: string; insideTransaction: boolean }[], videoIds: string[]) {
        expect(calls.length).toBeGreaterThan(0);
        expect(calls.filter((call) => call.insideTransaction)).toEqual([]);
        expect(new Set(calls.map((call) => call.videoId))).toEqual(new Set(videoIds));
      }

      const posterOf = (doc: unknown, index = 0) =>
        (doc as { content?: { attrs?: { poster?: string | null } }[] } | null)?.content?.[index]?.attrs?.poster ?? null;

      /** A new event with a film in every rich text of both languages, and one that never answers. */
      const FILMED_EVENT = () => ({
        ...EVENT_FIELDS,
        videoUrl: watchUrl("event-film1"),
        translations: Object.fromEntries(
          (["ro", "en"] as const).map((locale) => [
            locale,
            {
              slug: `filme-${locale}`,
              title: "Cros",
              excerpt: "",
              body: film("body-film-1", NEVER_ANSWERS),
              rules: film("rules-film1"),
              schedule: film("sched-film1"),
              routeDescription: film("route-film1"),
              excerptBody: film("excpt-film1"),
            },
          ]),
        ),
      });
      const FILMED_EVENT_IDS = ["event-film1", "body-film-1", NEVER_ANSWERS, "rules-film1", "sched-film1", "route-film1", "excpt-film1"];

      async function expectEveryTextPostered(eventId: string) {
        const rows = await db.select().from(eventTranslations).where(eq(eventTranslations.eventId, eventId));
        expect(rows).toHaveLength(2);
        for (const row of rows) {
          expect(posterOf(row.bodyJson)).toBe(posterUrlFor("body-film-1"));
          expect(posterOf(row.bodyJson, 1)).toBeNull();
          expect(posterOf(row.rulesJson)).toBe(posterUrlFor("rules-film1"));
          expect(posterOf(row.routeDescriptionJson)).toBe(posterUrlFor("route-film1"));
          expect(posterOf(row.excerptJson)).toBe(posterUrlFor("excpt-film1"));
          // A group run keeps no programme (§111); the film in it was still fetched, outside.
        }
        const [event] = await db.select().from(events).where(eq(events.id, eventId));
        expect(event.videoPosterUrl).toBe(posterUrlFor("event-film1"));
      }

      async function plainEvent(capacity = "") {
        const created = await createEvent(db, {
          actor: admin,
          fields: {
            ...EVENT_FIELDS,
            capacity,
            translations: {
              ro: { slug: "cros-simplu", title: "Cros", excerpt: "" },
              en: { slug: "plain-race", title: "Race", excerpt: "" },
            },
          },
        });
        const translations = await db.select().from(eventTranslations).where(eq(eventTranslations.eventId, created.id));
        const ro = translations.find((row) => row.locale === "ro");
        const en = translations.find((row) => row.locale === "en");
        if (!ro || !en) throw new Error("expected both translations");
        return { created, ro, en };
      }

      it("createEvent: the event's film and every rich text's films, in both languages, are fetched before its transaction opens", async () => {
        const calls = watchPosterFetches(await JPEG());
        const created = await createEvent(db, { actor: admin, fields: FILMED_EVENT() });
        expectFetchedOutside(calls, FILMED_EVENT_IDS);
        await expectEveryTextPostered(created.id);
      });

      it("createEventAndPublish: the same, before the transaction that creates and publishes", async () => {
        const calls = watchPosterFetches(await JPEG());
        const result = await createEventAndPublish(db, { actor: admin, fields: FILMED_EVENT(), publish: false });
        expectFetchedOutside(calls, FILMED_EVENT_IDS);
        await expectEveryTextPostered(result.event.id);
      });

      it("saveEventFields: the event's own film is fetched before the transaction that locks it for capacity", async () => {
        const { created } = await plainEvent("10");
        const calls = watchPosterFetches(await JPEG());
        const saved = await saveEventFields(db, {
          actor: admin,
          eventId: created.id,
          expectedVersion: created.version,
          fields: { ...EVENT_FIELDS, capacity: "10", videoUrl: watchUrl("event-film2") },
        });
        expectFetchedOutside(calls, ["event-film2"]);
        expect(saved.videoPosterUrl).toBe(posterUrlFor("event-film2"));
      });

      it("saveEventAndTranslations: every text's films, and one whose first fetch failed, are never fetched again behind the capacity lock", async () => {
        const { created, ro, en } = await plainEvent("10");
        const calls = watchPosterFetches(await JPEG());
        const texts = (translation: typeof ro) => ({
          slug: translation.slug,
          title: translation.title,
          excerpt: "",
          // The film that never answers in one language only, so its three requests are countable:
          // both languages' films are fetched side by side, and each would ask on its own.
          body: film("body-film-2", ...(translation.locale === "ro" ? [NEVER_ANSWERS] : [])),
          rules: film("rules-film2"),
          routeDescription: film("route-film2"),
          excerptBody: film("excpt-film2"),
        });
        await saveEventAndTranslations(db, {
          actor: admin,
          eventId: created.id,
          expectedVersion: created.version,
          fields: { ...EVENT_FIELDS, capacity: "10", videoUrl: watchUrl("event-film3") },
          translations: [
            { translationId: ro.id, expectedVersion: ro.version, fields: texts(ro) },
            { translationId: en.id, expectedVersion: en.version, fields: texts(en) },
          ],
        });
        expectFetchedOutside(calls, ["event-film3", "body-film-2", NEVER_ANSWERS, "rules-film2", "route-film2", "excpt-film2"]);
        // Asked once per quality and never again: three for the film that never answers.
        expect(calls.filter((call) => call.videoId === NEVER_ANSWERS)).toHaveLength(3);
        const [saved] = await db.select().from(eventTranslations).where(eq(eventTranslations.id, ro.id));
        expect(posterOf(saved.bodyJson)).toBe(posterUrlFor("body-film-2"));
        expect(posterOf(saved.bodyJson, 1)).toBeNull();
        expect(posterOf(saved.rulesJson)).toBe(posterUrlFor("rules-film2"));
      });

      it("saveEventTranslation: one language's films are fetched before its guarded write, and only for someone who may write it", async () => {
        const { ro } = await plainEvent();
        const calls = watchPosterFetches(await JPEG());
        const posted = { slug: ro.slug, title: ro.title, excerpt: "", body: film("body-film-3", NEVER_ANSWERS), rules: film("rules-film3") };

        const [contributor] = await db
          .insert(staffUsers)
          .values({ email: "contributor@dev.test", displayName: "Contributor", role: "CONTRIBUTOR" })
          .returning();
        await expect(
          saveEventTranslation(db, { actor: contributor, translationId: ro.id, expectedVersion: ro.version, fields: posted }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        expect(calls).toEqual([]);

        await saveEventTranslation(db, { actor: admin, translationId: ro.id, expectedVersion: ro.version, fields: posted });
        expectFetchedOutside(calls, ["body-film-3", NEVER_ANSWERS, "rules-film3"]);
        const [saved] = await db.select().from(eventTranslations).where(eq(eventTranslations.id, ro.id));
        expect(posterOf(saved.bodyJson)).toBe(posterUrlFor("body-film-3"));
        expect(posterOf(saved.rulesJson)).toBe(posterUrlFor("rules-film3"));
      });

      it("createPage and savePage: a standing page's films are fetched before either transaction opens", async () => {
        const pageFields = (suffix: string, videoId: string) => ({
          navOrder: "10",
          translations: {
            ro: { slug: `despre-${suffix}`, title: "Despre", body: film(videoId, NEVER_ANSWERS), seoTitle: "", seoDescription: "" },
            en: { slug: `about-${suffix}`, title: "About", body: film(videoId), seoTitle: "", seoDescription: "" },
          },
        });
        const calls = watchPosterFetches(await JPEG());
        const page = await createPage(db, { actor: admin, fields: pageFields("noi", "page-film-1") });
        expectFetchedOutside(calls, ["page-film-1", NEVER_ANSWERS]);

        calls.length = 0;
        await savePage(db, { actor: admin, pageId: page.id, expectedVersion: page.version, fields: pageFields("noi", "page-film-2") });
        expectFetchedOutside(calls, ["page-film-2", NEVER_ANSWERS]);
        const rows = await db.select().from(pageTranslations).where(eq(pageTranslations.pageId, page.id));
        for (const row of rows) expect(posterOf(row.bodyJson)).toBe(posterUrlFor("page-film-2"));
      });
    });
  });
});
