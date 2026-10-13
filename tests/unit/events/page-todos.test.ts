import { describe, expect, it } from "vitest";
import {
  eventPageTodos,
  type PageTodo,
  type PageTodoContext,
  type PageTodoEvent,
  type PageTodoTranslation,
} from "@/modules/content/events/domain/page-todos";

/**
 * §749 — what an event's page still lacks, computed from the event (BR-REQ-050-01). One test per
 * rule, over a race that has everything and then loses one thing at a time, so a rule that fires
 * when it should not — or stays silent when it should speak — is named by its own test.
 */
const NOW = new Date("2026-10-13T09:00:00.000Z");
const DECLARATION = "00000000-0000-4000-8000-0000000000d1";

const body = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Un text." }] }] };

function translation(locale: string, overrides: Partial<PageTodoTranslation> = {}): PageTodoTranslation {
  return {
    locale,
    title: `Titlu ${locale}`,
    excerpt: `Rezumat ${locale}`,
    slug: `slug-${locale}`,
    locationName: `Locul ${locale}`,
    bodyJson: body,
    scheduleJson: null,
    ...overrides,
  };
}

/** A race that is complete: nothing to do. */
function complete(overrides: Partial<PageTodoEvent> = {}): PageTodoEvent {
  return {
    type: "RACE",
    eventStatus: "SCHEDULED",
    editorialStatus: "PUBLISHED",
    startsAt: new Date("2026-11-21T08:00:00.000Z"),
    endsAt: null,
    dateToBeAnnounced: false,
    timeToBeAnnounced: false,
    locationName: "Parcul",
    locationToBeAnnounced: false,
    scheduleItems: [
      { startsAt: "2026-11-21T07:00:00.000Z", endsAt: null, label: { ro: "Ridicare pachete", en: "Kit pickup" }, place: null },
    ],
    coverMediaAssetId: "00000000-0000-4000-8000-0000000000c1",
    routeUrl: null,
    routeMaps: [{ provider: "strava", id: "123456" }],
    routeGpx: null,
    links: null,
    difficultyLevel: 8,
    registrationMode: "INTERNAL",
    capacity: 200,
    bibDesign: { showName: true },
    declarationDocumentId: DECLARATION,
    ...overrides,
  };
}

const texts = [translation("ro"), translation("en")];
const context: PageTodoContext = {
  now: NOW,
  locales: ["ro", "en"],
  storageConfigured: true,
  approvedDeclarationIds: new Set([DECLARATION]),
};

const rules = (todos: PageTodo[]) => todos.map((todo) => todo.id);
const only = (todos: PageTodo[], id: string) => todos.find((todo) => todo.id === id);

