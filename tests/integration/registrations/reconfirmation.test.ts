import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { and, eq, isNotNull } from "drizzle-orm";
import { NextIntlClientProvider } from "next-intl";
import { type ComponentProps, createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrationReconfirmations } from "@/db/schema/registration-reconfirmations";
import { type Registration, type RegistrationStatus, registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * «Cere reconfirmarea» (the decision «Cere reconfirmarea»; BR-REQ-036-01, BR-REQ-036-02, BR-REQ-080-02, BR-REQ-060-01) —
 * the owner: the club sees who pressed «Vin»; answering is optional, nothing in a state, a place, a deadline, the allocator
 * or the capacity formula reads the answer, and «N-au răspuns» is information for the organizers, not a state.
 *
 * The send writes one ask per registration it asks (confirmed, owed the declaration, waiting — test rows too), the flag in
 * every row's payload and in the audit row; the email carries «Vin» beside «Nu mai pot ajunge» on the same manage token;
 * the manage page's GET asks and writes nothing; «Da, vin la cursă» reads the token through the reader «Schimbă adresa»
 * binds to the registration's current participant, never spends it, and records the first moment once. Staff read it on
 * the list (the chip, the filter, the count), on «Mesaje trimise» (three numbers, test rows left out), in the export and
 * on «Toate datele unei persoane»; the erase takes it with the row. All people here are made up.
 */
const DAY = 86_400_000;

let db: TestDatabase;
let close: () => Promise<void>;

vi.mock("@/db/client", () => ({ getDb: () => db }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { redirectTo: url });
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next-intl/server", async (importOriginal) => {
  const { createTranslator } = await import("next-intl");
  const catalogues = { ro: (await import("../../../messages/ro.json")).default, en: (await import("../../../messages/en.json")).default };
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    getTranslations: async (arg: string | { locale?: string; namespace: string }) => {
      const namespace = typeof arg === "string" ? arg : arg.namespace;
      const locale = (typeof arg === "string" ? "ro" : (arg.locale ?? "ro")) as "ro" | "en";
      return createTranslator({ locale, messages: catalogues[locale], namespace: namespace as "Registrations" });
    },
    getLocale: async () => "ro",
    setRequestLocale: () => {},
  };
});
vi.mock("@/i18n/navigation", async (importOriginal) => {
  const { createElement: element } = await import("react");
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    Link: ({ href, children }: { href: unknown; children: ReactNode }) => element("a", { href: typeof href === "string" ? href : "#" }, children),
  };
});
vi.mock("@/shared/feedback/PublicFlash", () => ({ default: () => null }));
vi.mock("@/modules/registrations/ui/RegistrationJourney", () => ({ default: () => null }));

const { sendParticipantMessage, previewParticipantMessage, listParticipantMessages } = await import("@/modules/notifications/participant-messages");
const { renderOutboxMessage } = await import("@/modules/notifications/render");
const { updateClubNotices } = await import("@/modules/notifications/club-notices");
const { reconfirmFromManageAction } = await import("@/app/[locale]/registrations/manage/[token]/actions");
const { default: ManageRegistrationPage } = await import("@/app/[locale]/registrations/manage/[token]/page");
const { listRegistrationsForAdmin, countRegistrationsForAdmin, summariseRegistrationsForAdmin, findRegistrationDetailForAdmin } = await import(
  "@/modules/registrations/admin-repository"
);
const { changeRegistrationAddress, deleteRegistrationByStaff } = await import("@/modules/registrations/admin-service");
const { viewPersonData } = await import("@/modules/registrations/person-data");

const WORDS = {
  subject: { ro: "Ne vedem la {eventTitle}?", en: "See you at {eventTitle}?" },
  body: { ro: "Bună, {participantName}!\n\nDacă nu apeși nimic, înscrierea rămâne cum e.", en: "Hi {participantName}!\n\nIf you press nothing, nothing changes." },
};

