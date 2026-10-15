import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emailMessageType } from "@/db/schema/email-outbox";
import {
  isUnannouncedChange,
  LEGAL_TEMPLATES_DIGEST_CLOCK,
  legalTemplatesDigestDue,
  legalTemplatesDigestOpensAt,
  legalTemplatesIdempotencyKey,
  legalTemplatesNoticeSchema,
  NO_LEGAL_TEMPLATES_NOTICE,
  readLegalTemplatesNoticeValue,
  templatePairs,
  templatesFingerprint,
} from "@/modules/legal-documents/domain/templates-notice";
import { EMAIL_GROUP_OF } from "@/modules/notifications/domain/email-transport";
import { isWaitedFor } from "@/modules/notifications/domain/email-delay";
import { CANNOT_COME_MESSAGES } from "@/modules/notifications/domain/cannot-come";
import { isParticipantMessage } from "@/modules/notifications/domain/club-notices";
import { NEVER_QUEUED_MESSAGE_TYPES } from "@/modules/notifications/domain/never-queued";
import { emailSampleFor, placeholdersFilledBy } from "@/modules/notifications/email-copy-fields";
import { legalTemplateNames, legalTemplatesWords } from "@/modules/notifications/legal-templates-words";
import { lawyerReads, renderBilingual } from "@/modules/notifications/templates";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §639 — «Șabloanele textelor legale s-au schimbat», the pure half: when the job looks, what a change
 * is, the email's place among the message types, and the backoffice words it quotes.
 */
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

describe("§639 what counts as a change of the templates", () => {
  const pairs = templatePairs([
    { key: "TERMS", filledHash: HASH_A },
    { key: "PRIVACY_NOTICE", filledHash: HASH_B },
  ]);
  const announced = { ...NO_LEGAL_TEMPLATES_NOTICE, pairs };

  it("fingerprints the sorted pairs, whatever the order they were read in", () => {
    expect(pairs).toEqual([`PRIVACY_NOTICE:${HASH_B}`, `TERMS:${HASH_A}`]);
    expect(templatesFingerprint(pairs)).toBe(templatesFingerprint([...pairs].reverse()));
    expect(templatesFingerprint(pairs)).not.toBe(templatesFingerprint([`TERMS:${HASH_A}`]));
  });

  it("is nothing when nothing is newer, nothing when it was announced, and a subset is no change", () => {
    expect(isUnannouncedChange([], NO_LEGAL_TEMPLATES_NOTICE)).toBe(false);
    expect(isUnannouncedChange([], announced)).toBe(false);
    expect(isUnannouncedChange(pairs, announced)).toBe(false);
    expect(isUnannouncedChange([`TERMS:${HASH_A}`], announced)).toBe(false);
  });

  it("is a change when a text is newer for the first time, or its template moved again", () => {
    expect(isUnannouncedChange(pairs, NO_LEGAL_TEMPLATES_NOTICE)).toBe(true);
    expect(isUnannouncedChange([`TERMS:${HASH_B}`], announced)).toBe(true);
    expect(isUnannouncedChange([...pairs, `EVENT_DECLARATION:${HASH_A}`], announced)).toBe(true);
  });

  it("keys one email by the change and the person", () => {
    expect(legalTemplatesIdempotencyKey(HASH_A, "staff-1")).toBe(`legal-templates:${HASH_A}:staff-1`);
  });

  it("reads an unreadable row as never checked, and a row written before the digest as it was", () => {
    expect(legalTemplatesNoticeSchema.safeParse(NO_LEGAL_TEMPLATES_NOTICE).success).toBe(true);
    expect(legalTemplatesNoticeSchema.safeParse({ ...NO_LEGAL_TEMPLATES_NOTICE, keys: ["NOT_A_TEXT"] }).success).toBe(false);
    expect(readLegalTemplatesNoticeValue({ checkedAt: "yesterday" })).toEqual(NO_LEGAL_TEMPLATES_NOTICE);
    // §775: rows kept by the hourly check carry a `templatesStamp` the digest no longer uses. Refusing one
    // would read as «never announced» and send the whole list again, so the extra field is dropped, not an error.
    const old = { ...NO_LEGAL_TEMPLATES_NOTICE, checkedAt: "2026-10-02T08:00:00.000Z", fingerprint: HASH_A, announcedAt: "2026-10-02T08:00:00.000Z", pairs: [`TERMS:${HASH_B}`], keys: ["TERMS"], templatesStamp: HASH_B };
    expect(readLegalTemplatesNoticeValue(old)).toEqual({ ...old, templatesStamp: undefined });
    expect(readLegalTemplatesNoticeValue(old).fingerprint).toBe(HASH_A);
  });
});

