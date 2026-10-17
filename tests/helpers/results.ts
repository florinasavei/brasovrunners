import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations, type RegistrationSex, type RegistrationStatus } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentBody } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { termsEn, termsRo } from "@/modules/legal-documents/templates/terms";
import { resolveDisplayName } from "@/modules/registrations/names";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import type { TestDatabase } from "./db";

/**
 * The fixtures the race-results tests share (§808): a race, runners who registered with a number, the staff of every role, and the
 * privacy notice in force — the platform's own (it names `{{results}}`) or an older one that does not.
 */

/** The race's day: 21 November 2026, 09:00 in Brașov, so a runner's age is counted on that calendar day. */
export const RACE_STARTS_AT = new Date("2026-11-21T07:00:00.000Z");
/** After the race, inside the public list's thirty days. */
export const AFTER_THE_RACE = new Date("2026-11-23T10:00:00.000Z");
/** The same date a public list that has closed reads: the race is a year behind. */
export const A_YEAR_AFTER = new Date("2027-11-23T10:00:00.000Z");

export async function person(db: TestDatabase, role: StaffRole, name: string): Promise<StaffUser> {
  const [row] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.test`, displayName: name, role }).returning();
  return row;
}

export async function createRace(db: TestDatabase, over: Partial<typeof events.$inferInsert> = {}) {
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: RACE_STARTS_AT, registrationMode: "INTERNAL", editorialStatus: "PUBLISHED", publishedAt: AFTER_THE_RACE, ...over })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `cros-${event.id.slice(0, 8)}`, title: "Crosul Tâmpei" },
    { eventId: event.id, locale: "en", slug: `race-${event.id.slice(0, 8)}`, title: "Tampa Race" },
  ]);
  return event;
}

let counter = 0;

export type Runner = {
  name: string;
  bibNumber: number | null;
  sex?: RegistrationSex | null;
  birthDate?: string | null;
  /** The «Vreau să apar pe lista de participanți & rezultate» tick (`list_opt_out` false). Defaults to ticked. */
  ticked?: boolean;
  status?: RegistrationStatus;
  checkedInAt?: Date | null;
  kind?: "REAL" | "TEST";
  /** The privacy notice version the registration recorded (defaults to 1, the first notice). */
  noticeVersion?: number;
  /** Sits «În afara locurilor» (the special guests' hidden list, §643). */
  outsideCapacity?: boolean;
};

/** A registration holding a race number, with the answers a category is made of. */
export async function registerRunner(db: TestDatabase, eventId: string, input: Runner) {
  counter += 1;
  const email = `runner${counter}@example.org`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: input.name, preferredLocale: "ro" })
    .returning();
  const [registration] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId: participant.id,
      status: input.status ?? "CONFIRMED",
      kind: input.kind ?? "REAL",
      locale: "ro",
      registeredName: input.name,
      displayName: resolveDisplayName({ legalName: input.name }),
      privacyNoticeVersion: input.noticeVersion ?? 1,
      outsideCapacity: input.outsideCapacity ?? false,
      privacyAcknowledgedAt: AFTER_THE_RACE,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      listOptOut: input.ticked === false,
      confirmedAt: AFTER_THE_RACE,
      emailConfirmedAt: AFTER_THE_RACE,
      bibNumber: input.bibNumber,
      sex: input.sex ?? null,
      birthDate: input.birthDate ?? null,
      checkedInAt: input.checkedInAt ?? null,
    })
    .returning();
  return registration;
}

let nextVersion = 1;

/** Puts a privacy notice in force, both languages: the platform's template as it is, or with `{{results}}` taken out (what an older notice reads like). */
export async function approvePrivacyNotice(db: TestDatabase, options: { results: boolean }) {
  const strip = (body: LegalDocumentBody) => JSON.parse(JSON.stringify(body).split("{{results}}").join("")) as LegalDocumentBody;
  const bodies = options.results ? { ro: privacyNoticeRo, en: privacyNoticeEn } : { ro: strip(privacyNoticeRo), en: strip(privacyNoticeEn) };
  const translations = [
    { locale: "ro" as const, title: "Nota de confidențialitate", body: bodies.ro },
    { locale: "en" as const, title: "Privacy notice", body: bodies.en },
  ];
  const version = nextVersion++;
  const now = new Date("2026-10-01T10:00:00.000Z");
  await insertLegalDocumentVersion(db, {
    key: "PRIVACY_NOTICE",
    version,
    effectiveAt: new Date(now.getTime() + version * 60_000),
    isApproved: true,
    contentSha256: computeContentHash(translations),
    translations,
    now,
  });
}

let nextTermsVersion = 1;

/** Puts terms in force, both languages: the platform's template as it is, or with `{{results}}` taken out (what the older terms read like). */
export async function approveTerms(db: TestDatabase, options: { results: boolean }) {
  const strip = (body: LegalDocumentBody) => JSON.parse(JSON.stringify(body).split("{{results}}").join("")) as LegalDocumentBody;
  const bodies = options.results ? { ro: termsRo, en: termsEn } : { ro: strip(termsRo), en: strip(termsEn) };
  const translations = [
    { locale: "ro" as const, title: "Termeni", body: bodies.ro },
    { locale: "en" as const, title: "Terms", body: bodies.en },
  ];
  const version = nextTermsVersion++;
  const now = new Date("2026-10-01T10:00:00.000Z");
  await insertLegalDocumentVersion(db, {
    key: "TERMS",
    version,
    effectiveAt: new Date(now.getTime() + version * 60_000),
    isApproved: true,
    contentSha256: computeContentHash(translations),
    translations,
    now,
  });
}

/** What the club must have approved before an Administrator can publish: the notice and the terms, both naming the results. */
export async function approveResultsTexts(db: TestDatabase) {
  await approvePrivacyNotice(db, { results: true });
  await approveTerms(db, { results: true });
}

export function resetNoticeCounter() {
  nextVersion = 1;
  nextTermsVersion = 1;
}
