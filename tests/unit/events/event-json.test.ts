import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { changeValueOf, comparable, diffConfigs, FIELD_LABELS, labelOf, leavesOf } from "@/modules/content/events/transfer/diff";
import {
  EVENT_FILE_FORMAT,
  EVENT_FILE_VERSION,
  type EventConfig,
  type EventFile,
  MAX_EVENT_FILE_BYTES,
  readEventFile,
} from "@/modules/content/events/transfer/file-format";
import { collectMediaRefs, isFetchableMediaUrl, mapMediaUrls, MEDIA_ROLE_KEYS, mediaRoleKey, sha256Hex, storeKeyOfUrl } from "@/modules/content/events/transfer/media";
import { DEFAULT_BIB_DESIGN } from "@/modules/registrations/bib-design";

/**
 * An event as a JSON file (§751): the file's shape, the refusals of a file that is not one of ours,
 * the pictures found in a configuration and the addresses that may be fetched, and the diff — all
 * without a database. The integration tests (`tests/integration/events/event-json.test.ts`) run
 * the same pieces against the editor's service.
 */

const PICTURE = "https://media.example.test/production/0a1b2c3d-0a1b-4c3d-8a1b-0a1b2c3d4e5f/web.webp";
const OTHER_PICTURE = "https://media.example.test/production/1a1b2c3d-0a1b-4c3d-8a1b-0a1b2c3d4e5f/web.webp";
const GPX = "https://media.example.test/production/route-gpx/2a1b2c3d-0a1b-4c3d-8a1b-0a1b2c3d4e5f/traseu.gpx";

const doc = (text: string, ...srcs: string[]) => ({
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text }] },
    ...srcs.map((src) => ({ type: "image", attrs: { src, alt: "", caption: "", widthPercent: 100, align: "block", crop: null } })),
  ],
});

const translation = (suffix: string, body: ReturnType<typeof doc> | null = null) => ({
  slug: `cursa-${suffix}`,
  title: `Cursa ${suffix}`,
  excerpt: "Rezumat.",
  excerptBody: null,
  checklist: "Frontală",
  body,
  rules: doc("Regulament."),
  schedule: null,
  routeDescription: null,
  seoTitle: null,
  seoDescription: null,
  discountNote: null,
  weatherNote: null,
});

/** Every key of the configuration, once — the one object whose leaves are every label there is. */
function sampleConfig(): EventConfig {
  return {
    type: "RACE",
    surface: "TRAIL",
    timezone: "Europe/Bucharest",
    start: { date: "2026-11-21", time: "09:00" },
    durationMinutes: 150,
    raceStartsAt: "2026-11-21T08:00:00.000Z",
    dateToBeAnnounced: false,
    timeToBeAnnounced: false,
    programme: [{ startsAt: "2026-11-21T06:00:00.000Z", endsAt: null, label: { ro: "Kit", en: "Kit" }, place: null }],
    place: {
      name: { ro: "Poiana", en: "Poiana" },
      address: null,
      toBeAnnounced: false,
      mapUrl: "https://maps.example.test/pin",
      coordinates: { latitude: 45.6, longitude: 25.58 },
    },
    weather: { mode: "forecast" },
    route: {
      url: null,
      maps: [{ provider: "garmin", id: "987654321" }],
      gpx: { name: "traseu.gpx", url: GPX },
      // The route's checkpoints (§757): one with a cut-off and a note, one without either.
      checkpoints: [
        { km: 7.5, name: { ro: "Apă la cabană", en: "Water at the hut" }, kinds: ["WATER", "FOOD"], cutoff: "10:45", note: { ro: "Și banane", en: "Bananas too" } },
        { km: 15, name: { ro: "Cronometrare", en: "Timing" }, kinds: ["TIMING"], cutoff: null, note: { ro: null, en: null } },
      ],
    },
    links: [],
    partners: [],
    stravaEventUrl: null,
    facebookEventUrl: null,
    measures: { distanceMeters: 21000, distanceEstimated: false, elevationGainMeters: 900, elevationGainEstimated: false },
    difficultyLevel: 11,
    nightOverride: null,
    cost: { type: "PAID", amount: "100 lei", url: null },
    offersGroupRunDeclaration: false,
    isSpecial: false,
    membersOnly: false,
    cover: { url: PICTURE, crop: { x: 0, y: 0, w: 0.5, h: 0.5 } },
    registration: {
      mode: "INTERNAL",
      capacity: 100,
      waitlist: { choice: "LIMITED", limit: 20 },
      waitlistAutoOffer: true,
      opensAt: null,
      opensSoon: false,
      closesAt: null,
      confirmationOpensDaysBefore: 7,
      confirmationDeadlineDaysBefore: 2,
      minAge: 16,
      reminderHoursBefore: null,
      declaration: { key: "EVENT_DECLARATION" },
      external: { provider: null, url: null },
      kitShirt: false,
      askHealthNote: false,
    },
    publicList: { names: false, waitlist: false, waitlistCount: true, count: true, club: "members_only" },
    hiddenList: { enabled: false, bibStart: null, counted: false, public: false },
    bib: { startNumber: 100, colour: "#1a73e8", design: { ...DEFAULT_BIB_DESIGN, headerImageSrc: PICTURE } as unknown as Record<string, unknown> },
    translations: { ro: translation("ro", doc("Bun venit.", PICTURE)), en: translation("en") },
  };
}

