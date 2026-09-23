import { readFileSync } from "node:fs";
import path from "node:path";
import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { eventInputConstraints } from "@/modules/content/events/constraints";
import { eventFieldsSchema, newEventSchema } from "@/modules/content/events/fields";
import { missingPublicEventFields } from "@/modules/content/events/service";
import PlaceToBeAnnounced from "@/modules/content/events/ui/PlaceToBeAnnounced";
import { textFieldConstraints } from "@/shared/forms/constraints";
import { RecallProvider } from "@/shared/forms/recall";

/**
 * BR-REQ-011-01 criterion 19 (`DECISIONS.md` §NNN) — "Locația se anunță mai târziu".
 *
 * The owner, 2026-09-23: "I want to be able to set the location as TBD, and to not announce it
 * yet". A state of the event, not an empty field: with the switch on, the meeting point is not
 * required — by the schema, by the browser and by publication — and what was typed is kept. With
 * it off, the rule of §36 stands exactly as before.
 */
const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

const BASE = {
  type: "RACE",
  surface: "",
  eventStatus: "SCHEDULED",
  timezone: "Europe/Bucharest",
  startsAtWallTime: "2026-11-21T09:00",
  endsAtWallTime: "",
  raceStartsAtWallTime: "",
  locationName: "",
  locationAddress: "",
  difficulty: "",
  costType: "",
  mapUrl: "",
  routeUrl: "",
  distanceMeters: "",
  elevationGainMeters: "",
  featured: false,
  registrationMode: "NONE",
  capacity: "",
  registrationOpensAtWallTime: "",
  registrationClosesAtWallTime: "",
  declarationDocumentId: "",
  externalProvider: "",
  externalRegistrationUrl: "",
  participantListVisibility: "HIDDEN",
} as const;

describe("BR-REQ-011-01 criterion 19 the schema: a meeting point, unless the place is to be announced", () => {
  it("refuses a blank place with the switch off, naming the box — the rule of §36, unchanged", () => {
    const parsed = eventFieldsSchema.safeParse(BASE);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.path.join("."))).toEqual(["locationName"]);
    // An absent switch is "announced", like every row before it existed.
    expect(eventFieldsSchema.safeParse({ ...BASE, locationName: "Parcul Tractorul" }).data?.locationToBeAnnounced).toBe(false);
  });

  it("accepts a blank place with the switch on, and keeps a typed one as typed", () => {
    const blank = eventFieldsSchema.safeParse({ ...BASE, locationToBeAnnounced: true });
    expect(blank.success).toBe(true);
    expect(blank.data?.locationName).toBeNull();

    const typed = eventFieldsSchema.safeParse({ ...BASE, locationToBeAnnounced: true, locationName: " Sala Sporturilor ", mapUrl: "https://maps.example/sala" });
    expect(typed.data).toMatchObject({ locationName: "Sala Sporturilor", mapUrl: "https://maps.example/sala", locationToBeAnnounced: true });
  });

  it("is the create form's rule too, both languages beside it", () => {
    const language = { slug: "crosul", title: "Crosul", excerpt: "Rezumat." };
    const fields = { ...BASE, translations: { ro: language, en: { ...language, slug: "the-cross" } } };
    expect(newEventSchema.safeParse(fields).success).toBe(false);
    expect(newEventSchema.safeParse({ ...fields, locationToBeAnnounced: true }).success).toBe(true);
  });

  it("still types the place's ceiling and a map link's https, switch or no switch", () => {
    expect(eventFieldsSchema.safeParse({ ...BASE, locationToBeAnnounced: true, locationName: "x".repeat(201) }).success).toBe(false);
    expect(eventFieldsSchema.safeParse({ ...BASE, locationToBeAnnounced: true, mapUrl: "http://maps.example" }).success).toBe(false);
  });
});

describe("BR-REQ-011-01 criterion 19 publication", () => {
  it("needs no meeting point while the place is to be announced, and one otherwise", () => {
    expect(missingPublicEventFields({ locationName: null, locationToBeAnnounced: true })).toEqual([]);
    expect(missingPublicEventFields({ locationName: "  ", locationToBeAnnounced: true })).toEqual([]);
    expect(missingPublicEventFields({ locationName: null, locationToBeAnnounced: false })).toEqual(["locationName"]);
    expect(missingPublicEventFields({ locationName: "Parcul Tractorul", locationToBeAnnounced: false })).toEqual([]);
  });
});