let eventId: string;
let organizer: StaffUser;
let serial = 0;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  for (const key of ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const) {
    const translations: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: key, body: { sections: [{ paragraphs: ["p"] }] } },
      { locale: "en", title: key, body: { sections: [{ paragraphs: ["p"] }] } },
    ];
    await insertLegalDocumentVersion(db, {
      key,
      version: 1,
      effectiveAt: new Date("2026-01-01T00:00:00Z"),
      isApproved: true,
      contentSha256: computeContentHash(translations),
      translations,
      now: new Date(),
    });
  }
  organizer = await staff("MODERATOR");
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date(Date.now() + 10 * DAY),
      timezone: "Europe/Bucharest",
      locationName: "Parcul Tractorul",
      registrationMode: "INTERNAL",
      capacity: 50,
      editorialStatus: "PUBLISHED",
      publishedAt: new Date(),
    })
    .returning();
  eventId = event.id;
  await db.insert(eventTranslations).values([
    { eventId, locale: "ro", title: "Crosul Tâmpei", slug: `crosul-${eventId.slice(0, 8)}` },
    { eventId, locale: "en", title: "The Tâmpa cross", slug: `tampa-cross-${eventId.slice(0, 8)}` },
  ]);
});

async function staff(role: StaffRole): Promise<StaffUser> {
  serial += 1;
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}-${serial}@dev.test`, displayName: `Staff ${serial}`, role }).returning();
  return user;
}

async function address(email: string) {
  const identity = canonicalizeEmail(email);
  const [existing] = await db.select().from(participants).where(eq(participants.canonicalEmail, identity.canonicalEmail));
  if (existing) return existing;
  const [created] = await db
    .insert(participants)
    .values({ ...identity, defaultName: email.split("@")[0] })
    .returning();
  return created;
}

/** A made-up registration at `status`, on its own address unless `email` names a shared one. */
async function person(name: string, status: RegistrationStatus, extra: { kind?: "REAL" | "TEST"; email?: string; locale?: "ro" | "en" } = {}): Promise<Registration> {
  const owner = await address(extra.email ?? `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}@example.test`);
  const [row] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId: owner.id,
      status,
      kind: extra.kind ?? "REAL",
      locale: extra.locale ?? "ro",
      registeredName: name,
      displayName: name,
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: new Date(),
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      listOptOut: true,
      tshirtSize: "NONE",
      firstName: name,
      lastName: "Exemplu",
      waitlistedAt: status === "WAITLISTED" || status === "WAITLIST_OFFERED" ? new Date() : null,
      holdExpiresAt: status === "PENDING_DECLARATION" || status === "WAITLIST_OFFERED" ? new Date(Date.now() + 2 * DAY) : null,
      offerCreatedAt: status === "WAITLIST_OFFERED" ? new Date() : null,
      confirmedAt: status === "CONFIRMED" ? new Date() : null,
      checkinCode: status === "CONFIRMED" ? `C${randomUUID().slice(0, 7).toUpperCase()}` : null,
      ...(status === "CANCELLED" ? { cancelledAt: new Date(), cancellationSource: "PARTICIPANT" as const } : {}),
      ...(status === "EXPIRED" ? { expiredAt: new Date(), expiryReason: "DECLARATION_HOLD_LAPSED" as const } : {}),
    })
    .returning();
  return row;
}

const send = (overrides: Partial<Parameters<typeof sendParticipantMessage>[2]> = {}, actor: StaffUser = organizer) =>
  sendParticipantMessage(db, actor, { eventId, audience: "ALL_ACTIVE", sendId: randomUUID(), askReconfirm: true, ...WORDS, ...overrides }, new Date());

const asks = () => db.select().from(registrationReconfirmations);
const reconfirmAudits = () => db.select().from(auditLogs).where(eq(auditLogs.action, "registration.reconfirmed"));

async function refusalOf(attempt: Promise<unknown>) {
  try {
    await attempt;
    return undefined;
  } catch (caught) {
    if (isDomainError(caught)) return caught.code;
    throw caught;
  }
}

/** The organizer's message to one registration, rendered as the outbox would send it now. */
async function emailTo(registrationId: string, sendId?: string) {
  const rows = await db
    .select()
    .from(emailOutbox)
    .where(and(eq(emailOutbox.messageType, "ORGANIZER_MESSAGE"), eq(emailOutbox.registrationId, registrationId)));
  const row = sendId ? rows.find((candidate) => candidate.idempotencyKey.includes(sendId)) : rows.at(-1);
  if (!row) throw new Error("no organizer's message for this registration");
  return renderOutboxMessage(row, db, new Date());
}

/** The manage token «Vin» carries, read from the email's text part: `Vin: <manage url>#reconfirm`. */
function vinTokenOf(text: string): string | null {
  const url = /(?:Vin|I'm coming): (\S+)#reconfirm/.exec(text)?.[1];
  return url ? decodeURIComponent(url.split("/").pop() ?? "") : null;
}
function cancelTokenOf(text: string): string | null {
  const url = /(\S+)#cancel/.exec(text)?.[1];
  return url ? decodeURIComponent(url.split("/").pop() ?? "") : null;
}

async function redirectOf(press: Promise<void>): Promise<string> {
  try {
    await press;
  } catch (error) {
    const to = (error as { redirectTo?: string }).redirectTo;
    if (to) return to;
    throw error;
  }
  throw new Error("the action did not redirect");
}

function pressVin(secret: string, registrationId?: string): Promise<string> {
  const form = new FormData();
  form.set("locale", "ro");
  form.set("token", secret);
  if (registrationId) form.set("registrationId", registrationId);
  return redirectOf(reconfirmFromManageAction(form));
}

function drawn(page: ReactElement, locale: "ro" | "en" = "ro"): string {
  return renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages: locale === "ro" ? ro : en } as unknown as ComponentProps<typeof NextIntlClientProvider>, page));
}