function sampleFile(): EventFile {
  return {
    format: EVENT_FILE_FORMAT,
    version: EVENT_FILE_VERSION,
    exportedAt: "2026-10-13T10:00:00.000Z",
    exportedFrom: { environment: "production", baseline: "BR-V3.21-2026-10-14" },
    series: { partOfASeries: false, rule: null },
    event: sampleConfig(),
    media: [{ role: "cover", url: PICTURE, contentType: "image/webp", size: 10, sha256: "a".repeat(64) }],
  };
}

describe("the event file's reader", () => {
  it("reads a file of this release, as written", () => {
    const read = readEventFile(JSON.stringify(sampleFile()));
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.file.event.translations.ro.title).toBe("Cursa ro");
  });

  it("refuses what is not one of ours, saying which of the five reasons it is", () => {
    const refusal = (raw: string) => {
      const read = readEventFile(raw);
      return read.ok ? "ok" : read.refusal;
    };
    expect(refusal("not json at all")).toBe("notJson");
    expect(refusal("[1, 2]")).toBe("notAnEventFile");
    expect(refusal("{}")).toBe("notAnEventFile");
    expect(refusal(JSON.stringify({ ...sampleFile(), format: "somebody.else" }))).toBe("notAnEventFile");
    expect(refusal(JSON.stringify({ ...sampleFile(), version: EVENT_FILE_VERSION + 1 }))).toBe("unknownVersion");
    expect(refusal(JSON.stringify({ ...sampleFile(), version: "2" }))).toBe("unknownVersion");
    expect(refusal(JSON.stringify({ ...sampleFile(), version: undefined }))).toBe("unknownVersion");
    expect(refusal(JSON.stringify({ ...sampleFile(), padding: "x".repeat(MAX_EVENT_FILE_BYTES) }))).toBe("tooLarge");
  });

  /*
    §757: version 2 counts a race's `durationMinutes` from its gun. A version 1 file — what production
    exported before this release — counted from the event's start, and must import with the end it had.
  */
  it("reads a version 1 file with its race's end kept: the minutes from the start become minutes from the gun", () => {
    const old = { ...sampleFile(), version: 1 };
    // 09:00 on the event's clock is 07:00Z in November; the gun at 08:00Z is an hour later, so 150 from the start is 90 from the gun.
    const read = readEventFile(JSON.stringify(old));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.file.version).toBe(EVENT_FILE_VERSION);
    expect(read.file.event.durationMinutes).toBe(90);
    // The end: start + 150 min (v1) = gun + 90 min (v2), the same instant.
    const start = Date.parse("2026-11-21T07:00:00.000Z");
    const gun = Date.parse(read.file.event.raceStartsAt as string);
    expect(gun + 90 * 60_000).toBe(start + 150 * 60_000);
  });

  it("reads a version 1 file unchanged where the gun did not move the count: no gun, another type, no start hour", () => {
    const minutes = (event: Partial<EventConfig>) => {
      const read = readEventFile(JSON.stringify({ ...sampleFile(), version: 1, event: { ...sampleConfig(), ...event } }));
      return read.ok ? read.file.event.durationMinutes : read.refusal;
    };
    expect(minutes({ raceStartsAt: null })).toBe(150);
    expect(minutes({ type: "GROUP_RUN", raceStartsAt: null })).toBe(150);
    expect(minutes({ start: { date: "2026-11-21", time: null } })).toBe(150);
    expect(minutes({ durationMinutes: null })).toBeNull();
  });

  it("refuses a version 1 race whose end was at or before its gun: no time limit is made up", () => {
    const read = readEventFile(JSON.stringify({ ...sampleFile(), version: 1, event: { ...sampleConfig(), durationMinutes: 60 } }));
    expect(read).toMatchObject({ ok: false, refusal: "invalid", detail: "event.durationMinutes" });
  });

  it("names the parts that do not fit, by path and never by value", () => {
    const broken = sampleFile() as unknown as { event: { type: string; place: { mapUrl: unknown } } };
    broken.event.type = "BOGUS";
    broken.event.place.mapUrl = 12;
    const read = readEventFile(JSON.stringify(broken));
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.refusal).toBe("invalid");
      expect(read.detail).toContain("event.type");
      expect(read.detail).toContain("event.place.mapUrl");
      expect(read.detail).not.toContain("BOGUS");
    }
  });

  it("refuses a key it does not know, so a registration or a person cannot ride along", () => {
    const smuggled = sampleFile() as unknown as { event: Record<string, unknown>; registrations?: unknown };
    smuggled.event.registrations = [{ registeredName: "Someone" }];
    expect(readEventFile(JSON.stringify(smuggled)).ok).toBe(false);
    const topLevel = sampleFile() as unknown as Record<string, unknown>;
    topLevel.participants = [];
    expect(readEventFile(JSON.stringify(topLevel)).ok).toBe(false);
    const nested = sampleFile() as unknown as { event: { registration: Record<string, unknown> } };
    nested.event.registration.email = "someone@example.test";
    expect(readEventFile(JSON.stringify(nested)).ok).toBe(false);
  });

  it("refuses a hash that is not a SHA-256 and a declaration that is not a race's", () => {
    const badHash = sampleFile();
    badHash.media[0].sha256 = "xyz";
    expect(readEventFile(JSON.stringify(badHash)).ok).toBe(false);
    const wrongKey = sampleFile() as unknown as { event: { registration: { declaration: { key: string } } } };
    wrongKey.event.registration.declaration = { key: "PRIVACY_NOTICE" };
    expect(readEventFile(JSON.stringify(wrongKey)).ok).toBe(false);
  });
});