describe("BR-REQ-011-01 criterion 19 the editor's constraints follow the switch (§315)", () => {
  const box = textFieldConstraints(eventInputConstraints("locationName"));
  const labels = {
    toggle: "Locația se anunță mai târziu",
    toggleHelp: "Ajutor.",
    locationName: "Punct de întâlnire",
    locationHelp: "Locul, cum i-ai spune unui prieten.",
    unpublished: "Nepublicat cât timp locația se anunță mai târziu.",
  };
  const render = (defaultChecked: boolean, values: Record<string, string[]> | null = null, typed = "") =>
    renderToStaticMarkup(
      createElement(
        RecallProvider,
        { value: { values, fields: [], generation: values ? 1 : 0, fieldError: "Verifică acest câmp." } } as unknown as ComponentProps<typeof RecallProvider>,
        createElement(PlaceToBeAnnounced, { defaultChecked, labels, locationName: { defaultValue: typed, box } }, createElement("input", { name: "event.mapUrl" })),
      ),
    );
  /** The meeting point's `<input>`, as the browser receives it. */
  const locationInput = (html: string) => /<input[^>]*name="event\.locationName"[^>]*>/.exec(html)?.[0] ?? "";
  const switchInput = (html: string) => /<input[^>]*name="event\.locationToBeAnnounced"[^>]*>/.exec(html)?.[0] ?? "";

  it("reads `required` and the ceiling off the schema, so the browser refuses what the server refuses", () => {
    expect(eventInputConstraints("locationName")).toMatchObject({ required: true, maxLength: 200 });
    // The form hands the island the schema's own box, never a second list.
    expect(read("src/modules/content/events/ui/EventFieldsForm.tsx")).toContain('box: box("locationName")');
  });

  it("asks for the place while the switch is off", () => {
    const html = render(false);
    expect(locationInput(html)).toMatch(/\brequired\b/);
    expect(locationInput(html)).toContain('maxLength="200"');
    expect(switchInput(html)).not.toMatch(/\bchecked\b/);
    expect(html).not.toContain(labels.unpublished);
  });

  it("does not ask for it while the switch is on, keeps what was typed, and says it is not published", () => {
    const html = render(true, null, "Sala Sporturilor");
    expect(locationInput(html)).not.toMatch(/\brequired\b/);
    expect(locationInput(html)).toContain('value="Sala Sporturilor"');
    expect(locationInput(html)).toContain('maxLength="200"');
    expect(switchInput(html)).toMatch(/\bchecked\b/);
    expect(html).toContain(labels.unpublished);
    // The map link's box is still there, under the name, kept like it.
    expect(html).toContain('name="event.mapUrl"');
  });

  it("comes back as it was posted after a refusal: on when posted, off when not — whatever the page said", () => {
    expect(locationInput(render(false, { "event.locationToBeAnnounced": ["on"] }))).not.toMatch(/\brequired\b/);
    expect(locationInput(render(true, { "event.locationName": [""] }))).toMatch(/\brequired\b/);
  });

  it("is on both pages, and the create button's gap follows it", () => {
    // One `EventFieldsForm` for the editor and the create page (§303).
    expect(read("src/app/[locale]/admin/events/new/page.tsx")).toContain("<EventFieldsForm");
    expect(read("src/app/[locale]/admin/events/[id]/page.tsx")).toContain("<EventFieldsForm");
    const button = read("src/modules/content/events/ui/CreateAndPublishButton.tsx");
    expect(button).toContain('data.get("event.locationToBeAnnounced") === "on"');
    expect(button).toMatch(/!announcedLater && text\("event\.locationName"\) === ""/);
    // The action reads the switch by the name the island posts.
    expect(read("src/app/[locale]/admin/actions.ts")).toContain('locationToBeAnnounced: form.get("event.locationToBeAnnounced") === "on"');
  });
});

describe("BR-REQ-011-01 criterion 19 the migration", () => {
  it("adds one column with a default, and nothing else (AGENTS.md §7.6: expand only)", () => {
    const sql = read("src/db/migrations/0060_location_to_be_announced.sql").trim();
    expect(sql).toBe('ALTER TABLE "events" ADD COLUMN "location_to_be_announced" boolean DEFAULT false NOT NULL;');
    const journal = JSON.parse(read("src/db/migrations/meta/_journal.json")) as { entries: Array<{ idx: number; tag: string }> };
    expect(journal.entries.find((entry) => entry.idx === 60)?.tag).toBe("0060_location_to_be_announced");
  });
});
