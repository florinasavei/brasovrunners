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
      .values({ email: "moderator@dev.test", displayName: "Editor", role: "ADMIN" })
      .returning();
  });

  const FIELDS = {
    slug: "crosul-aniversar",
    title: "Crosul aniversar",
    excerpt: "",
    checklist: "",
    seoTitle: "",
    seoDescription: "",
  };

  /** The meeting point is the event's now, not each language's (`DECISIONS.md` §36). */
  const MEETING_POINT = "Parcul Tractorul";

  async function seedDraft() {
    const [event] = await db
      .insert(events)
      .values({
        type: "RACE",
        startsAt: new Date("2026-10-11T06:00:00Z"),
        locationName: MEETING_POINT,
      })
      .returning();
    const [translation] = await db
      .insert(eventTranslations)
      .values({
        eventId: event.id,
        locale: "ro",
        slug: FIELDS.slug,
        title: FIELDS.title,
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
      // The description proper, validated Tiptap JSON since 2026-09-18 (`DECISIONS.md` §71).
      "body",
      // "What to bring", one line per language (`DECISIONS.md` §81).
      "checklist",
      "excerpt",
      // The short description as the editor posts it (`DECISIONS.md` §73); `excerpt` is derived.
      "excerptBody",
      // Not the place's name: it is stored on this row (migration `0059`) but asked once per
      // language in the Locul box and written by the event's own save, the Organizer's (§362).
      // The route / training description, per language, in the "Traseul" card (§387).
      "routeDescription",
      // The rules, per language (`DECISIONS.md` §96).
      "rules",
      // The programme, per language (`DECISIONS.md` §96).
      "schedule",
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
    ["the stored body column itself — the form posts `body`, validated, never the column", "bodyJson"],
    // A text save never moves the meeting point (§362): the place's name in each language is the
    // event's, asked in the Locul box and saved with the event's fields.
    ["the place's name, which is the event's in both languages and saved with its fields", "locationName"],
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
    //
    // `/pages/[slug]` does not weaken that and is worth saying why: an organizer creating an
    // "About" page writes a content row that an existing parameterised route reads, exactly as
    // creating an event does for `/events/[slug]`. No route, layout or file is produced, and
    // this list still has to be edited by a person for a new one to exist.
    expect(Object.keys(routing.pathnames).sort()).toEqual([
      "/",
      "/admin",
      "/admin/checkin",
      "/admin/checkin/[code]",
      "/admin/emails",
      "/admin/events/[id]",
      "/admin/events/[id]/bibs",
      // The hard delete's confirmation screen (BR-REQ-037-06): written here by hand, like
      // every other one, which is the property this test exists to keep.
      "/admin/events/[id]/erase",
      // The organizer's own message to the event's participants (§364): written by hand, per send.
      "/admin/events/[id]/mesaje",
      // The emergency sheet (§322), printed and carried on race day: by hand, like the rest.
      "/admin/events/[id]/urgente",
      "/admin/events/new",
      "/admin/gallery",
      "/admin/gallery/[id]",
      "/admin/gallery/new",
      "/admin/gallery/pictures",
      "/admin/guide",
      "/admin/legal",
      "/admin/legal/[id]",
      // Deleting an approved version outright (`DECISIONS.md` §151): what goes, that the
      // number goes with it, and the phrase to type — a screen, like the event erase one,
      // written here by hand.
      "/admin/legal/[id]/delete",
      "/admin/legal/new",
      "/admin/pages",
      "/admin/pages/[id]",
      "/admin/pages/new",
      "/admin/registrations",
      "/admin/registrations/[id]",
      "/admin/registrations/new",
      // Everything held about one person (§322), for an access request: by hand, like the rest.
      "/admin/registrations/person",
      "/admin/staff",
      "/admin/tasks",
      // The club's month, its own page since §251.
      "/calendar",
      "/contact",
      "/devs",
      "/devs/docs/[name]",
      "/devs/theme",
      "/events",
      "/events/[slug]",
      // A group run's optional self-declaration (§393): signed, never edited here.
      "/events/[slug]/declaration",
      "/events/[slug]/register",
      "/gallery",
      "/gallery/[slug]",
      "/legal/privacy",
      "/legal/terms",
      // The newsletter's two link pages (§NNN): the confirmation and the subscriber's own page.
      "/newsletter/confirm/[token]",
      "/newsletter/manage/[token]",
      "/pages/[slug]",
      "/preview/events/[id]",
      "/registrations/confirm/[token]",
      "/registrations/declare/[token]",
      // The public list's own switch (BR-REQ-039-01, §143): written here by hand like the rest.
      "/registrations/list/[token]",
      "/registrations/manage/[token]",
      "/registrations/mine",
      "/registrations/mine/[token]",
      "/registrations/resend",
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
     * This assertion has been narrowed twice, and each time for the same reason: it kept
     * standing for something broader than the rule underneath it.
     *
     * First it asserted no route was called `/admin/legal` at all — but a name is not a
     * capability, and reading a legal document in the backoffice breaks nothing.
     *
     * Then it asserted no route ending `/new`, which `DECISIONS.md` §46 showed was also too
     * broad: writing a *new version* is how legal text has always changed, and requiring a
     * developer and a migration to do it put a developer on the critical path of a decision
     * that is entirely the club's. What must stay impossible is narrower and sharper —
     * **changing the words of a version somebody has accepted**, because their signature
     * points at those words.
     *
     * And now a third time, for `DECISIONS.md` §151. It asserted that no route may *delete*
     * either, and that stood for the old refusal to remove an approved version — a refusal
     * whose real content was arithmetic: version numbers are recorded in `registrations` as
     * plain integers with no foreign key, and a freed number would come back attached to
     * different words. §151 removes that hazard at the root (the number is retired in
     * `legal_document_numbering` and never reissued), which leaves "no delete route" standing
     * for nothing but itself, while the club is left unable to tidy its own documents.
     *
     * What must stay impossible has not moved an inch: **changing, or removing, the words of a
     * version somebody has accepted**. Deletion refuses every version with a signature, an
     * event or a registration against it, and the one in force — the same guard withdrawal
     * uses — so no route can reach text anybody relied on.
     *
     * So: no route edits in place; exactly one route deletes, and it is the confirmation
     * screen, whose service refuses anything relied upon (`legal/hard-deletion.test.ts` proves
     * that half, as `legal/editor.test.ts` proves the editing half).
     */
    const legalRoutes = Object.keys(routing.pathnames).filter((route) => route.startsWith("/admin/legal"));
    for (const route of legalRoutes) {
      expect(route, `${route} must not edit a version in place`).not.toMatch(/\/edit$/);
    }
    expect(
      legalRoutes.filter((route) => /\/delete$/.test(route)),
      "one deletion screen, and it is the guarded one",
    ).toEqual(["/admin/legal/[id]/delete"]);

    /**
     * The repository stays read-and-insert only. Every write that can change an existing row
     * lives in `service.ts`, behind `assertStillADraft` — so there is exactly one place that
     * decides whether a version may be touched, and no way to reach a bare UPDATE without
     * passing it.
     */
    const repository = await import("@/modules/legal-documents/repository");
    const writers = Object.keys(repository).filter((name) => /^(update|delete|approve|edit)/.test(name));
    expect(writers, "the legal-documents repository must export no way to change a version").toEqual([]);

    /*
      `retireVersionNumber` is a write, and it is deliberately not one of those. It touches
      `legal_document_numbering` — one integer per key saying which numbers are spent — and
      never `legal_documents` or a word of anybody's text. It is what makes deletion safe
      rather than a way around this rule (§151).
    */
    expect(Object.keys(repository)).toContain("retireVersionNumber");

    expect(Object.keys(repository)).toContain("insertLegalDocumentVersion");

    /*
      And the guarded writes are all in the service, none of them reachable another way.

      The list is exhaustive on purpose: it is what catches a fifth writer being added to the
      club's legal text without anybody arguing for it. `deleteDraftVersion` joined it under
      `DECISIONS.md` §53 and is guarded the same way as the rest — it refuses an approved
      version outright, and refuses a draft anything references. `readDeletionFacts` writes
      nothing: it reads what `deletionObstacle` (a pure function in `domain/deletability.ts`,
      beside `isReliedOn`, which moved there with it) decides on, and it is exported so the
      service, the delete screen and the backoffice list ask one question and cannot disagree
      about whether a version may go (§290, §316). `approvePlatformTemplates`
      (`DECISIONS.md` §132) is not a sixth writer but the first two in one act — it calls
      `createDraftVersion` and `approveVersion` for each document that has no approved
      version and touches nothing that has one.

      There is still deliberately no `withdrawApproval`, and `withdrawApprovedVersion` is not
      it. §53 refused *un-approving*: a declaration is bound to the participant when the form is
      posted rather than when it is read, so changing which version is current would let
      somebody sign text they never saw. That reasoning is untouched, because withdrawal cannot
      change which version is current — the version in force is refused outright, and every
      other approved version is either already superseded or not yet effective, so removing it
      leaves `findCurrentApprovedDocument`'s answer exactly where it was. What it changes is the
      *future*: a version approved ahead of its date never takes effect. It also refuses
      anything with a signature, an event or a registration against it, which is what keeps an
      acceptance pointing at text that is still there to read.

      `deleteApprovedVersion` (§151) is the sixth, and the same reasoning covers it: it asks
      exactly the questions withdrawal asks — no signature, no event, no registration that
      recorded the number, and not the version in force — and then destroys the row, retires
      its number so it can never be reissued, and leaves the audit entry that is from then on
      the only record the club published those words. It cannot move which version is current
      for the same reason withdrawal cannot, and it cannot reach anything anybody accepted.
    */
    const service = await import("@/modules/legal-documents/service");
    expect(Object.keys(service).sort()).toEqual([
      "approvePlatformTemplates",
      "approveVersion",
      "createDraftVersion",
      "deleteApprovedVersion",
      "deleteDraftVersion",
      "readDeletionFacts",
      "updateDraftVersion",
      "withdrawApprovedVersion",
    ]);
  });
});