async function managePage(secret: string, query: Record<string, string> = {}): Promise<string> {
  return drawn((await ManageRegistrationPage({ params: Promise.resolve({ locale: "ro", token: secret }), searchParams: Promise.resolve(query) })) as ReactElement);
}

async function rowOf(id: string): Promise<Registration> {
  const [row] = await db.select().from(registrations).where(eq(registrations.id, id));
  return row;
}

describe("the send: «Cere reconfirmarea» asks, and only with the tick", () => {
  it("asks the confirmed, the pending declaration and the waiting — a test row too — never an offer; the flag in every payload and the audit", async () => {
    const ana = await person("Ana", "CONFIRMED");
    const elena = await person("Elena", "PENDING_DECLARATION");
    const carmen = await person("Carmen", "WAITLISTED");
    const dan = await person("Dan", "WAITLIST_OFFERED");
    const probe = await person("Probe", "CONFIRMED", { kind: "TEST" });
    const sendId = randomUUID();
    expect(await send({ sendId })).toEqual({ kind: "queued", real: 4, test: 1 });

    const asked = await asks();
    expect(asked.map((row) => row.registrationId).sort()).toEqual([ana.id, elena.id, carmen.id, probe.id].sort());
    expect(asked.every((row) => row.sendId === sendId && row.eventId === eventId && row.reconfirmedAt === null)).toBe(true);
    expect(asked.some((row) => row.registrationId === dan.id)).toBe(false);

    const rows = await db.select().from(emailOutbox).where(and(eq(emailOutbox.messageType, "ORGANIZER_MESSAGE"), isNotNull(emailOutbox.participantId)));
    expect(rows).toHaveLength(5);
    for (const row of rows) expect(row.payloadJson).toMatchObject({ ...WORDS, askReconfirm: true });

    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "event.participant_message_sent"));
    expect(audit.metadataJson).toMatchObject({ sendId, askReconfirm: true, asked: 3, askedTest: 1, recipients: 4, test: 1 });
  });

  it("without the tick: no ask, no flag, and no «Vin» in any email", async () => {
    const ana = await person("Ana", "CONFIRMED");
    await send({ askReconfirm: false });
    expect(await asks()).toEqual([]);
    const [row] = await db.select().from(emailOutbox).where(eq(emailOutbox.registrationId, ana.id));
    expect(row.payloadJson).toEqual(WORDS);
    const email = await emailTo(ana.id);
    expect(email.html).not.toContain('data-email-part="reconfirm"');
    expect(email.html).toContain('data-email-part="cannot-come"');
    expect(vinTokenOf(email.text)).toBeNull();
  });

  it("BR-REQ-060-01: the Organizer, the Administrator and the Superadministrator send it; every other role is refused and nothing is asked", async () => {
    await person("Ana", "CONFIRMED");
    for (const role of ["ADMIN", "SUPERADMIN"] as const) expect((await send({}, await staff(role))).kind, role).toBe("queued");
    expect((await asks()).length).toBe(2);
    for (const role of ["MEMBER", "CONTRIBUTOR", "COPYWRITER", "DEV"] as const) {
      const actor = await staff(role);
      expect(await refusalOf(send({}, actor)), role).toBe("FORBIDDEN");
      expect(await refusalOf(previewParticipantMessage(db, actor, { eventId, locale: "ro", ...WORDS, askReconfirm: true })), role).toBe("FORBIDDEN");
    }
    expect((await asks()).length).toBe(2);
  });

  it("the preview shows «Nu mai pot ajunge» and, ticked, «Vin» — both on an inert example link, no token minted", async () => {
    await person("Ana", "CONFIRMED");
    const plain = await previewParticipantMessage(db, organizer, { eventId, locale: "ro", ...WORDS });
    expect(plain.html).toContain('data-email-part="cannot-come"');
    expect(plain.html).not.toContain('data-email-part="reconfirm"');
    const asking = await previewParticipantMessage(db, organizer, { eventId, locale: "ro", ...WORDS, askReconfirm: true });
    expect(asking.html).toContain('data-email-part="reconfirm"');
    expect(asking.html).toContain("/ro/EXAMPLE#reconfirm");
    expect(asking.html).toContain("/ro/EXAMPLE#cancel");
    expect(asking.html).toContain(">Vin</a>");
    expect(asking.html).toContain("Ne spui că vii. Nu e obligatoriu.");
    // «Vin» above «Nu mai pot ajunge».
    expect(asking.html.indexOf('data-email-part="reconfirm"')).toBeLessThan(asking.html.indexOf('data-email-part="cannot-come"'));
    const english = await previewParticipantMessage(db, organizer, { eventId, locale: "en", ...WORDS, askReconfirm: true });
    expect(english.html).toContain(">I'm coming</a>");
    expect(await db.select().from(emailActionTokens)).toEqual([]);
  });
});