describe("the labels a diff speaks in", () => {
  const labels = new Set([...leavesOf(sampleConfig()).keys()].map((path) => labelOf(path).label));

  it("are exactly the leaves of a whole configuration: none missing, none left over", () => {
    expect([...labels].sort()).toEqual([...FIELD_LABELS].sort());
  });

  const words = (catalogue: unknown, path: string): unknown => path.split(".").reduce<unknown>((cursor, key) => (cursor as Record<string, unknown> | undefined)?.[key], catalogue);

  it.each([
    ["ro", ro],
    ["en", en],
  ] as const)("are said in %s, every one, and so are the media roles", (_name, catalogue) => {
    const admin = (catalogue as unknown as { Admin: unknown }).Admin;
    for (const label of FIELD_LABELS) expect(typeof words(admin, `eventJson.fields.${label}`), label).toBe("string");
    for (const role of MEDIA_ROLE_KEYS) expect(typeof words(admin, `eventJson.roles.${role}`), role).toBe("string");
  });

  it("takes the language out of a per-language leaf and says which language it was", () => {
    expect(labelOf("translations.ro.title")).toEqual({ label: "translations.title", locale: "ro" });
    expect(labelOf("place.name.en")).toEqual({ label: "place.name", locale: "en" });
    expect(labelOf("registration.capacity")).toEqual({ label: "registration.capacity", locale: null });
  });
});

