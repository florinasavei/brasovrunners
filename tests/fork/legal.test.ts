import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { legalDocuments } from "@/db/schema/legal-documents";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { LEGAL_DOCUMENT_KEYS } from "@/modules/legal-documents/domain/keys";
import { approvePlatformTemplates, approveVersion, createDraftVersion, templateTranslations } from "@/modules/legal-documents/service";
import { templatePrefill } from "@/modules/legal-documents/templates/catalogue";
import { CLUB_CLAUSES, clubFactsFromEnv, remainingPlaceholders } from "@/modules/legal-documents/templates/club-facts";
import { isDomainError } from "@/shared/errors/domain-error";
import fork from "../fixtures/fork-club/club.json";
import forkLegal from "../fixtures/fork-club/legal.json";
import { createTestDatabase, type TestDatabase } from "../helpers/db";
import { UPSTREAM_IDENTITY } from "./upstream-identity";

/**
 * BR-REQ-101-01 and BR-REQ-053-01 (§NNN): a club that runs the platform with an empty `legal.json` gets the
 * platform's legal texts with a visible `<PLACEHOLDER>` wherever Brașov Runners' own choices stood — the data
 * protection officer, the mailbox and its company, the photo channels, the prize money — and its own safety
 * form's name from its `club.json`; never one of the upstream club's sentences. And it cannot approve them
 * like that: the one press and «Aprobă și publică» both refuse while a placeholder stands.
 *
 * Under `yarn test:fork` (`vitest.fork.config.mts`) `@club` is `tests/fixtures/fork-club/`, whose `legal.json`
 * is `{}`.
 */
const fold = (value: string) => value.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The choices the upstream club's `legal.json` makes, as its sentences say them — matched as written, case and all:
 * the platform's own example of a masked address («an…@gmail.com») is not the club's mailbox.
 */
const UPSTREAM_CHOICES = ["Gmail", "Google Ireland", "Facebook, Instagram", "premii în bani", "prize money", "responsabil cu protecția datelor", "data protection officer"];

/**
 * The upstream words a text says: its identity as whole words (folded), its choices as written. A merge field's name
 * is code and a `<PLACEHOLDER>` is the blank where the fork's own words go: both are left out.
 */
function upstreamWordsIn(text: string): string[] {
  const words = text.replace(/\{\{\s*\w+\s*\}\}/g, "").replace(/<[A-ZĂÂÎȘȚ'’][^<>]{3,}>/g, "");
  const folded = fold(words);
  return [
    ...UPSTREAM_IDENTITY.filter((word) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(fold(word))}(?![\\p{L}\\p{N}])`, "u").test(folded)),
    ...UPSTREAM_CHOICES.filter((choice) => words.includes(choice)),
  ];
}

const NOW = new Date("2026-11-01T10:00:00.000Z");
/** Every fact the environment gives, so what stays blank is the club's choices alone. */
const FACTS = clubFactsFromEnv({
  CLUB_LEGAL_NAME: "Asociația Exemplu",
  CLUB_REGISTRATION_NUMBER: "CIF 12345678",
  CLUB_REGISTERED_ADDRESS: "Str. Exemplu nr. 1",
  EMAIL_REPLY_TO: "contact@example.test",
});

/** Every choice but the safety form's name, which comes from club.json. */
const FROM_LEGAL_JSON = CLUB_CLAUSES.filter(({ placeholder }) => placeholder.ro !== "<NUMELE FORMULARULUI DE SIGURANȚĂ>");

async function codeOf(operation: Promise<unknown>): Promise<string> {
  try {
    await operation;
    return "ok";
  } catch (error) {
    return isDomainError(error) ? error.code : `unexpected: ${String(error)}`;
  }
}

describe("BR-REQ-101-01: a fork with an empty legal.json gets blanks, never Brașov Runners' clauses (§NNN)", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    [admin] = await db.insert(staffUsers).values({ email: "admin@fork.test", displayName: "Admin", role: "ADMIN" }).returning();
  });
  afterAll(async () => close());

  it("reads the made-up club's empty legal.json", () => {
    expect(forkLegal).toEqual({});
  });

  it("prefills the notice and the terms with every choice's placeholder visible, in both languages", () => {
    const privacy = templatePrefill("PRIVACY_NOTICE", FACTS);
    const terms = templatePrefill("TERMS", FACTS);
    for (const locale of ["ro", "en"] as const) {
      const left = [...remainingPlaceholders(privacy[locale].body), ...remainingPlaceholders(terms[locale].body)];
      expect(left.sort(), locale).toEqual(FROM_LEGAL_JSON.map(({ placeholder }) => placeholder[locale]).sort());
    }
  });

  it("names the fork's own safety form, from its club.json", () => {
    const privacy = templatePrefill("PRIVACY_NOTICE", FACTS);
    expect(JSON.stringify(privacy.ro.body)).toContain(`„${fork.safetyProgramme.ro}”`);
    expect(JSON.stringify(privacy.en.body)).toContain(`“${fork.safetyProgramme.en}”`);
  });

  it("says no upstream word in any prefilled text, title or body, in either language", () => {
    const found: string[] = [];
    for (const key of LEGAL_DOCUMENT_KEYS) {
      const prefill = templatePrefill(key, FACTS);
      for (const locale of ["ro", "en"] as const) {
        const words = upstreamWordsIn(JSON.stringify(prefill[locale]));
        if (words.length > 0) found.push(`${key} ${locale}: ${words.join(", ")}`);
      }
    }
    expect(found).toEqual([]);
  });

  it("refuses the one press, naming the blank, and approves nothing", async () => {
    expect(await codeOf(approvePlatformTemplates(db, admin, FACTS, NOW))).toBe("VALIDATION_ERROR");
    expect(await db.select().from(legalDocuments)).toHaveLength(0);
  });

  it("and «Aprobă și publică» on a draft started from the platform's text", async () => {
    const id = await createDraftVersion(db, admin, { key: "TERMS", translations: templateTranslations("TERMS", FACTS) }, NOW);
    expect(await codeOf(approveVersion(db, admin, id, NOW))).toBe("LEGAL_PLACEHOLDERS_LEFT");
    const rows = await db.select().from(legalDocuments);
    expect(rows.every((row) => !row.isApproved)).toBe(true);
  });
});
