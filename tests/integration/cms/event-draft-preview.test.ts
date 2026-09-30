import { createFormatter, createTranslator } from "next-intl";
import { count, eq } from "drizzle-orm";
import { createElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventTranslations, events } from "@/db/schema/events";
import { platformSettings } from "@/db/schema/platform-settings";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { DomainError } from "@/shared/errors/domain-error";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { fakeNextCache } from "../../helpers/next-cache";

/**
 * §579 — «Previzualizare» before saving: the editor's unsaved values drawn as the listing card and
 * the event page, through the real action (`previewEventDraftAction`, the save's own readers) in
 * PGlite. The owner, 2026-09-30: «vreau să pot face preview la eveniment, înainte de salvare și
 * publicare, ca să știu cum arată, atât pe card cât și descrierea completă».
 *
 * What is proved: an unsaved title is on the card and the page; a draft whose English lacks its
 * summary and description is drawn in English all the same and marked incomplete by the boxes
 * publication and «both languages» would name; nothing is written — no row, no version, no audit,
 * no email — and the public cache is neither read, filled nor expired; the Tehnic, the volunteer and
 * a stranger are refused; a value the save refuses comes back with its box named, not a broken
 * page; the preview's card is the listing's card, markup for markup; and the preview of the form
 * draws exactly what a save of the same form stores.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, locale: "ro" as "ro" | "en" }));

vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: () => {
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));
vi.mock("@/auth", () => ({ signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => {
    if (!state.actor) throw new DomainError("UNAUTHENTICATED", "no staff session");
    return state.actor;
  },
  requireStaffCapability: async () => state.actor,
}));
vi.mock("next-intl/server", () => {
  const translator = (locale: "ro" | "en", namespace: string) =>
    createTranslator({ locale, messages: locale === "ro" ? ro : en, namespace: namespace as "Event" });
  return {
    // The page's components ask by namespace, in the request's language; the preview names its language.
    getTranslations: async (arg: string | { locale: "ro" | "en"; namespace: string }) =>
      typeof arg === "string" ? translator(state.locale, arg) : translator(arg.locale, arg.namespace),
    getFormatter: async () => createFormatter({ locale: state.locale, timeZone: "Europe/Bucharest" }),
    getLocale: async () => state.locale,
    setRequestLocale: () => {},
  };
});
/** The locale-aware link, as a plain anchor: the cards and the page hand it a pathname and params. */
vi.mock("@/i18n/navigation", () => {
  const path = (href: string | { pathname?: string; params?: Record<string, string> }) =>
    typeof href === "string" ? `/${state.locale}${href}` : `/${state.locale}${(href.pathname ?? "").replace(/\[(\w+)\]/g, (_, key: string) => href.params?.[key] ?? "")}`;
  return {
    getPathname: ({ href }: { href: string | { pathname?: string; params?: Record<string, string> } }) => path(href),
    Link: ({ href, children, style }: { href: string | { pathname?: string; params?: Record<string, string> }; children: ReactNode; style?: object }) =>
      createElement("a", { href: path(href), style }, children),
  };
});

const { previewEventDraftAction, saveEventAndTranslationsAction } = await import("@/app/[locale]/admin/actions");
const { createEvent, createEventAndPublish, draftEvent, saveEventAndTranslations } = await import("@/modules/content/events/service");
const { renderEventDraftPreview } = await import("@/modules/content/events/draft-preview");
const { previewPageOf } = await import("@/modules/content/events/preview-view");
const { findEventForEditing } = await import("@/modules/content/events/repository");
const { findPublishedEventBySlug } = await import("@/modules/events/repository");
const { default: EventCard } = await import("@/modules/events/ui/EventCard");
const { CARD_GRID_SX } = await import("@/modules/events/ui/card-layout");
const { default: Box } = await import("@mui/material/Box");

const NOW = new Date("2026-09-25T10:00:00.000Z");

const doc = (text: string) => JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

/** A group run's settings as the service reads them (`ask-health-note.test.ts`'s shape). */
const FIELDS = {
  type: "GROUP_RUN",
  eventStatus: "SCHEDULED",
  timezone: "Europe/Bucharest",
  startsAtWallTime: "2026-10-07T19:00",
  endsAtWallTime: "",
  raceStartsAtWallTime: "",
  locationName: "Piața Sfatului",
  locationNameEn: "Council Square",
  locationAddress: "",
  surface: "ASPHALT",
  difficulty: "MEDIUM",
  costType: "FREE",
  costAmount: "",
  mapUrl: "",
  routeUrl: "",
  distanceMeters: "8000",
  elevationGainMeters: "",
  featured: false,
  registrationMode: "NONE",
  externalProvider: "",
  externalRegistrationUrl: "",
  participantListVisibility: "HIDDEN" as const,
  capacity: "",
  registrationOpensAtWallTime: "",
  registrationClosesAtWallTime: "",
  declarationDocumentId: "",
};