describe("the email: «Vin» on the cancel's own token, never on a club copy", () => {
  it("draws «Vin» for each asked registration at #reconfirm on the same manage token as «Nu mai pot ajunge»; none for an offer or the club's copy", async () => {
    const admin = await staff("ADMIN");
    await updateClubNotices(db, admin, { participants: { bcc: ["arhiva@club.test"] } }, new Date());
    const ana = await person("Ana", "CONFIRMED");
    const bogdan = await person("Bogdan", "WAITLISTED", { locale: "en" });
    const dan = await person("Dan", "WAITLIST_OFFERED");
    await send();

    const email = await emailTo(ana.id);
    const vin = vinTokenOf(email.text);
    expect(vin).not.toBeNull();
    expect(cancelTokenOf(email.text)).toBe(vin);
    expect(email.text).toContain("Ne spui că vii. Nu e obligatoriu.");
    expect(email.html).toContain("/brand/email-reconfirm.png");
    // English first for an English registrant, with its own words.
    const english = await emailTo(bogdan.id);
    expect(english.text).toMatch(/I'm coming: \S+#reconfirm/);
    // An offer is pointed at its own email: no «Vin», the cancel as ever.
    const offer = await emailTo(dan.id);
    expect(vinTokenOf(offer.text)).toBeNull();
    expect(offer.html).toContain('data-email-part="cannot-come"');

    const [copy] = await db.select().from(emailOutbox).where(and(eq(emailOutbox.messageType, "ORGANIZER_MESSAGE"), eq(emailOutbox.recipientEmail, "arhiva@club.test")));
    expect(copy.payloadJson).toMatchObject({ askReconfirm: true });
    const copied = await renderOutboxMessage(copy, db, new Date());
    expect(copied.html).not.toContain('data-email-part="reconfirm"');
    expect(copied.text).not.toContain("#reconfirm");
  });
});

describe("the manage page: the GET asks and writes nothing, the POST records once", () => {
  async function askedOne(status: RegistrationStatus = "CONFIRMED") {
    const ana = await person("Ana", status);
    await send();
    const secret = vinTokenOf((await emailTo(ana.id)).text);
    if (!secret) throw new Error("no «Vin» link");
    return { ana, secret };
  }

  it("draws «Vii la …?» with «Da, vin la cursă», the optional line and the way out — and writes nothing", async () => {
    const { secret } = await askedOne();
    const auditsBefore = (await db.select().from(auditLogs)).length;
    const html = await managePage(secret);
    expect(html).toContain('id="reconfirm"');
    expect(html).toContain("Vii la Crosul Tâmpei?");
    expect(html).toContain("Da, vin la cursă");
    expect(html).toContain(ro.Registrations.reconfirm.optional);
    expect(html).toContain(ro.Registrations.reconfirm.cannot.replace(/„/g, "„"));
    expect((await asks()).every((row) => row.reconfirmedAt === null)).toBe(true);
    expect((await db.select().from(auditLogs)).length).toBe(auditsBefore);
    expect((await db.select().from(emailActionTokens)).every((token) => token.usedAt === null)).toBe(true);
  });

  it("records the first moment, audits it once without a staff actor, never spends the token, and a second press keeps the first", async () => {
    const { ana, secret } = await askedOne();
    const before = await rowOf(ana.id);
    expect(await pressVin(secret)).toMatch(/\?reconfirm=1#reconfirm$/);
    const [first] = await asks();
    expect(first.reconfirmedAt).not.toBeNull();
    const audits = await reconfirmAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorStaffUserId: null, participantId: ana.participantId, entityId: ana.id, metadataJson: { via: "MANAGE_LINK", sends: 1 } });
    expect((await db.select().from(emailActionTokens)).every((token) => token.usedAt === null)).toBe(true);
    // Optional and inert: nothing about the registration moved.
    expect(await rowOf(ana.id)).toEqual(before);

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await pressVin(secret)).toMatch(/\?reconfirm=1#reconfirm$/);
    const [again] = await asks();
    expect(again.reconfirmedAt?.getTime()).toBe(first.reconfirmedAt?.getTime());
    expect(await reconfirmAudits()).toHaveLength(1);

    const answered = await managePage(secret, { reconfirm: "1" });
    expect(answered).toContain('data-testid="manage-reconfirm-done"');
    expect(answered).not.toContain('data-testid="manage-reconfirm-yes"');
    // The cancel is still there: the press spent nothing.
    expect(answered).toContain('data-testid="manage-person-cancel"');
  });

  it("answers every open ask of the registration at once: the answer is about the event", async () => {
    const ana = await person("Ana", "CONFIRMED");
    await send();
    await send();
    expect(await asks()).toHaveLength(2);
    const secret = vinTokenOf((await emailTo(ana.id)).text)!;
    await pressVin(secret);
    expect((await asks()).every((row) => row.reconfirmedAt !== null)).toBe(true);
    expect((await reconfirmAudits())[0].metadataJson).toEqual({ via: "MANAGE_LINK", sends: 2 });
  });

  it("takes a family member's answer from the same link, and refuses a stranger's registration with nothing recorded", async () => {
    const ana = await person("Ana", "CONFIRMED", { email: "familia@example.test" });
    const ion = await person("Ion", "CONFIRMED", { email: "familia@example.test" });
    const stranger = await person("Străin", "CONFIRMED");
    await send();
    const secret = vinTokenOf((await emailTo(ana.id)).text)!;
    expect(await pressVin(secret, stranger.id)).toMatch(/invalid=1/);
    expect((await asks()).every((row) => row.reconfirmedAt === null)).toBe(true);
    expect(await pressVin(secret, ion.id)).toMatch(new RegExp(`reconfirm=1&person=${ion.id}#reconfirm$`));
    const byId = new Map((await asks()).map((row) => [row.registrationId, row]));
    expect(byId.get(ion.id)?.reconfirmedAt).not.toBeNull();
    expect(byId.get(ana.id)?.reconfirmedAt).toBeNull();
  });

  it("refuses a link the registration has left through «Schimbă adresa»: answered as a missing token, nothing recorded", async () => {
    const { ana, secret } = await askedOne();
    await changeRegistrationAddress(db, await staff("ADMIN"), ana.id, "ana.noua@example.test", new Date());
    expect(await pressVin(secret)).toMatch(/invalid=1/);
    expect((await asks()).every((row) => row.reconfirmedAt === null)).toBe(true);
    expect(await reconfirmAudits()).toHaveLength(0);
    // The ask stays with the registration; the waiting message, re-addressed, keeps its flag.
    expect((await asks()).map((row) => row.registrationId)).toEqual([ana.id]);
    const [moved] = await db.select().from(emailOutbox).where(and(eq(emailOutbox.messageType, "ORGANIZER_MESSAGE"), eq(emailOutbox.registrationId, ana.id)));
    expect(moved.recipientEmail).toBe("ana.noua@example.test");
    expect(moved.payloadJson).toMatchObject({ askReconfirm: true });
    const fresh = vinTokenOf((await renderOutboxMessage(moved, db, new Date())).text);
    expect(fresh).not.toBeNull();
    expect(await pressVin(fresh!)).toMatch(/reconfirm=1/);
  });
});

