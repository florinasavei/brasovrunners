import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { type EmailMessageType, emailMessageType, emailOutbox } from "@/db/schema/email-outbox";
import { eventTranslations, events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { type RegistrationStatus, registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { repeatEvent, saveEventAndTranslations, type SeriesEditScope } from "@/modules/content/events/service";
import { toWallTimeInput } from "@/modules/events/domain/zoned-time";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { queueEventUpdateNotices } from "@/modules/notifications/event-notices";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * `DECISIONS.md` §331 — the participants hear about an event change only when the organizer asks
 * ("Anunță participanții despre schimbare", unticked by default), and only about something they
 * plan by: the place, the start, the programme — or a note the organizer chose to write. A
 * cancellation says why, tells everyone active unless the organizer unticks it, leaves every
 * registration as it was, and is audited with the reason either way.
 *
 * Who is "active": holding a place or waiting for one — `PENDING_DECLARATION`,
 * `WAITLIST_OFFERED`, `CONFIRMED`, `WAITLISTED`. Not an unconfirmed address, not a cancelled or
 * lapsed registration. A test registration is written to like a real one (§12.6) and counted
 * nowhere.
 */
describe("§331 the participants hear about a change when the organizer asks", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let editor: StaffUser;
  let copywriter: StaffUser;
  let declarationId: string;

  /** The day of the save; the race is three weeks off. */
  const NOW = new Date("2026-09-19T10:00:00.000Z");
  const ZONE = "Europe/Bucharest";

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    [editor] = await db.insert(staffUsers).values({ email: "organizer@dev.test", displayName: "Organizator", role: "ADMIN" }).returning();
    [copywriter] = await db.insert(staffUsers).values({ email: "words@dev.test", displayName: "Redactor", role: "COPYWRITER" }).returning();
    const declaration: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Declarație", body: { sections: [{ paragraphs: ["Declar."] }] } },
      { locale: "en", title: "Declaration", body: { sections: [{ paragraphs: ["I declare."] }] } },
    ];
    declarationId = await insertLegalDocumentVersion(db, {
      key: "EVENT_DECLARATION",
      version: 1,
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(declaration),
      translations: declaration,
      now: NOW,
    });
  });

  /** A race on 11 Oct at 08:00 in Brașov, meeting at Parcul Tractorul, published. */
  async function seedEvent(overrides: Partial<typeof events.$inferInsert> = {}) {
    const [row] = await db
      .insert(events)
      .values({
        type: "RACE",
        surface: "ASPHALT",
        startsAt: new Date("2026-10-11T08:00:00+03:00"),
        endsAt: new Date("2026-10-11T09:30:00+03:00"),
        timezone: ZONE,
        locationName: "Parcul Tractorul",
        mapUrl: "https://maps.example.test/tractorul",
        registrationMode: "INTERNAL",
        capacity: 20,
        registrationOpensAt: new Date("2026-09-18T08:00:00+03:00"),
        registrationClosesAt: new Date("2026-10-11T07:00:00+03:00"),
        declarationDocumentId: declarationId,
        publishedAt: NOW,
        editorialStatus: "PUBLISHED",
        ...overrides,
      })
      .returning();
    await db.insert(eventTranslations).values([
      { eventId: row.id, locale: "ro", slug: `cursa-de-toamna-${row.id.slice(0, 8)}`, title: "Cursa de toamnă", excerpt: "Rapid." },
      { eventId: row.id, locale: "en", slug: `autumn-race-${row.id.slice(0, 8)}`, title: "Autumn race", excerpt: "Fast." },
    ]);
    return row;
  }

  type Seeded = { name: string; status: RegistrationStatus; locale?: "ro" | "en"; kind?: "REAL" | "TEST" };

  /** Registrations as the allocator would have left them, one participant each. */
  async function seedRegistrations(eventId: string, entries: readonly Seeded[]) {
    const people = await db
      .insert(participants)
      .values(
        entries.map(({ name }) => ({
          deliveryEmail: `${name}-${eventId.slice(0, 6)}@example.test`,
          normalizedEmail: `${name}-${eventId.slice(0, 6)}@example.test`,
          canonicalEmail: `${name}-${eventId.slice(0, 6)}@example.test`,
          canonicalizationVersion: 1,
          defaultName: name,
        })),
      )
      .returning();
    return db
      .insert(registrations)
      .values(
        entries.map(({ name, status, locale, kind }, index) => ({
          eventId,
          participantId: people[index].id,
          status,
          kind: kind ?? "REAL",
          locale: locale ?? "ro",
          registeredName: name,
          displayName: name,
          privacyNoticeVersion: 1,
          privacyAcknowledgedAt: NOW,
          raceId: null,
          resultsNameConsent: false,
          resultsConsentVersion: 1,
          waitlistedAt: status === "WAITLISTED" ? NOW : null,
          ...(status === "CANCELLED" ? { cancelledAt: NOW, cancellationSource: "PARTICIPANT" as const } : {}),
          ...(status === "EXPIRED" ? { expiredAt: NOW, expiryReason: "DECLARATION_HOLD_LAPSED" as const } : {}),
          ...(status === "PENDING_DECLARATION" || status === "WAITLIST_OFFERED" ? { holdExpiresAt: new Date(NOW.getTime() + 3_600_000) } : {}),
          ...(status === "WAITLIST_OFFERED" ? { offerCreatedAt: NOW } : {}),
          ...(status === "CONFIRMED" ? { confirmedAt: NOW } : {}),
        })),
      )
      .returning();
  }

  /** Every status there is, twice in English, and a test row: four real ones are "active". */
  const EVERYONE: readonly Seeded[] = [
    { name: "ana", status: "CONFIRMED" },
    { name: "bogdan", status: "PENDING_DECLARATION", locale: "en" },
    { name: "carmen", status: "WAITLISTED" },
    { name: "dan", status: "WAITLIST_OFFERED", locale: "en" },
    { name: "elena", status: "PENDING_EMAIL_CONFIRMATION" },
    { name: "florin", status: "CANCELLED" },
    { name: "gabi", status: "EXPIRED" },
    { name: "test", status: "CONFIRMED", kind: "TEST" },
  ];

  const reload = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0];
  const translationOf = async (eventId: string, locale: "ro" | "en") =>
    (await db.select().from(eventTranslations).where(eq(eventTranslations.eventId, eventId))).find((row) => row.locale === locale)!;

  /** The editor's form for the row, as posted, with the changes given. */
  const formFor = (row: typeof events.$inferSelect, changes: Record<string, unknown> = {}) => ({
    type: row.type,
    eventStatus: row.eventStatus,
    timezone: row.timezone,
    startsAtWallTime: toWallTimeInput(row.startsAt, row.timezone),
    endsAtWallTime: toWallTimeInput(row.endsAt, row.timezone),
    raceStartsAtWallTime: toWallTimeInput(row.raceStartsAt, row.timezone),
    locationName: row.locationName ?? "",
    locationAddress: "",
    surface: row.surface,
    difficulty: null,
    costType: null,
    mapUrl: row.mapUrl ?? "",
    routeUrl: "",
    distanceMeters: "",
    elevationGainMeters: "",
    featured: false,
    registrationMode: row.registrationMode,
    participantListVisibility: "HIDDEN" as const,
    capacity: row.capacity === null ? "" : String(row.capacity),
    registrationOpensAtWallTime: toWallTimeInput(row.registrationOpensAt, row.timezone),
    registrationClosesAtWallTime: toWallTimeInput(row.registrationClosesAt, row.timezone),
    declarationDocumentId: row.declarationDocumentId ?? "",
    externalProvider: "",
    externalRegistrationUrl: "",
    ...changes,
  });

  /** The editor's one save, as the action posts it. */
  async function save(
    id: string,
    input: {
      fields?: Record<string, unknown>;
      ro?: Record<string, unknown>;
      notice?: { notify: boolean; note?: string };
      cancellation?: { reason: string; notify: boolean };
      scope?: SeriesEditScope;
      actor?: StaffUser;
      at?: Date;
    } = {},
  ) {
    const row = await reload(id);
    const ro = await translationOf(id, "ro");
    return saveEventAndTranslations(db, {
      actor: input.actor ?? editor,
      eventId: id,
      fields: formFor(row, input.fields),
      expectedVersion: row.version,
      translations: [
        {
          translationId: ro.id,
          expectedVersion: ro.version,
          fields: { slug: ro.slug, title: ro.title, excerpt: ro.excerpt ?? "", seoTitle: "", seoDescription: "", ...input.ro },
        },
      ],
      acknowledgeLiveEdit: true,
      scope: input.scope ?? "this",
      notice: input.notice,
      cancellation: input.cancellation,
      now: input.at ?? NOW,
    });
  }

  /** The participants' own rows of one type — never the club's copies (§320), which have no participant. */
  const queued = (messageType: EmailMessageType) =>
    db
      .select()
      .from(emailOutbox)
      .where(and(eq(emailOutbox.messageType, messageType), isNotNull(emailOutbox.participantId)))
      .orderBy(asc(emailOutbox.createdAt), asc(emailOutbox.recipientEmail));

  async function refusalOf(attempt: Promise<unknown>) {
    try {
      await attempt;
      return undefined;
    } catch (caught) {
      if (isDomainError(caught)) return { code: caught.code, fields: caught.fields };
      throw caught;
    }
  }

  it("the migration adds the two message types, and the database's enum is the schema's (expand only)", async () => {
    const result = await db.execute(sql`SELECT unnest(enum_range(NULL::email_message_type))::text AS value`);
    const values = (result as unknown as { rows: { value: string }[] }).rows.map((row) => row.value);
    expect(values).toContain("EVENT_UPDATE_NOTICE");
    expect(values).toContain("EVENT_CANCELLED");
    expect(values).toEqual([...emailMessageType.enumValues]);
  });

  it("a ticked save that moves the place tells each active registration once, in its language, the new place and never the old", async () => {
    const event = await seedEvent();
    const rows = await seedRegistrations(event.id, EVERYONE);

    const result = await save(event.id, { fields: { locationName: "Poiana Brașov, la telecabină" }, notice: { notify: true } });
    // Four real registrations were told; the test row was written to and is counted nowhere.
    expect(result.notice).toEqual({ kind: "update", queued: 4, changes: ["place"] });

    const notices = await queued("EVENT_UPDATE_NOTICE");
    const told = new Map(notices.map((row) => [row.registrationId, row]));
    const byName = (name: string) => rows.find((row) => row.registeredName === name)!;
    for (const name of ["ana", "bogdan", "carmen", "dan", "test"]) {
      expect(told.get(byName(name).id)?.locale).toBe(byName(name).locale);
    }
    for (const name of ["elena", "florin", "gabi"]) expect(told.has(byName(name).id)).toBe(false);
    expect(notices).toHaveLength(5);
    // What travels is which facts changed, never their values: nothing old is in the row.
    expect(told.get(byName("ana").id)?.payloadJson).toEqual({ changes: ["place"] });

    const message = await renderOutboxMessage(told.get(byName("ana").id)!, db, NOW);
    expect(message.subject).toContain("Detalii actualizate pentru Cursa de toamnă");
    expect(message.text).toContain("Locul de întâlnire este acum: Poiana Brașov, la telecabină.");
    expect(message.text).not.toContain("Parcul Tractorul");
    expect(message.text).toContain("Vezi pagina evenimentului");
    // English first for the English registration, and no token minted for anybody.
    const english = await renderOutboxMessage(told.get(byName("bogdan").id)!, db, NOW);
    expect(english.subject.startsWith("Updated details for Autumn race")).toBe(true);
    expect(english.text).toContain("The meeting point is now: Poiana Brașov, la telecabină.");
    expect(await db.select().from(emailActionTokens)).toHaveLength(0);

    // Audited: who, what changed, how many — never who was told.
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "event.update_notice_sent"));
    expect(audit.actorStaffUserId).toBe(editor.id);
    expect(audit.entityId).toBe(event.id);
    expect(audit.metadataJson).toMatchObject({ changes: ["place"], recipients: 4, note: null });
  });

  it("unticked, the same change emails nobody", async () => {
    const event = await seedEvent();
    await seedRegistrations(event.id, EVERYONE);

    const result = await save(event.id, { fields: { locationName: "Poiana Brașov" }, notice: { notify: false, note: "Ignored, since nobody asked." } });
    expect(result.notice).toBeUndefined();
    expect(await queued("EVENT_UPDATE_NOTICE")).toHaveLength(0);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "event.update_notice_sent"))).toHaveLength(0);
    // And a save with no notice at all — every caller before §331 — is the same.
    expect((await save(event.id, { fields: { locationName: "Poiana Brașov, sus" } })).notice).toBeUndefined();
    expect(await queued("EVENT_UPDATE_NOTICE")).toHaveLength(0);
  });

  it("ticked on a save that changed only the words sends nothing and says so — unless the organizer wrote a note", async () => {
    const event = await seedEvent();
    await seedRegistrations(event.id, EVERYONE);

    const quiet = await save(event.id, { ro: { excerpt: "Rapid și plat." }, notice: { notify: true } });
    expect(quiet.notice).toEqual({ kind: "nothingToTell" });
    expect(await queued("EVENT_UPDATE_NOTICE")).toHaveLength(0);

    // A note is a thing the organizer chose to say: it goes, on its own, escaped as plain text.
    const note = "Aduceți frontala: <b>**startul**</b> e pe întuneric.\r\nParcarea e închisă.";
    const said = await save(event.id, { ro: { excerpt: "Rapid și plat, pe întuneric." }, notice: { notify: true, note } });
    expect(said.notice).toEqual({ kind: "update", queued: 4, changes: [] });
    const [first] = await queued("EVENT_UPDATE_NOTICE");
    expect(first.payloadJson).toEqual({ changes: [], note: "Aduceți frontala: <b>**startul**</b> e pe întuneric.\nParcarea e închisă." });
    const message = await renderOutboxMessage(first, db, NOW);
    expect(message.text).toContain("Mesajul organizatorilor:");
    expect(message.text).toContain("Parcarea e închisă.");
    // No markup of the organizer's reaches the page, and their asterisks stay asterisks.
    expect(message.html).toContain("&lt;b&gt;**startul**&lt;/b&gt;");
    expect(message.html).not.toContain("<strong>startul</strong>");
    // Nothing is claimed to have changed.
    expect(message.text).not.toContain("Locul de întâlnire este acum");
  });

  it("a new start names the new date and time, and a new programme row names the programme", async () => {
    const event = await seedEvent({ raceStartsAt: new Date("2026-10-11T09:00:00+03:00") });
    await seedRegistrations(event.id, [{ name: "ana", status: "CONFIRMED" }]);

    const result = await save(event.id, {
      fields: {
        startsAtWallTime: "2026-10-11T09:00",
        endsAtWallTime: "2026-10-11T10:30",
        raceStartsAtWallTime: "2026-10-11T10:00",
        scheduleRows: [{ date: "2026-10-11", time: "09:00", endTime: "", ro: "Ridicarea kiturilor", en: "Kit pick-up", place: "Cort" }],
      },
      notice: { notify: true },
    });
    expect(result.notice).toEqual({ kind: "update", queued: 1, changes: ["time", "programme"] });

    const [row] = await queued("EVENT_UPDATE_NOTICE");
    const message = await renderOutboxMessage(row, db, NOW);
    expect(message.text).toMatch(/Data și ora sunt acum: duminică, 11 octombrie 2026(,| la) 09:00; startul cursei la 10:00\./);
    expect(message.text).toContain("Programul actualizat:");
    expect(message.text).toContain("Ridicarea kiturilor");
  });

  it("the same save retried queues nothing twice", async () => {
    const event = await seedEvent();
    await seedRegistrations(event.id, [{ name: "ana", status: "CONFIRMED" }, { name: "bogdan", status: "WAITLISTED" }]);
    const input = { eventId: event.id, saveKey: `${event.id}:v9`, changes: ["place" as const], note: null, actorStaffUserId: editor.id, now: NOW };

    expect(await db.transaction((tx) => queueEventUpdateNotices(tx, input))).toBe(2);
    expect(await db.transaction((tx) => queueEventUpdateNotices(tx, input))).toBe(0);
    expect(await queued("EVENT_UPDATE_NOTICE")).toHaveLength(2);
    // The next save is a new version, so a new message.
    expect(await db.transaction((tx) => queueEventUpdateNotices(tx, { ...input, saveKey: `${event.id}:v10` }))).toBe(2);
  });

  it("refuses a note over five hundred characters, naming the box, and writes nothing", async () => {
    const event = await seedEvent();
    await seedRegistrations(event.id, [{ name: "ana", status: "CONFIRMED" }]);

    const refusal = await refusalOf(save(event.id, { fields: { locationName: "Poiana Brașov" }, notice: { notify: true, note: "x".repeat(501) } }));
    expect(refusal).toEqual({ code: "VALIDATION_ERROR", fields: ["notice.note"] });
    expect((await reload(event.id)).locationName).toBe("Parcul Tractorul");
    expect(await queued("EVENT_UPDATE_NOTICE")).toHaveLength(0);
  });

  it("a role that may not save the event row may not tell its participants, whatever it posts", async () => {
    const event = await seedEvent({ editorialStatus: "DRAFT", publishedAt: null });
    await seedRegistrations(event.id, [{ name: "ana", status: "CONFIRMED" }]);
    const ro = await translationOf(event.id, "ro");

    const refusal = await refusalOf(
      saveEventAndTranslations(db, {
        actor: copywriter,
        eventId: event.id,
        translations: [{ translationId: ro.id, expectedVersion: ro.version, fields: { slug: ro.slug, title: "Cursa", excerpt: "Rapid.", seoTitle: "", seoDescription: "" } }],
        notice: { notify: true, note: "Salut" },
        now: NOW,
      }),
    );
    expect(refusal?.code).toBe("FORBIDDEN");
    expect(await queued("EVENT_UPDATE_NOTICE")).toHaveLength(0);
  });

  it("cancelling asks why, then tells every active registration with the reason and leaves each one as it was", async () => {
    const event = await seedEvent();
    const rows = await seedRegistrations(event.id, EVERYONE);

    // No reason, no cancellation: the save is refused naming the box, and nothing is written.
    expect(await refusalOf(save(event.id, { fields: { eventStatus: "CANCELLED" } }))).toEqual({ code: "VALIDATION_ERROR", fields: ["cancel.reason"] });
    expect(await refusalOf(save(event.id, { fields: { eventStatus: "CANCELLED" }, cancellation: { reason: "   ", notify: true } }))).toEqual({
      code: "VALIDATION_ERROR",
      fields: ["cancel.reason"],
    });
    expect((await reload(event.id)).eventStatus).toBe("SCHEDULED");

    const reason = "Avertizare meteo de cod portocaliu: traseul nu este sigur.";
    const result = await save(event.id, { fields: { eventStatus: "CANCELLED" }, cancellation: { reason, notify: true } });
    expect(result.notice).toEqual({ kind: "cancelled", queued: 4, notified: true });
    expect((await reload(event.id)).eventStatus).toBe("CANCELLED");

    const notices = await queued("EVENT_CANCELLED");
    expect(notices).toHaveLength(5);
    expect(notices.every((row) => (row.payloadJson as { reason: string }).reason === reason)).toBe(true);
    const ana = notices.find((row) => row.registrationId === rows.find((r) => r.registeredName === "ana")!.id)!;
    const message = await renderOutboxMessage(ana, db, NOW);
    expect(message.subject).toContain("Evenimentul „Cursa de toamnă” a fost anulat");
    expect(message.text).toContain("Motivul:");
    expect(message.text).toContain(reason);
    expect(message.text).toContain("nu trebuie să faci nimic");
    expect(message.text).toContain("Scrie-ne");

    // Nobody's registration was touched: the cancellation is the event's, not theirs.
    const after = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    for (const row of rows) expect(after.find((r) => r.id === row.id)?.status).toBe(row.status);
    // And no update notice rode along with it.
    expect(await queued("EVENT_UPDATE_NOTICE")).toHaveLength(0);

    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "event.cancelled"));
    expect(audit.actorStaffUserId).toBe(editor.id);
    expect(audit.metadataJson).toMatchObject({ reason, notified: true, recipients: 4 });
  });

  it("cancelling with the box unticked tells nobody and still records who and why", async () => {
    const event = await seedEvent();
    await seedRegistrations(event.id, EVERYONE);

    const result = await save(event.id, { fields: { eventStatus: "CANCELLED" }, cancellation: { reason: "Traseul este închis.", notify: false } });
    expect(result.notice).toEqual({ kind: "cancelled", queued: 0, notified: false });
    expect(await queued("EVENT_CANCELLED")).toHaveLength(0);
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "event.cancelled"));
    expect(audit.metadataJson).toMatchObject({ reason: "Traseul este închis.", notified: false, recipients: 0 });

    // A later save of the cancelled event is not a second cancellation: no reason asked, nothing sent.
    expect((await save(event.id, { fields: { capacity: "25" }, notice: { notify: true } })).notice).toBeUndefined();
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "event.cancelled"))).toHaveLength(1);
  });

  it("cancelling an event that takes no registrations here says there was nobody to tell, not that a box was unticked", async () => {
    const event = await seedEvent({
      type: "GROUP_RUN",
      surface: "TRAIL",
      registrationMode: "NONE",
      capacity: null,
      registrationOpensAt: null,
      registrationClosesAt: null,
      declarationDocumentId: null,
    });

    // The editor draws no "tell them" box for it, so the form posts the reason alone.
    const result = await save(event.id, { fields: { eventStatus: "CANCELLED" }, cancellation: { reason: "Ploaie torențială.", notify: false } });
    expect(result.notice).toEqual({ kind: "cancelledNobodyToTell" });
    expect((await reload(event.id)).eventStatus).toBe("CANCELLED");
    expect(await queued("EVENT_CANCELLED")).toHaveLength(0);
    // Still asked why, and still recorded who and why.
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "event.cancelled"));
    expect(audit.metadataJson).toMatchObject({ reason: "Ploaie torențială.", notified: false, recipients: 0 });
  });

  it("a series save that cancels a date already run records it too, and tells its runners nothing", async () => {
    const source = await seedEvent({ type: "GROUP_RUN", registrationMode: "INTERNAL", capacity: null });
    await repeatEvent(db, { actor: editor, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-11-01", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id)).orderBy(asc(events.startsAt));
    expect(dates.length).toBeGreaterThanOrEqual(2);
    const [ran, upcoming] = dates;
    // One date of the series was last Saturday: "every date" reaches it (§130).
    await db
      .update(events)
      .set({ startsAt: new Date("2026-09-12T08:00:00+03:00"), endsAt: new Date("2026-09-12T09:30:00+03:00") })
      .where(eq(events.id, ran.id));
    await seedRegistrations(source.id, [{ name: "ana", status: "CONFIRMED" }]);
    const [bogdansEntry] = await seedRegistrations(ran.id, [{ name: "bogdan", status: "CONFIRMED" }]);
    await seedRegistrations(upcoming.id, [{ name: "carmen", status: "CONFIRMED" }]);

    const reason = "Parcul este închis până la primăvară.";
    const result = await save(source.id, { fields: { eventStatus: "CANCELLED" }, cancellation: { reason, notify: true }, scope: "all" });
    expect(result.appliedTo).toBe(dates.length);
    // The banner counts messages: Ana's and Carmen's, not Bogdan's — his morning is over.
    expect(result.notice).toEqual({ kind: "cancelled", queued: 2, notified: true });
    const notices = await queued("EVENT_CANCELLED");
    expect(notices).toHaveLength(2);
    expect(notices.some((row) => row.registrationId === bogdansEntry.id)).toBe(false);

    // One audit row per date the save cancelled, the one already run included and marked so.
    const audits = await db.select().from(auditLogs).where(eq(auditLogs.action, "event.cancelled"));
    expect(audits).toHaveLength(dates.length + 1);
    const ranAudit = audits.find((row) => row.entityId === ran.id)!;
    expect(ranAudit.metadataJson).toMatchObject({ reason, notified: false, recipients: 0, alreadyStarted: true });
    const upcomingAudit = audits.find((row) => row.entityId === upcoming.id)!;
    expect(upcomingAudit.metadataJson).toMatchObject({ reason, notified: true, recipients: 1 });
    expect(upcomingAudit.metadataJson).not.toHaveProperty("alreadyStarted");
  });

  it("put back on, the event can say so when asked", async () => {
    const event = await seedEvent({ eventStatus: "CANCELLED" });
    await seedRegistrations(event.id, [{ name: "ana", status: "CONFIRMED" }]);

    const result = await save(event.id, { fields: { eventStatus: "SCHEDULED" }, notice: { notify: true } });
    expect(result.notice).toEqual({ kind: "update", queued: 1, changes: ["reinstated"] });
    const [row] = await queued("EVENT_UPDATE_NOTICE");
    expect((await renderOutboxMessage(row, db, NOW)).text).toContain("Evenimentul nu mai este anulat: are loc.");
  });

  it("a series edit tells each future date's own registrants once, about their own date", async () => {
    const source = await seedEvent({ type: "GROUP_RUN", registrationMode: "INTERNAL", capacity: null });
    await repeatEvent(db, { actor: editor, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-11-01", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id)).orderBy(asc(events.startsAt));
    expect(dates.length).toBeGreaterThanOrEqual(2);
    const [second, third] = dates;
    await seedRegistrations(source.id, [{ name: "ana", status: "CONFIRMED" }]);
    await seedRegistrations(second.id, [{ name: "bogdan", status: "CONFIRMED" }, { name: "carmen", status: "WAITLISTED" }]);
    await seedRegistrations(third.id, [{ name: "dan", status: "CONFIRMED", locale: "en" }]);

    const result = await save(source.id, { fields: { locationName: "Poiana Brașov" }, notice: { notify: true }, scope: "all" });
    expect(result.appliedTo).toBe(dates.length);
    expect(result.notice).toEqual({ kind: "update", queued: 4, changes: ["place"] });

    const notices = await queued("EVENT_UPDATE_NOTICE");
    expect(notices).toHaveLength(4);
    // One per registration, never two, and each renders its own date.
    expect(new Set(notices.map((row) => row.registrationId)).size).toBe(4);
    const dan = notices.find((row) => row.locale === "en")!;
    const message = await renderOutboxMessage(dan, db, NOW);
    expect(message.text).toContain("The meeting point is now: Poiana Brașov.");
    expect(message.text).toContain(new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeZone: ZONE }).format(third.startsAt));
  });
});
