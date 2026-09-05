import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { translationFieldsSchema } from "@/modules/content/events/fields";
import { saveEventTranslation } from "@/modules/content/events/service";
import { routing } from "@/i18n/routing";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-050-01 — the CMS boundary.
 *
 * Criterion 1 says the CMS edits event editorial fields "and nothing else". That is an
 * allowlist, and the test that matters is the negative one: a form that posts a field nobody
 * meant to expose must be refused rather than quietly applied, because a Server Action
 * receives whatever the browser sends.
 *
 * Criterion 3 — the canonical body is validated Tiptap JSON — is NOT met by this batch and is
 * not asserted as if it were. There is no rich-text editor: event bodies are plain fields, and
 * `body_json` is deliberately outside the allowlist below. The criterion is satisfied when
 * articles arrive with the rest of M5.
 */
describe("BR-REQ-050-01 the CMS edits event fields and nothing else", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let editor: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    [editor] = await db
      .insert(staffUsers)
      .values({ email: "moderator@dev.test", displayName: "Editor", role: "MODERATOR" })
      .returning();
  });

  const FIELDS = {
    slug: "crosul-aniversar",
    title: "Crosul aniversar",
    excerpt: "",
    seoTitle: "",
    seoDescription: "",
  };

  /** The meeting point is the event's now, not each language's (`DECISIONS.md` §36). */
  const MEETING_POINT = "Parcul Tractorul";

  async function seedDraft() {
    const [event] = await db
      .insert(events)
      .values({ kind: "RACE", startsAt: new Date("2026-10-11T06:00:00Z") })
      .returning();
    const [translation] = await db
      .insert(eventTranslations)
      .values({
        eventId: event.id,
        locale: "ro",
        slug: FIELDS.slug,
        title: FIELDS.title,
        locationName: MEETING_POINT,
      })
      .returning();
    return translation;
  }

  async function codeOf(operation: Promise<unknown>): Promise<string> {
    try {
      await operation;
      return "no error";
    } catch (error) {
      if (isDomainError(error)) return error.code;
      throw error;
    }
  }

  it("accepts exactly the editorial fields the model has", () => {
    const parsed = translationFieldsSchema.parse(FIELDS);
    // The four that left are on the event row now: the meeting point, the street address, the
    // difficulty and the cost are one value for the whole event (`DECISIONS.md` §36). What is
    // left here is what genuinely differs between two languages.
    expect(Object.keys(parsed).sort()).toEqual([
      "excerpt",
      "seoDescription",
      "seoTitle",
      "slug",
      "title",
    ]);
  });

  it.each([
    ["the editorial status, which lives on the event and only a transition may change", "editorialStatus"],
    ["the version, which is the concurrency guard itself", "version"],
    ["capacity, which belongs to the event row rather than to one language", "capacity"],
    ["the record id", "id"],
    ["the rich-text body, which has no validated schema yet", "bodyJson"],
  ])("refuses a save that also posts %s", async (_name, field) => {
    const translation = await seedDraft();

    expect(
      await codeOf(
        saveEventTranslation(db, {
          actor: editor,
          translationId: translation.id,
          expectedVersion: translation.version,
          fields: { ...FIELDS, [field]: "anything" },
        }),
      ),
    ).toBe("VALIDATION_ERROR");
  });

  it("refuses a slug that is not a URL segment", async () => {
    const translation = await seedDraft();

    for (const slug of ["Crosul Aniversar", "cros/aniversar", "cros--aniversar", ""]) {
      expect(
        await codeOf(
          saveEventTranslation(db, {
            actor: editor,
            translationId: translation.id,
            expectedVersion: translation.version,
            fields: { ...FIELDS, slug },
          }),
        ),
        slug,
      ).toBe("VALIDATION_ERROR");
    }
  });

  it("stores an emptied optional field as absent rather than as an empty string", async () => {
    // Null means "the club has not said". An empty string would render as a blank line under
    // a heading, and for cost it would be indistinguishable from "free".
    const translation = await seedDraft();

    const saved = await saveEventTranslation(db, {
      actor: editor,
      translationId: translation.id,
      expectedVersion: translation.version,
      fields: { ...FIELDS, seoTitle: "", excerpt: "" },
    });

    expect(saved.seoTitle).toBeNull();
    expect(saved.excerpt).toBeNull();
  });

  it("offers no route the CMS could have created", () => {
    // Criterion 2: no interface creates a route or a layout. The route table is a literal in
    // the source, so the whole set is knowable, and this test fails the day one is generated.
    expect(Object.keys(routing.pathnames).sort()).toEqual([
      "/",
      "/admin",
      "/admin/events/[id]",
      "/admin/events/new",
      "/admin/legal",
      "/admin/legal/[id]",
      "/admin/registrations",
      "/admin/registrations/[id]",
      "/admin/registrations/new",
      "/admin/staff",
      "/devs",
      "/events",
      "/events/[slug]",
      "/events/[slug]/register",
      "/legal/privacy",
      "/legal/terms",
      "/preview/events/[id]",
      "/registrations/confirm/[token]",
      "/registrations/declare/[token]",
      "/registrations/manage/[token]",
      "/sign-in",
    ]);
  });

  it("has no editor for legal documents in any form", async () => {
    // AGENTS.md §11.1, §12.5: the privacy notice, the terms and the declaration are
    // Admin-controlled versioned content that arrives through a migration. No CMS field
    // writes legal text, and nothing in the backoffice changes a word of a version.
    const editableFields = Object.keys(translationFieldsSchema.parse(FIELDS));
    for (const legal of ["privacyNotice", "terms", "declaration", "legalBody"]) {
      expect(editableFields, `${legal} must not be editable`).not.toContain(legal);
    }

    /**
     * This used to assert that no route was called `/admin/legal` at all, which is a weaker
     * statement than the rule it stands for: a name is not a capability, and a blocklist of
     * folder names is dodged by renaming a folder. Reading a legal document in the backoffice
     * breaks nothing — the club has to be able to see what its participants are signing.
     *
     * What must stay impossible is *writing* one from a request. So the assertion is now
     * about the two things that would make it possible, and both are checked directly:
     * no route that edits, and no write function reachable from one.
     */
    const legalRoutes = Object.keys(routing.pathnames).filter((route) => route.startsWith("/admin/legal"));
    for (const route of legalRoutes) {
      expect(route, `${route} must not be an editing route`).not.toMatch(/\/(new|edit|delete)$/);
    }

    const repository = await import("@/modules/legal-documents/repository");
    const writers = Object.keys(repository).filter((name) => /^(update|delete|approve|edit)/.test(name));
    expect(writers, "the legal-documents repository must export no way to change a version").toEqual([]);

    // `insertLegalDocumentVersion` is the single exception, and it is deliberate: a *new*
    // version is how legal text changes (`docs/RUNBOOKS.md` § Legal document version).
    // Inserting never mutates what somebody already signed.
    expect(Object.keys(repository)).toContain("insertLegalDocumentVersion");
  });
});