/** Română complete; English with its title and address only — a draft may be saved so (§28). */
const WORDS = {
  ro: { slug: "alergarea-de-joi", title: "Alergarea de joi", excerpt: "O oră ușoară prin centru." },
  en: { slug: "thursday-run", title: "The Thursday run", excerpt: "" },
};

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let eventId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

beforeEach(async () => {
  await resetTables(db);
  fakeNextCache.reset();
  state.locale = "ro";
  [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
  state.actor = admin;
  const created = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: WORDS }, now: NOW });
  eventId = created.id;
  fakeNextCache.reset();
});

/** The editor's save form as it posts, from the stored rows, with `change` applied to its boxes. */
async function editorForm(change: (form: FormData) => void = () => {}): Promise<FormData> {
  const stored = await findEventForEditing(db, eventId);
  if (!stored) throw new Error("no event");
  const form = new FormData();
  form.set("uiLocale", "ro");
  form.set("eventId", eventId);
  form.set("event.expectedVersion", String(stored.event.version));
  for (const [name, value] of Object.entries(FIELDS)) {
    if (typeof value === "string") form.set(`event.${name}`, value);
    else if (value) form.set(`event.${name}`, "on");
  }
  for (const row of stored.translations) {
    const at = (box: string) => `translations.${row.locale}.${box}`;
    form.set(at("translationId"), row.id);
    form.set(at("expectedVersion"), String(row.version));
    form.set(at("slug"), row.slug);
    form.set(at("title"), row.title);
    form.set(at("excerpt"), row.excerpt ?? "");
    form.set(at("excerptBody"), row.excerpt ? doc(row.excerpt) : "");
    form.set(at("body"), "");
    form.set(at("seoTitle"), "");
    form.set(at("seoDescription"), "");
  }
  change(form);
  return form;
}

async function preview(form: FormData, locale: "ro" | "en") {
  form.set("previewLocale", locale);
  state.locale = locale;
  return previewEventDraftAction(form);
}

async function markup(node: ReactNode): Promise<string> {
  const stream = await renderToReadableStream(node);
  await stream.allReady;
  return new Response(stream).text();
}

async function rowCounts() {
  const [[eventRows], [translationRows], [auditRows], [outboxRows], [settingRows]] = await Promise.all([
    db.select({ n: count() }).from(events),
    db.select({ n: count() }).from(eventTranslations),
    db.select({ n: count() }).from(auditLogs),
    db.select({ n: count() }).from(emailOutbox),
    db.select({ n: count() }).from(platformSettings),
  ]);
  return { events: eventRows.n, translations: translationRows.n, audit: auditRows.n, outbox: outboxRows.n, settings: settingRows.n };
}