/**
 * §775 — the digest's turn: at most one email per club day (Europe/Bucharest), the first run at or
 * after 08:00 club time. Every instant below is handed to the function as `now`; nothing reads the
 * real clock, so `yarn test:clock` has nothing to move here.
 */
describe("§775 the digest opens at 08:00 club time, on the wall clock, across both changes of the clock", () => {
  const at = (iso: string) => new Date(iso);

  it("is 05:00Z in summer time and 06:00Z in winter time", () => {
    expect(LEGAL_TEMPLATES_DIGEST_CLOCK).toBe("08:00");
    expect(legalTemplatesDigestOpensAt(at("2026-07-15T12:00:00Z")).toISOString()).toBe("2026-07-15T05:00:00.000Z");
    expect(legalTemplatesDigestOpensAt(at("2026-12-15T12:00:00Z")).toISOString()).toBe("2026-12-15T06:00:00.000Z");
  });

  it("moves with the clock on the day of each change: the last Sundays of October and March", () => {
    // 2026-10-25: summer time ends at 04:00 local (01:00Z); 08:00 that day is winter time, 06:00Z.
    expect(legalTemplatesDigestOpensAt(at("2026-10-24T12:00:00Z")).toISOString()).toBe("2026-10-24T05:00:00.000Z");
    expect(legalTemplatesDigestOpensAt(at("2026-10-25T12:00:00Z")).toISOString()).toBe("2026-10-25T06:00:00.000Z");
    // 2026-03-29: summer time starts at 03:00 local (01:00Z); 08:00 that day is summer time, 05:00Z.
    expect(legalTemplatesDigestOpensAt(at("2026-03-28T12:00:00Z")).toISOString()).toBe("2026-03-28T06:00:00.000Z");
    expect(legalTemplatesDigestOpensAt(at("2026-03-29T12:00:00Z")).toISOString()).toBe("2026-03-29T05:00:00.000Z");
  });

  it("reads the club's day, not the UTC day: 00:30 in Brașov is already the next day, and before its 08:00", () => {
    // 2026-10-02T21:30Z is 00:30 on 3 October in Brașov.
    expect(legalTemplatesDigestOpensAt(at("2026-10-02T21:30:00Z")).toISOString()).toBe("2026-10-03T05:00:00.000Z");
    expect(legalTemplatesDigestDue(NO_LEGAL_TEMPLATES_NOTICE, at("2026-10-02T21:30:00Z"))).toBe(false);
  });

  it("is due from the first minute of 08:00, never before, in summer time", () => {
    expect(legalTemplatesDigestDue(NO_LEGAL_TEMPLATES_NOTICE, at("2026-10-24T04:59:59Z"))).toBe(false);
    expect(legalTemplatesDigestDue(NO_LEGAL_TEMPLATES_NOTICE, at("2026-10-24T05:00:00Z"))).toBe(true);
  });

  it("is due from the first minute of 08:00 in winter time, so the day the clock goes back opens an hour later in UTC", () => {
    expect(legalTemplatesDigestDue(NO_LEGAL_TEMPLATES_NOTICE, at("2026-10-25T05:59:59Z"))).toBe(false);
    expect(legalTemplatesDigestDue(NO_LEGAL_TEMPLATES_NOTICE, at("2026-10-25T06:00:00Z"))).toBe(true);
  });

  it("opens an hour earlier in UTC the day the clock goes forward", () => {
    expect(legalTemplatesDigestDue(NO_LEGAL_TEMPLATES_NOTICE, at("2026-03-29T04:59:59Z"))).toBe(false);
    expect(legalTemplatesDigestDue(NO_LEGAL_TEMPLATES_NOTICE, at("2026-03-29T05:00:00Z"))).toBe(true);
  });

  it("is not due again the same club day once the day's look has been made, and is the next morning", () => {
    const looked = { ...NO_LEGAL_TEMPLATES_NOTICE, checkedAt: "2026-10-24T05:03:00.000Z" };
    expect(legalTemplatesDigestDue(looked, at("2026-10-24T05:03:00Z"))).toBe(false);
    expect(legalTemplatesDigestDue(looked, at("2026-10-24T20:00:00Z"))).toBe(false);
    // 24 hours later is 07:03 local the day the clock goes back: still before 08:00, so not due.
    expect(legalTemplatesDigestDue(looked, at("2026-10-25T05:59:59Z"))).toBe(false);
    expect(legalTemplatesDigestDue(looked, at("2026-10-25T06:00:00Z"))).toBe(true);
  });

  it("counts a look made at 08:00 sharp as today's, and one made yesterday as no look for today", () => {
    expect(legalTemplatesDigestDue({ ...NO_LEGAL_TEMPLATES_NOTICE, checkedAt: "2026-10-24T05:00:00.000Z" }, at("2026-10-24T09:00:00Z"))).toBe(false);
    expect(legalTemplatesDigestDue({ ...NO_LEGAL_TEMPLATES_NOTICE, checkedAt: "2026-10-23T05:00:00.000Z" }, at("2026-10-24T09:00:00Z"))).toBe(true);
  });

  it("is one look a day even when the day's look found nothing: a change at 10:00 or 22:30 waits for tomorrow", () => {
    // 08:00 the 3rd (05:00Z): the look found nothing, and was still the day's look — `announcedAt` stays empty.
    const looked = { ...NO_LEGAL_TEMPLATES_NOTICE, checkedAt: "2026-10-03T05:00:00.000Z", announcedAt: null };
    for (const when of ["2026-10-03T07:00:00Z", "2026-10-03T11:00:00Z", "2026-10-03T19:30:00Z", "2026-10-03T20:59:00Z", "2026-10-03T21:30:00Z", "2026-10-04T04:59:00Z"]) {
      expect(legalTemplatesDigestDue(looked, at(when)), when).toBe(false);
    }
    expect(legalTemplatesDigestDue(looked, at("2026-10-04T05:00:00Z"))).toBe(true);
  });

  it("keeps the mark on the row's existing field, so no column or table is new", () => {
    expect(Object.keys(NO_LEGAL_TEMPLATES_NOTICE).sort()).toEqual(["announcedAt", "checkedAt", "fingerprint", "keys", "pairs"]);
  });
});