describe("the pictures in a configuration", () => {
  it("are found wherever they sit: the cover, the bib's places, a text's figures — a table's cell too — and the GPX", () => {
    const config = sampleConfig();
    // The profile's picture (§759) is one of the bib's places too.
    config.bib.design = { ...config.bib.design, sponsorImageSrc: OTHER_PICTURE, profileImageSrc: OTHER_PICTURE, member: { ...DEFAULT_BIB_DESIGN.member, cardImageSrc: OTHER_PICTURE } };
    config.translations.en.body = {
      type: "doc",
      content: [{ type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [{ type: "image", attrs: { src: OTHER_PICTURE } }] }] }] }],
    };
    const refs = collectMediaRefs(config);
    expect(refs.map((ref) => ref.role)).toEqual(["cover", "bib.header", "bib.sponsors", "bib.profile", "bib.member.card", "text.ro.body", "text.en.body", "route.gpx"]);
    expect(refs.map((ref) => ref.kind)).toEqual(["image", "image", "image", "image", "image", "image", "image", "gpx"]);
  });

  it("are replaced address by address, and one that is taken out leaves the rest of its text", () => {
    const config = sampleConfig();
    const mapped = mapMediaUrls(config, (url, kind) => (kind === "gpx" ? "key" : url === PICTURE ? "/api/media/test/new/web.webp" : null));
    expect(mapped.cover?.url).toBe("/api/media/test/new/web.webp");
    expect((mapped.bib.design as { headerImageSrc: string }).headerImageSrc).toBe("/api/media/test/new/web.webp");
    expect(JSON.stringify(mapped.translations.ro.body)).toContain("/api/media/test/new/web.webp");
    // The original is not touched.
    expect(config.cover?.url).toBe(PICTURE);

    const removed = mapMediaUrls(config, () => null);
    expect(removed.cover).toBeNull();
    expect(removed.route.gpx).toBeNull();
    expect((removed.bib.design as { headerImageSrc: unknown }).headerImageSrc).toBeNull();
    const body = removed.translations.ro.body as { content: Array<{ type: string }> };
    expect(body.content.map((block) => block.type)).toEqual(["paragraph"]);
  });

  it("are found at a store key, and nowhere else", () => {
    expect(storeKeyOfUrl(PICTURE, "image")).toBe("production/0a1b2c3d-0a1b-4c3d-8a1b-0a1b2c3d4e5f/web.webp");
    expect(storeKeyOfUrl("http://localhost:3000/api/media/test/0a1b2c3d-0a1b-4c3d-8a1b-0a1b2c3d4e5f/web.webp", "image")).toBe("test/0a1b2c3d-0a1b-4c3d-8a1b-0a1b2c3d4e5f/web.webp");
    expect(storeKeyOfUrl(GPX, "gpx")).toBe("production/route-gpx/2a1b2c3d-0a1b-4c3d-8a1b-0a1b2c3d4e5f/traseu.gpx");
    expect(storeKeyOfUrl(GPX, "image")).toBeNull();
    expect(storeKeyOfUrl(PICTURE, "gpx")).toBeNull();
    expect(storeKeyOfUrl("https://media.example.test/etc/passwd", "image")).toBeNull();
    expect(storeKeyOfUrl("not a url", "image")).toBeNull();
  });

  it("have a role whose words exist for each of the seven places and the text", () => {
    expect(["cover", "bib.header", "bib.sponsors", "bib.profile", "bib.member.header", "bib.member.card", "route.gpx", "text.ro.rules"].map(mediaRoleKey)).toEqual([
      "cover",
      "bibHeader",
      "bibSponsors",
      "bibProfile",
      "bibMemberHeader",
      "bibMemberCard",
      "gpx",
      "text",
    ]);
  });
});