describe("§579 «Previzualizare» before saving: the unsaved event, drawn by the site's own components", () => {
  it("draws the unsaved title on the card and the page, in Română", async () => {
    const answer = await preview(await editorForm((form) => form.set("translations.ro.title", "Alergarea de joi (nesalvată)")), "ro");
    expect(answer.outcome).toBe("ready");
    if (answer.outcome !== "ready") return;
    const card = await markup(answer.card);
    const page = await markup(answer.page);
    expect(card).toContain("Alergarea de joi (nesalvată)");
    expect(card).toContain('data-testid="draft-preview-card"');
    expect(page).toContain("Alergarea de joi (nesalvată)");
    expect(page).toContain("O oră ușoară prin centru.");
    // The stored title is untouched: nothing was saved.
    const [stored] = await db.select().from(eventTranslations).where(eq(eventTranslations.slug, "alergarea-de-joi"));
    expect(stored.title).toBe("Alergarea de joi");
  });

  it("draws the English page of a draft whose English is incomplete, and marks what it lacks", async () => {
    // A Romanian description with no English one: the save would refuse it (§352); the preview marks it.
    const answer = await preview(await editorForm((form) => form.set("translations.ro.body", doc("Traseul trece prin Piața Sfatului."))), "en");
    expect(answer.outcome).toBe("ready");
    if (answer.outcome !== "ready") return;
    expect(answer.locale).toBe("en");
    expect(await markup(answer.page)).toContain("The Thursday run");
    expect(answer.missing.en).toEqual(expect.arrayContaining(["translations.en.excerptBody", "translations.en.body"]));
    expect(answer.missing.ro).toEqual([]);
    // In the page's language: the English words of the public page.
    expect(await markup(answer.page)).toContain(en.Event.backToEvents);
  });

  it("writes nothing: no row, no version, no audit, no email, and no cache read, filled or expired", async () => {
    const before = await rowCounts();
    const [event] = await db.select().from(events).where(eq(events.id, eventId));
    const form = await editorForm((form) => {
      form.set("translations.ro.title", "Alt titlu");
      form.set("event.distanceMeters", "12000");
      form.set("event.featured", "on");
    });
    for (const locale of ["ro", "en"] as const) {
      const answer = await preview(form, locale);
      expect(answer.outcome).toBe("ready");
      if (answer.outcome === "ready") {
        await markup(answer.card);
        await markup(answer.page);
      }
    }
    expect(await rowCounts()).toEqual(before);
    const [after] = await db.select().from(events).where(eq(events.id, eventId));
    expect(after.version).toBe(event.version);
    expect(after.distanceMeters).toBe(event.distanceMeters);
    expect(after.featured).toBe(false);
    expect(fakeNextCache.counts).toEqual({ reads: 0, writes: 0 });
    expect(fakeNextCache.invalidated).toEqual([]);
  });

  it("refuses the Tehnic, the volunteer and a stranger before reading anything", async () => {
    for (const role of ["DEV", "CONTRIBUTOR"] as const) {
      [state.actor] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@dev.test`, displayName: role, role }).returning();
      expect((await preview(await editorForm(), "ro")).outcome).toBe("forbidden");
    }
    state.actor = undefined;
    expect((await preview(await editorForm(), "ro")).outcome).toBe("forbidden");
  });

  it("previews for the Redactor and the Organizer", async () => {
    for (const role of ["COPYWRITER", "MODERATOR"] as const) {
      [state.actor] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@dev.test`, displayName: role, role }).returning();
      // Neither posts the settings (only an Administrator may change them): the stored row stands.
      const answer = await preview(await editorForm((form) => form.delete("event.expectedVersion")), "ro");
      expect(answer.outcome).toBe("ready");
    }
  });

  it("names the box the save would refuse instead of drawing a broken page (§47)", async () => {
    const answer = await preview(await editorForm((form) => form.set("event.mapUrl", "nu este un link")), "ro");
    expect(answer).toMatchObject({ outcome: "refused", error: "VALIDATION_ERROR" });
    if (answer.outcome === "refused") expect(answer.fields).toContain("event.mapUrl");
    // A language's own refusal names that language's box.
    const words = await preview(await editorForm((form) => form.set("translations.en.slug", "Nu E Adresă")), "en");
    expect(words).toMatchObject({ outcome: "refused" });
    if (words.outcome === "refused") expect(words.fields).toContain("translations.en.slug");
  });

  it("draws a race's open door with the unsaved places, disabled and marked «previzualizare» — the public cache untouched", async () => {
    const declaration: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Declarație", body: { sections: [{ paragraphs: ["Declar."] }] } },
      { locale: "en", title: "Declaration", body: { sections: [{ paragraphs: ["I declare."] }] } },
    ];
    const declarationId = await insertLegalDocumentVersion(db, {
      key: "EVENT_DECLARATION",
      version: 1,
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(declaration),
      translations: declaration,
      now: NOW,
    });
    fakeNextCache.reset();
    const race = (form: FormData) => {
      form.set("event.type", "RACE");
      form.set("event.registrationMode", "INTERNAL");
      form.set("event.capacity", "40");
      form.set("event.declarationDocumentId", declarationId);
      // Opened in the past, so the door is open whatever day the suite runs on.
      form.set("event.registrationOpensAtWallTime", "2026-01-01T10:00");
      form.set("event.startsAtWallTime", "2030-10-07T19:00");
    };
    for (const locale of ["ro", "en"] as const) {
      const answer = await preview(await editorForm(race), locale);
      expect(answer.outcome).toBe("ready");
      if (answer.outcome !== "ready") return;
      const word = (locale === "ro" ? ro : en).Event.previewDoor;
      const card = await markup(answer.card);
      const page = await markup(answer.page);
      for (const html of [card, page]) {
        expect(html).toContain('data-testid="preview-door"');
        expect(html).toContain(word);
        // No working door: nothing links to the registration form.
        expect(html).not.toMatch(/href="[^"]*\/register"/);
      }
      // The unsaved forty places, counted by the allocator's formula: nobody has one yet.
      expect(page).toContain("40");
    }
    expect(fakeNextCache.counts).toEqual({ reads: 0, writes: 0 });
    expect(fakeNextCache.invalidated).toEqual([]);
  });

  it("previews the create page's form, which has no event yet", async () => {
    const form = await editorForm();
    form.delete("eventId");
    form.delete("event.expectedVersion");
    for (const locale of ["ro", "en"]) {
      form.delete(`translations.${locale}.translationId`);
      form.delete(`translations.${locale}.expectedVersion`);
    }
    form.set("translations.ro.slug", "alergare-noua");
    form.set("translations.ro.title", "O alergare nouă");
    const answer = await preview(form, "ro");
    expect(answer.outcome).toBe("ready");
    if (answer.outcome === "ready") expect(await markup(answer.card)).toContain("O alergare nouă");
  });
});