describe("which states answer", () => {
  it("asks a declaration owed and a waiting entry each with its own line, and records their answer", async () => {
    const elena = await person("Elena", "PENDING_DECLARATION");
    const carmen = await person("Carmen", "WAITLISTED");
    await send();
    for (const [row, line] of [
      [elena, ro.Registrations.reconfirm.pending],
      [carmen, ro.Registrations.reconfirm.waitlisted],
    ] as const) {
      const secret = vinTokenOf((await emailTo(row.id)).text)!;
      const html = await managePage(secret);
      expect(html, row.registeredName).toContain(line);
      expect(html, row.registeredName).toContain("Da, vin la cursă");
      expect(await pressVin(secret), row.registeredName).toMatch(/reconfirm=1/);
      expect((await rowOf(row.id)).status, row.registeredName).toBe(row.status);
    }
    expect((await asks()).every((ask) => ask.reconfirmedAt !== null)).toBe(true);
  });

  it("points an offer made since the ask at its own email: no button, and a press is refused", async () => {
    const carmen = await person("Carmen", "WAITLISTED");
    await send();
    const secret = vinTokenOf((await emailTo(carmen.id)).text)!;
    await db.update(registrations).set({ status: "WAITLIST_OFFERED", offerCreatedAt: new Date(), holdExpiresAt: new Date(Date.now() + DAY) }).where(eq(registrations.id, carmen.id));
    const html = await managePage(secret);
    expect(html).toContain(ro.Registrations.reconfirm.offered);
    expect(html).not.toContain('data-testid="manage-reconfirm-yes"');
    expect(await pressVin(secret)).toMatch(/reconfirm=0/);
    expect((await asks())[0].reconfirmedAt).toBeNull();
  });

  it("answers a cancelled or expired registration, an event started or cancelled, without recording anything", async () => {
    const cases: Array<[string, (id: string) => Promise<void>]> = [
      ["cancelled", async (id) => void (await db.update(registrations).set({ status: "CANCELLED", cancelledAt: new Date(), cancellationSource: "PARTICIPANT" }).where(eq(registrations.id, id)))],
      ["expired", async (id) => void (await db.update(registrations).set({ status: "EXPIRED", expiredAt: new Date(), expiryReason: "DECLARATION_HOLD_LAPSED" }).where(eq(registrations.id, id)))],
      ["started", async () => void (await db.update(events).set({ startsAt: new Date(Date.now() - 60_000) }).where(eq(events.id, eventId)))],
      ["event cancelled", async () => void (await db.update(events).set({ eventStatus: "CANCELLED" }).where(eq(events.id, eventId)))],
    ];
    for (const [name, change] of cases) {
      await db.update(events).set({ startsAt: new Date(Date.now() + 10 * DAY), eventStatus: "SCHEDULED" }).where(eq(events.id, eventId));
      const row = await person(`Ana ${name}`, "CONFIRMED");
      const sendId = randomUUID();
      await send({ sendId });
      const secret = vinTokenOf((await emailTo(row.id, sendId)).text)!;
      await change(row.id);
      const html = await managePage(secret);
      expect(html, name).not.toContain('data-testid="manage-reconfirm-yes"');
      expect(await pressVin(secret), name).toMatch(/reconfirm=0/);
      const mine = (await asks()).filter((ask) => ask.registrationId === row.id);
      expect(mine.every((ask) => ask.reconfirmedAt === null), name).toBe(true);
    }
    expect(await reconfirmAudits()).toHaveLength(0);
  });

  it("refuses a registration nobody asked: there is no question to answer", async () => {
    const ana = await person("Ana", "CONFIRMED");
    await send({ askReconfirm: false });
    const secret = cancelTokenOf((await emailTo(ana.id)).text)!;
    const html = await managePage(secret);
    expect(html).not.toContain('id="reconfirm"');
    expect(await pressVin(secret)).toMatch(/reconfirm=0/);
  });
});