describe("the addresses an import may fetch", () => {
  const deployed = { allowHttp: false };
  it("are https, a name, and one of this site's own objects", () => {
    expect(isFetchableMediaUrl(PICTURE, "image", deployed)).toBe(true);
    expect(isFetchableMediaUrl(GPX, "gpx", deployed)).toBe(true);
  });

  it.each([
    ["http", "http://media.example.test/production/0a1b2c3d-0a1b-4c3d-8a1b-0a1b2c3d4e5f/web.webp"],
    ["an IPv4 literal", "https://10.0.0.5/production/0a1b2c3d-0a1b-4c3d-8a1b-0a1b2c3d4e5f/web.webp"],
    ["an IPv4 literal of the cloud's metadata", "https://169.254.169.254/production/0a1b2c3d-0a1b-4c3d-8a1b-0a1b2c3d4e5f/web.webp"],
    ["an IPv6 literal", "https://[::1]/production/0a1b2c3d-0a1b-4c3d-8a1b-0a1b2c3d4e5f/web.webp"],
    ["localhost", "https://localhost/production/0a1b2c3d-0a1b-4c3d-8a1b-0a1b2c3d4e5f/web.webp"],
    ["an internal name", "https://store.internal/production/0a1b2c3d-0a1b-4c3d-8a1b-0a1b2c3d4e5f/web.webp"],
    ["a name with no dot", "https://intranet/production/0a1b2c3d-0a1b-4c3d-8a1b-0a1b2c3d4e5f/web.webp"],
    ["credentials", "https://user:secret@media.example.test/production/0a1b2c3d-0a1b-4c3d-8a1b-0a1b2c3d4e5f/web.webp"],
    ["a path that is not an object of ours", "https://media.example.test/admin/users.json"],
    ["a file scheme", "file:///etc/passwd"],
  ])("are refused: %s", (_name, url) => {
    expect(isFetchableMediaUrl(url, "image", deployed)).toBe(false);
  });

  it("allow http and a local name only where the environment is a developer's", () => {
    const local = "http://localhost:3000/api/media/test/0a1b2c3d-0a1b-4c3d-8a1b-0a1b2c3d4e5f/web.webp";
    expect(isFetchableMediaUrl(local, "image", { allowHttp: true })).toBe(true);
    expect(isFetchableMediaUrl(local, "image", deployed)).toBe(false);
  });

  it("hash what they read the way the exporting side did", () => {
    expect(sha256Hex(Buffer.from("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("the diff", () => {
  const same = (config: EventConfig) => comparable(config, (url) => (url === PICTURE ? "aa" : null));

  it("is empty for a configuration against itself", () => {
    expect(diffConfigs(same(sampleConfig()), same(sampleConfig()))).toEqual([]);
  });

  it("names a changed field with both sides, in the language it is in", () => {
    const incoming = sampleConfig();
    incoming.translations.en.title = "The race";
    incoming.registration.capacity = 80;
    incoming.membersOnly = true;
    const changes = diffConfigs(same(incoming), same(sampleConfig()));
    expect(changes.map((change) => change.key)).toEqual(["membersOnly", "registration.capacity", "translations.en.title"]);
    expect(changes[0]).toMatchObject({ from: { type: "boolean", value: false }, to: { type: "boolean", value: true } });
    expect(changes[1]).toMatchObject({ label: "registration.capacity", from: { type: "text", value: "100" }, to: { type: "text", value: "80" } });
    expect(changes[2]).toMatchObject({ label: "translations.title", locale: "en", to: { type: "text", value: "The race" } });
  });

  it("treats a picture as its bytes: the same hash under another address is no change, another hash is", () => {
    const movedAddress = sampleConfig();
    movedAddress.cover = { url: OTHER_PICTURE, crop: { x: 0, y: 0, w: 0.5, h: 0.5 } };
    // The same bytes under another address.
    const digests = (url: string) => (url === PICTURE || url === OTHER_PICTURE ? "aa" : null);
    expect(diffConfigs(comparable(movedAddress, digests), comparable(sampleConfig(), digests))).toEqual([]);
    // Other bytes.
    const changed = diffConfigs(comparable(movedAddress, (url) => (url === OTHER_PICTURE ? "bb" : url === PICTURE ? "aa" : null)), comparable(sampleConfig(), (url) => (url === PICTURE ? "aa" : null)));
    const keys = changed.map((change) => change.key);
    expect(keys).toContain("cover.url");
    expect(changed.find((change) => change.key === "cover.url")).toMatchObject({ from: { type: "picture", known: true }, to: { type: "picture", known: true } });
  });

  it("shows a text as its words and its pictures, and a text that gains a picture as a change", () => {
    const incoming = sampleConfig();
    incoming.translations.ro.body = doc("Bun venit.", PICTURE, OTHER_PICTURE);
    const changes = diffConfigs(same(incoming), same(sampleConfig()));
    expect(changes.map((change) => change.key)).toEqual(["translations.ro.body"]);
    expect(changes[0].from).toEqual({ type: "document", text: "Bun venit.", pictures: 1 });
    expect(changes[0].to).toEqual({ type: "document", text: "Bun venit.", pictures: 2 });
  });

  it("reads an object on one side and none on the other as the leaves that differ, and an empty and a missing alike", () => {
    const withoutCover = sampleConfig();
    withoutCover.cover = null;
    const gone = diffConfigs(same(withoutCover), same(sampleConfig()));
    expect(gone.map((change) => change.key)).toEqual(["cover.url", "cover.crop"]);
    expect(gone[0].to).toEqual({ type: "empty" });
    const back = diffConfigs(same(sampleConfig()), same(withoutCover));
    expect(back.map((change) => change.key)).toEqual(["cover.url", "cover.crop"]);
    expect(changeValueOf("registration.capacity", null)).toEqual({ type: "empty" });
    expect(changeValueOf("cost.amount", "")).toEqual({ type: "empty" });
  });

  it("shortens a long value rather than printing a page of it", () => {
    const value = changeValueOf("translations.ro.title", "x".repeat(900));
    expect(value.type === "text" && value.value.length).toBeLessThanOrEqual(240);
  });
});