function sources(directory: string): { path: string; text: string }[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.(ts|tsx)$/.test(entry) ? [{ path: full, text: readFileSync(full, "utf8") }] : [];
  });
}

describe("§639 the message type", () => {
  it("is a value of the enum, queued in the source, and not among the types nothing queues", () => {
    expect(emailMessageType.enumValues).toContain("LEGAL_TEMPLATES_CHANGED");
    expect(NEVER_QUEUED_MESSAGE_TYPES.has("LEGAL_TEMPLATES_CHANGED")).toBe(false);
    const queuing = sources(join(process.cwd(), "src")).filter(({ text }) => /messageType:\s*"LEGAL_TEMPLATES_CHANGED"/.test(text));
    expect(queuing.map(({ path }) => path.replaceAll("\\", "/").replace(/^.*\/src\//, "src/"))).toEqual([
      "src/modules/legal-documents/templates-notice.ts",
    ]);
  });

  it("is the club's mail, like the staff invitation: its road, no wait, no copy, no cancel button", () => {
    expect(EMAIL_GROUP_OF.LEGAL_TEMPLATES_CHANGED).toBe("club");
    expect(EMAIL_GROUP_OF.LEGAL_TEMPLATES_CHANGED).toBe(EMAIL_GROUP_OF.STAFF_INVITATION);
    expect(isWaitedFor("LEGAL_TEMPLATES_CHANGED", false)).toBe(false);
    expect(isParticipantMessage("LEGAL_TEMPLATES_CHANGED")).toBe(false);
    expect(CANNOT_COME_MESSAGES.has("LEGAL_TEMPLATES_CHANGED")).toBe(false);
    // About no event and no registration: the greeting's name is the only field it fills.
    expect(placeholdersFilledBy("LEGAL_TEMPLATES_CHANGED")).toEqual(["participantName"]);
  });

  it("has its name and its «când» lines on /admin/emails, in both languages", () => {
    for (const catalogue of [ro, en]) {
      expect(catalogue.Admin.emails.types.LEGAL_TEMPLATES_CHANGED).toBeTruthy();
      expect(catalogue.Admin.emails.when.LEGAL_TEMPLATES_CHANGED).toBeTruthy();
      expect(catalogue.Admin.emails.whenShort.LEGAL_TEMPLATES_CHANGED).toBeTruthy();
      expect(catalogue.Admin.emails.whenMore.LEGAL_TEMPLATES_CHANGED).toBeTruthy();
    }
  });

  it("previews with the sample's two texts and no privacy line of a participant's", () => {
    const email = renderBilingual("LEGAL_TEMPLATES_CHANGED", "ro", emailSampleFor("LEGAL_TEMPLATES_CHANGED", "ro"), "https://example.test/ro/admin/legal/new", null);
    expect(email.text).toContain("Șablon nou: GDPR · Termeni de concurs");
    expect(email.text).toContain("New template: GDPR · Racing TOS");
    // The button names the screen it opens and what is done there (§654), not the generic «open the documents».
    expect(email.text).toContain("Versiune nouă: regenerează textele: https://example.test/ro/admin/legal/new");
    expect(email.text).toContain("New version: regenerate the texts");
    expect(email.text).not.toContain("aprobă textele:");
    expect(email.text).not.toContain("Deschide documentele legale");
    expect(email.text).not.toContain("Open the legal documents");
    expect(email.text).not.toContain("Nota de confidențialitate");
  });
});

describe("§639 the email quotes the backoffice's own words", () => {
  it("names each button as the screen says it, without its count", () => {
    expect(legalTemplatesWords("ro")).toEqual({
      documents: ro.Admin.nav.legal,
      newVersion: ro.Admin.legal.newVersion,
      regenerateAll: "Regenerează toate",
      approveDrafts: "Aprobă ciornele",
      draftExists: "O ciornă așteaptă deja",
      templateNew: ro.Admin.legal.kinds.templateNew,
      tasks: ro.Admin.nav.tasks,
    });
    expect(legalTemplatesWords("en").regenerateAll).toBe("Regenerate all");
    // Each is the start of a string the screen shows.
    for (const [locale, catalogue] of [["ro", ro], ["en", en]] as const) {
      const words = legalTemplatesWords(locale);
      expect(catalogue.Admin.legal.startFrom.regenerateAll.startsWith(words.regenerateAll)).toBe(true);
      expect(catalogue.Admin.legal.batch.approve.startsWith(words.approveDrafts)).toBe(true);
      expect(catalogue.Admin.legal.kinds.draftExists.startsWith(words.draftExists)).toBe(true);
    }
  });

  it("names the texts as /admin/legal lists them, in its order, dropping a key it does not know", () => {
    expect(legalTemplateNames("ro", ["TERMS", "PRIVACY_NOTICE", "NOT_A_TEXT"])).toEqual([ro.Admin.legal.keys.PRIVACY_NOTICE, ro.Admin.legal.keys.TERMS]);
    expect(legalTemplateNames("en", ["EVENT_DECLARATION_ROAD"])).toEqual([en.Admin.legal.keys.EVENT_DECLARATION_ROAD]);
  });
});

describe("§639 whom the email asks a lawyer to read", () => {
  it("names the declarations and the terms only when they moved, and the changed texts otherwise", () => {
    expect(lawyerReads("ro", ["PRIVACY_NOTICE"])).toBe("Înainte de aprobare, un jurist ar trebui să citească textele schimbate.");
    expect(lawyerReads("en", ["PRIVACY_NOTICE"])).toBe("Before approving, a lawyer should read the changed texts.");
    expect(lawyerReads("ro", ["TERMS"])).toBe("Înainte de aprobare, un jurist ar trebui să citească termenii.");
    expect(lawyerReads("ro", ["EVENT_DECLARATION_ROAD", "GROUP_RUN_DECLARATION_TRAIL"])).toBe("Înainte de aprobare, un jurist ar trebui să citească declarațiile.");
    expect(lawyerReads("en", ["TERMS", "EVENT_DECLARATION"])).toBe("Before approving, a lawyer should read the declarations and the terms.");
    expect(lawyerReads("ro", ["PRIVACY_NOTICE", "TERMS"])).toBe("Înainte de aprobare, un jurist ar trebui să citească textele schimbate, mai ales termenii.");
    expect(lawyerReads("en", ["PRIVACY_NOTICE", "EVENT_DECLARATION", "TERMS"])).toBe("Before approving, a lawyer should read the changed texts, above all the declarations and the terms.");
    // The volunteer agreement (§758) is named as itself, never as a declaration.
    expect(lawyerReads("ro", ["VOLUNTEER_AGREEMENT"])).toBe("Înainte de aprobare, un jurist ar trebui să citească contractul de voluntariat.");
    expect(lawyerReads("en", ["EVENT_DECLARATION", "TERMS", "VOLUNTEER_AGREEMENT"])).toBe("Before approving, a lawyer should read the declarations, the terms and the volunteer agreement.");
    expect(lawyerReads("ro", ["PRIVACY_NOTICE", "VOLUNTEER_AGREEMENT"])).toBe("Înainte de aprobare, un jurist ar trebui să citească textele schimbate, mai ales contractul de voluntariat.");
    // A key the catalogue does not know is ignored, as on the bold line; no section of any text is named.
    expect(lawyerReads("ro", ["NOT_A_TEXT"])).toBe("Înainte de aprobare, un jurist ar trebui să citească textele schimbate.");
    for (const locale of ["ro", "en"] as const) {
      expect(lawyerReads(locale, ["TERMS", "EVENT_DECLARATION", "PRIVACY_NOTICE"])).not.toMatch(/secțiunea|section/);
    }
  });
});