describe("§749 eventPageTodos", () => {
  it("lists nothing for an event whose page has everything", () => {
    expect(eventPageTodos(complete(), texts, context)).toEqual([]);
  });

  it("asks for the title, the summary and the page address in each language that lacks them, as high", () => {
    const todos = eventPageTodos(complete(), [translation("ro"), translation("en", { title: "", excerpt: null, slug: "" })], context);
    expect(rules(todos)).toEqual(expect.arrayContaining(["title:en", "summary:en", "address:en"]));
    expect(rules(todos)).not.toContain("title:ro");
    expect(only(todos, "title:en")).toMatchObject({ priority: "HIGH", anchor: "box-title", locale: "en" });
    expect(only(todos, "address:en")).toMatchObject({ priority: "HIGH", anchor: "box-address" });
  });

  it("counts a language with no row at all as lacking its title, summary, description and address", () => {
    const todos = eventPageTodos(complete(), [translation("ro")], context);
    expect(rules(todos)).toEqual(expect.arrayContaining(["title:en", "summary:en", "description:en", "address:en"]));
    // The page names the place by the event's own name when a language has none, so the meeting point is not missing.
    expect(rules(todos)).not.toContain("meetingPoint:en");
  });

  it("asks for the long description per language, as normal — the page shows the summary in its place", () => {
    const todos = eventPageTodos(complete(), [translation("ro"), translation("en", { bodyJson: { type: "doc", content: [{ type: "paragraph" }] } })], context);
    expect(only(todos, "description:en")).toMatchObject({ priority: "NORMAL", anchor: "box-description" });
    expect(rules(todos)).not.toContain("description:ro");
  });

  it("asks for the meeting point per language, but not while the place is announced — that is its own row", () => {
    const missing = eventPageTodos(complete({ locationName: null }), [translation("ro", { locationName: null }), translation("en")], context);
    expect(only(missing, "meetingPoint:ro")).toMatchObject({ priority: "HIGH", anchor: "box-place" });
    expect(rules(missing)).not.toContain("meetingPoint:en");

    const announced = eventPageTodos(complete({ locationToBeAnnounced: true, locationName: null }), [translation("ro", { locationName: null }), translation("en", { locationName: null })], context);
    expect(rules(announced)).toEqual(["placeAnnounced"]);
    expect(only(announced, "placeAnnounced")).toMatchObject({ priority: "HIGH", anchor: "box-place" });
  });

  it("asks for the start while the date or the time is still to be announced, as high", () => {
    expect(only(eventPageTodos(complete({ timeToBeAnnounced: true }), texts, context), "startTime")).toMatchObject({ priority: "HIGH", anchor: "box-when" });
    expect(rules(eventPageTodos(complete({ dateToBeAnnounced: true }), texts, context))).toEqual(["startTime"]);
  });

  it("asks a race for a programme when it has no timed rows and no programme text, and only a race", () => {
    const noRows = eventPageTodos(complete({ scheduleItems: null }), texts, context);
    expect(only(noRows, "programme")).toMatchObject({ priority: "NORMAL", anchor: "box-programme" });
    // A programme text in one language is a programme.
    expect(rules(eventPageTodos(complete({ scheduleItems: [] }), [translation("ro", { scheduleJson: body }), translation("en")], context))).not.toContain("programme");
    // A hike or a meetup is not expected to have timed rows.
    expect(rules(eventPageTodos(complete({ type: "HIKE", scheduleItems: null, registrationMode: "NONE", declarationDocumentId: null }), texts, context))).not.toContain("programme");
  });

  it("asks for a cover where storage is configured (§709), and not where there is nowhere to upload one", () => {
    expect(only(eventPageTodos(complete({ coverMediaAssetId: null }), texts, context), "cover")).toMatchObject({ priority: "NORMAL", anchor: "box-cover" });
    expect(rules(eventPageTodos(complete({ coverMediaAssetId: null }), texts, { ...context, storageConfigured: false }))).not.toContain("cover");
  });

  it("asks a run or a race for a route when it has no map, no GPX, no route link and no GPX or map link (§718)", () => {
    const bare = { routeMaps: null, routeGpx: null };
    expect(only(eventPageTodos(complete(bare), texts, context), "route")).toMatchObject({ priority: "NORMAL", anchor: "box-course" });
    expect(only(eventPageTodos(complete({ ...bare, type: "GROUP_RUN", registrationMode: "NONE", declarationDocumentId: null, capacity: null }), texts, context), "route")).toBeDefined();
    // A GPX file, a route link or a GPX link each answer the runner's question.
    const gpx = { key: "production/route-gpx/0d6f3c1e-5b1a-4c3e-8f21-9a7b2c4d5e6f/a.gpx", name: "a.gpx", size: 10, uploadedAt: "2026-10-01T00:00:00.000Z" };
    expect(rules(eventPageTodos(complete({ ...bare, routeGpx: gpx }), texts, context))).not.toContain("route");
    expect(rules(eventPageTodos(complete({ ...bare, routeUrl: "https://example.test/route" }), texts, context))).not.toContain("route");
    expect(rules(eventPageTodos(complete({ ...bare, links: [{ kind: "GPX", url: "https://example.test/a.gpx", labelRo: "", labelEn: "" }] }), texts, context))).not.toContain("route");
    // Not asked of a coffee.
    expect(rules(eventPageTodos(complete({ ...bare, type: "COFFEE", registrationMode: "NONE", declarationDocumentId: null, capacity: null }), texts, context))).not.toContain("route");
  });

  it("asks for the difficulty only when it was never chosen — a migrated default cannot be told from a choice (§526)", () => {
    expect(only(eventPageTodos(complete({ difficultyLevel: null }), texts, context), "difficulty")).toMatchObject({ priority: "LOW", anchor: "box-kind" });
    // The middle steps migration 0104 wrote are indistinguishable from a deliberate choice: no row.
    for (const level of [1, 2, 5, 11, 14]) {
      expect(rules(eventPageTodos(complete({ difficultyLevel: level }), texts, context))).not.toContain("difficulty");
    }
  });

  it("asks a race registered on the site for its places and its bibs' look, and nothing of the kind otherwise (§735)", () => {
    const todos = eventPageTodos(complete({ capacity: null, bibDesign: null }), texts, context);
    expect(only(todos, "capacity")).toMatchObject({ priority: "NORMAL", anchor: "box-registration" });
    expect(only(todos, "bibDesign")).toMatchObject({ priority: "LOW", anchor: "box-bibs" });
    const elsewhere = eventPageTodos(complete({ registrationMode: "EXTERNAL", declarationDocumentId: null, capacity: null, bibDesign: null }), texts, context);
    expect(rules(elsewhere)).toEqual([]);
  });

  it("is urgent when registration needs a declaration that is missing or no longer approved", () => {
    const none = eventPageTodos(complete({ declarationDocumentId: null }), texts, context);
    expect(only(none, "declaration")).toMatchObject({ priority: "URGENT", anchor: "box-declaration" });
    const withdrawn = eventPageTodos(complete(), texts, { ...context, approvedDeclarationIds: new Set() });
    expect(rules(withdrawn)).toEqual(["declaration"]);
    // A group run takes no registration here (§111): nothing to approve.
    expect(rules(eventPageTodos(complete({ type: "GROUP_RUN", registrationMode: "NONE", declarationDocumentId: null, capacity: null }), texts, context))).toEqual([]);
  });

  it("has no computed rows for an event that is over, cancelled or archived", () => {
    const lacking = { coverMediaAssetId: null, declarationDocumentId: null };
    expect(eventPageTodos(complete({ ...lacking, startsAt: new Date("2026-10-01T08:00:00.000Z") }), texts, context)).toEqual([]);
    expect(eventPageTodos(complete({ ...lacking, eventStatus: "CANCELLED" }), texts, context)).toEqual([]);
    expect(eventPageTodos(complete({ ...lacking, eventStatus: "COMPLETED" }), texts, context)).toEqual([]);
    expect(eventPageTodos(complete({ ...lacking, editorialStatus: "ARCHIVED" }), texts, context)).toEqual([]);
    // An event that has begun but not ended is not over.
    const running = eventPageTodos(complete({ ...lacking, startsAt: new Date("2026-10-13T07:00:00.000Z"), endsAt: new Date("2026-10-13T12:00:00.000Z") }), texts, context);
    expect(rules(running)).toContain("cover");
  });

  it("gives every row an id that is unique within the event", () => {
    const todos = eventPageTodos(complete({ coverMediaAssetId: null, capacity: null, bibDesign: null, difficultyLevel: null, routeMaps: null }), [translation("ro", { title: "" })], context);
    expect(new Set(rules(todos)).size).toBe(todos.length);
  });
});