describe("what staff see", () => {
  async function scene() {
    const yes = await person("Ana", "CONFIRMED");
    const none = await person("Bogdan", "WAITLISTED");
    const later = await person("Carmen", "PENDING_DECLARATION");
    const expired = await person("Dan", "CONFIRMED");
    const probe = await person("Probe", "CONFIRMED", { kind: "TEST" });
    const unasked = await person("Elena", "CONFIRMED");
    const sendId = randomUUID();
    await send({ sendId });
    // Elena registers after the send: nobody asked her.
    await db.delete(registrationReconfirmations).where(eq(registrationReconfirmations.registrationId, unasked.id));
    await pressVin(vinTokenOf((await emailTo(yes.id)).text)!);
    await pressVin(vinTokenOf((await emailTo(probe.id)).text)!);
    // Carmen cancels after the ask (an Administrator's cancellation counts the same); Dan's hold lapses.
    await db.update(registrations).set({ status: "CANCELLED", cancelledAt: new Date(Date.now() + 1000), cancellationSource: "ADMIN" }).where(eq(registrations.id, later.id));
    await db.update(registrations).set({ status: "EXPIRED", expiredAt: new Date(), expiryReason: "DECLARATION_HOLD_LAPSED" }).where(eq(registrations.id, expired.id));
    return { yes, none, later, expired, probe, unasked, sendId };
  }

  it("filters the list by the three answers in one query each, the count and the pages honouring it, with the chip's moment on the row", async () => {
    const { yes, none, later, probe } = await scene();
    const ids = async (reconfirm: "yes" | "cancelled" | "none") => (await listRegistrationsForAdmin(db, { eventId, reconfirm })).map((row) => row.id).sort();
    expect(await ids("yes")).toEqual([yes.id, probe.id].sort());
    expect(await ids("cancelled")).toEqual([later.id]);
    expect(await ids("none")).toEqual([none.id]);
    expect(await countRegistrationsForAdmin(db, { eventId, reconfirm: "yes" })).toBe(2);
    expect(await countRegistrationsForAdmin(db, { eventId, reconfirm: "none" })).toBe(1);
    // Pages: one a page, the two «yes» rows on two pages.
    const first = await listRegistrationsForAdmin(db, { eventId, reconfirm: "yes" }, { limit: 1, offset: 0, sort: "name", dir: "asc" });
    const second = await listRegistrationsForAdmin(db, { eventId, reconfirm: "yes" }, { limit: 1, offset: 1, sort: "name", dir: "asc" });
    expect([...first, ...second].map((row) => row.id).sort()).toEqual([yes.id, probe.id].sort());
    // The summary leaves the test row out of the club's number and counts it apart.
    expect(await summariseRegistrationsForAdmin(db, { eventId, reconfirm: "yes" })).toMatchObject({ real: 1, test: 1 });
    // The export's reading (`excludeTest`) leaves it out altogether.
    expect((await listRegistrationsForAdmin(db, { eventId, reconfirm: "yes", excludeTest: true })).map((row) => row.id)).toEqual([yes.id]);
    // The row carries the moment for the chip and the export; nobody else's row does.
    const rows = await listRegistrationsForAdmin(db, { eventId });
    expect(rows.find((row) => row.id === yes.id)?.reconfirmedAt).toBeInstanceOf(Date);
    expect(rows.find((row) => row.id === none.id)?.reconfirmedAt).toBeNull();
    expect((await findRegistrationDetailForAdmin(db, yes.id))?.reconfirmedAt).toBeInstanceOf(Date);
  });

  it("gives each «Mesaje trimise» row its three numbers and its progress, test registrations left out of both", async () => {
    const { sendId } = await scene();
    await db.update(emailOutbox).set({ status: "SENT", sentAt: new Date() }).where(and(eq(emailOutbox.messageType, "ORGANIZER_MESSAGE"), eq(emailOutbox.recipientEmail, "ana@example.test")));
    await db.update(emailOutbox).set({ status: "FAILED" }).where(and(eq(emailOutbox.messageType, "ORGANIZER_MESSAGE"), eq(emailOutbox.recipientEmail, "bogdan@example.test")));
    const [entry] = await listParticipantMessages(db, eventId);
    expect(entry.sendId).toBe(sendId);
    expect(entry.askReconfirm).toBe(true);
    // Ana said «Vin»; Carmen cancelled after the ask; Bogdan did not answer; Dan expired is in none; the test row in none.
    expect(entry.answers).toEqual({ yes: 1, cancelled: 1, none: 1 });
    // Five real rows (Elena registered after the send got one too in this scene's send): one left, one failed, the rest waiting.
    expect(entry.progress).toEqual({ left: 1, waiting: 3, failed: 1 });
  });

  it("lists the asks and answers in «Toate datele unei persoane», and the erase takes them with the registration", async () => {
    const ana = await person("Ana", "CONFIRMED");
    await send();
    await pressVin(vinTokenOf((await emailTo(ana.id)).text)!);
    const admin = await staff("ADMIN");
    const data = await viewPersonData(db, admin, canonicalizeEmail("ana@example.test").canonicalEmail, new Date());
    expect(data.reconfirmations).toHaveLength(1);
    expect(data.reconfirmations[0]).toMatchObject({ registrationId: ana.id, eventId, eventTitle: "Crosul Tâmpei" });
    expect(data.reconfirmations[0].reconfirmedAt).toBeInstanceOf(Date);
    await deleteRegistrationByStaff(db, admin, ana.id, "cererea persoanei", new Date());
    expect(await asks()).toEqual([]);
  });

  it("goes with the row wherever a registration is deleted — the retention and test sweeps delete the row itself — by the cascade", async () => {
    const ion = await person("Ion", "CONFIRMED");
    const maria = await person("Maria", "WAITLISTED");
    await send();
    expect(await asks()).toHaveLength(2);
    // The sweeps delete the registration row itself (`jobs/retention.ts`, `test-registrations.ts`).
    await db.delete(registrations).where(eq(registrations.id, ion.id));
    expect((await asks()).map((row) => row.registrationId)).toEqual([maria.id]);
    await db.delete(registrations).where(eq(registrations.id, maria.id));
    expect(await asks()).toEqual([]);
  });
});

describe("the migration", () => {
  it("is 0200, expand only: one new table, its two cascading keys, its unique pair and its index — nothing dropped or rewritten", () => {
    const folder = path.join(process.cwd(), "src", "db", "migrations");
    const journal = JSON.parse(readFileSync(path.join(folder, "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
    const tags = journal.entries.map((entry) => entry.tag);
    expect(tags).toContain("0200_registration_reconfirmations");
    expect(tags.indexOf("0200_registration_reconfirmations")).toBe(tags.indexOf("0199_partner_mark") + 1);
    const sql = readFileSync(path.join(folder, "0200_registration_reconfirmations.sql"), "utf8");
    expect(sql).toContain('CREATE TABLE "registration_reconfirmations"');
    expect(sql).toContain('"reconfirmed_at" timestamp with time zone,');
    expect(sql).toContain('UNIQUE("registration_id","send_id")');
    expect(sql.match(/ON DELETE cascade/g)).toHaveLength(2);
    expect(sql).toContain('CREATE INDEX "registration_reconfirmations_event_send_idx"');
    expect(sql).not.toMatch(/DROP|RENAME|ALTER COLUMN|(?<!ON )UPDATE |(?<!ON )DELETE /);
  });
});