describe("§579 the preview draws what the save stores", () => {
  it("the preview's card is the listing's card, markup for markup (§366: one source draws the card)", async () => {
    const published = await createEventAndPublish(db, {
      actor: admin,
      fields: { ...FIELDS, translations: { ro: { ...WORDS.ro, slug: "alergarea-publica" }, en: { slug: "public-run", title: "The public run", excerpt: "An easy hour." } } },
      publish: true,
      now: NOW,
    });
    const listed = await findPublishedEventBySlug(db, "ro", "alergarea-publica");
    if (!listed) throw new Error("not published");
    // The listing's own grid around its own card (`events/page.tsx`), as the preview draws it.
    const grid = createElement(Box as unknown as (props: Record<string, unknown>) => ReactNode, { component: "ul", sx: CARD_GRID_SX }, createElement(EventCard, { event: listed, index: 0, now: NOW }));
    const listing = await markup(grid);
    const drawn = await renderEventDraftPreview(db, { actor: admin, eventId: published.event.id, translations: {}, locale: "ro", now: NOW });
    expect(drawn.outcome).toBe("ready");
    if (drawn.outcome !== "ready") return;
    const card = (html: string) => html.slice(html.indexOf("<li"), html.lastIndexOf("</li>") + 5);
    expect(card(await markup(drawn.card))).toBe(card(listing));
  });

  it("the form's values give the view a save of the same values stores", async () => {
    const posted = {
      fields: { ...FIELDS, distanceMeters: "12500", locationName: "Parcul Tractorul", locationNameEn: "Tractorul Park", isSpecial: true },
      ro: { ...WORDS.ro, title: "Alergarea de joi, ediția a doua", excerptBody: doc("Mai lungă."), body: doc("Descrierea.") },
      en: { ...WORDS.en, excerptBody: doc("Longer."), body: doc("The description.") },
    };
    const stored = await findEventForEditing(db, eventId);
    if (!stored) throw new Error("no event");
    const draft = await draftEvent(db, {
      current: stored.event,
      storedTranslations: stored.translations,
      fields: posted.fields,
      translations: { ro: posted.ro, en: posted.en },
      now: NOW,
    });
    const byLocale = (locale: "ro" | "en") => stored.translations.find((row) => row.locale === locale);
    await saveEventAndTranslations(db, {
      actor: admin,
      eventId,
      fields: posted.fields,
      expectedVersion: stored.event.version,
      translations: (["ro", "en"] as const).map((locale) => ({ translationId: byLocale(locale)!.id, expectedVersion: byLocale(locale)!.version, fields: posted[locale] })),
      now: NOW,
    });
    const saved = await findEventForEditing(db, eventId);
    if (!saved) throw new Error("no event");
    for (const locale of ["ro", "en"] as const) {
      const fromSave = previewPageOf(saved.event, saved.translations.find((row) => row.locale === locale)!);
      // The row's clock is the save's own (`updated_at`): everything the page draws is the same.
      expect({ ...previewPageOf(draft.event, draft.translations[locale]), updatedAt: null }).toEqual({ ...fromSave, updatedAt: null });
    }
  });

  it("the preview of the form draws the page a save of the form then shows", async () => {
    const change = (form: FormData) => {
      form.set("translations.ro.title", "Alergarea de joi, ediția a doua");
      form.set("event.distanceMeters", "12500");
      form.set("translations.en.excerptBody", doc("An easy hour through the centre."));
      form.set("translations.en.excerpt", "An easy hour through the centre.");
    };
    const before = await preview(await editorForm(change), "ro");
    const saved = await saveEventAndTranslationsAction(null, await editorForm(change)).catch((error: unknown) => {
      if (error instanceof Error && error.message === "NEXT_REDIRECT") return "redirected";
      throw error;
    });
    expect(saved).toBe("redirected");
    // What is stored now: a form posting no settings version and no language row draws the rows as saved.
    const after = await preview(
      await editorForm((form) => {
        form.delete("event.expectedVersion");
        form.delete("translations.ro.translationId");
        form.delete("translations.en.translationId");
      }),
      "ro",
    );
    expect(before.outcome).toBe("ready");
    expect(after.outcome).toBe("ready");
    if (before.outcome !== "ready" || after.outcome !== "ready") return;
    expect(await markup(before.page)).toBe(await markup(after.page));
    expect(await markup(before.card)).toBe(await markup(after.card));
  });
});
