import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { platformSettings } from "@/db/schema/platform-settings";
import { staffUsers } from "@/db/schema/staff-users";
import { type TranslateRequest, type Translator, TranslatorError } from "@/infrastructure/translate/adapter";
import { RATE_LIMITS } from "@/modules/rate-limit/service";
import { charactersTranslatedSince, charactersTranslatedToday, readTranslationBudget, startOfClubDay, updateTranslationBudget } from "@/modules/translate/budget";
import { translationCredit } from "@/modules/translate/domain/credit";
import { translateClubTexts } from "@/modules/translate/service";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §464 — «Tradu din română», through the service with a fake provider (no request leaves a test):
 * it fills (answers, never saves), refuses without a translator, refuses any box that is not the
 * club's own words — a legal text, a participant's field — writes one audit row per press with
 * the characters and never the words, holds the daily budget and the per-person throttle, and
 * turns the provider's refusals into words.
 */
const NOW = new Date("2026-09-26T10:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => resetTables(db));

type Role = "CONTRIBUTOR" | "COPYWRITER" | "MODERATOR" | "DEV" | "ADMIN" | "SUPERADMIN";
async function staff(role: Role) {
  const [row] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.ro`, displayName: role, role }).returning();
  return row;
}

/** A provider that says "EN:" before every text and records what it was sent. */
function fakeTranslator(fail?: TranslatorError) {
  const requests: TranslateRequest[] = [];
  const translator: Translator = {
    provider: "deepl",
    async translate(request) {
      requests.push(request);
      if (fail) throw fail;
      return request.texts.map((text) => `EN:${text}`);
    },
  };
  return { translator, requests };
}

const RICH = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Alergare de grup", marks: [{ type: "bold" }] }] },
    { type: "image", attrs: { src: "/api/media/local/0f8fad5b-d9cb-469f-a165-70867728950e/web.webp", alt: "Harta", caption: "" } },
  ],
};

describe("§464 «Tradu din română»", () => {
  it("answers each box translated — plain and rich — and saves nothing but one audit row", async () => {
    const copywriter = await staff("COPYWRITER");
    const { translator, requests } = fakeTranslator();
    const outcome = await translateClubTexts(
      db,
      copywriter,
      {
        items: [
          { field: "translations.en.title", kind: "text", text: "Tura de luni" },
          { field: "translations.en.body", kind: "rich", doc: RICH },
        ],
      },
      { translator, now: NOW },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.items[0]).toEqual({ field: "translations.en.title", kind: "text", text: "EN:Tura de luni" });
    const body = outcome.items[1];
    expect(body?.kind).toBe("rich");
    // The fake writes "EN:" before the line, outside the <b> it was sent: the mark stays on its words.
    expect(JSON.stringify(body)).toContain('{"type":"text","text":"EN:"},{"type":"text","text":"Alergare de grup","marks":[{"type":"bold"}]}');
    expect(JSON.stringify(body)).toContain('"alt":"EN:Harta"');
    expect(JSON.stringify(body)).toContain("0f8fad5b-d9cb-469f-a165-70867728950e/web.webp");

    // Romanian to English, with the club's glossary as context; the picture's address never sent.
    expect(requests.every((request) => request.from === "ro" && request.to === "en" && request.context?.includes("group run"))).toBe(true);
    expect(JSON.stringify(requests)).not.toContain("web.webp");

    // No setting and no text stored; one audit row with the boxes and the count, never the words.
    expect(await db.select().from(platformSettings)).toHaveLength(0);
    const audit = await db.select().from(auditLogs);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "content.translated", entityType: "content", actorStaffUserId: copywriter.id });
    expect(audit[0]?.metadataJson).toEqual({ fields: ["translations.en.title", "translations.en.body"], characters: outcome.characters, provider: "deepl", outcome: "ok" });
    expect(JSON.stringify(audit[0]?.metadataJson)).not.toContain("Tura de luni");
    expect(await charactersTranslatedToday(db, NOW)).toBe(outcome.characters);
  });

  it("refuses without a translator, and refuses the volunteer and Tehnic, sending nothing", async () => {
    const copywriter = await staff("COPYWRITER");
    const input = { items: [{ field: "translations.en.title", kind: "text", text: "Tura" }] };
    expect(await translateClubTexts(db, copywriter, input, { translator: null, now: NOW })).toEqual({ ok: false, reason: "notConfigured" });
    for (const role of ["CONTRIBUTOR", "DEV"] as const) {
      const { translator, requests } = fakeTranslator();
      expect(await translateClubTexts(db, await staff(role), input, { translator, now: NOW })).toEqual({ ok: false, reason: "forbidden" });
      expect(requests).toHaveLength(0);
    }
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });

  it("refuses the whole press when any box is not the club's content: a legal text, a participant's field, a slug", async () => {
    const admin = await staff("ADMIN");
    for (const field of ["legal.bodyEn", "bodyJson", "email", "healthNote", "translations.en.slug", "translations.ro.title"]) {
      const { translator, requests } = fakeTranslator();
      const outcome = await translateClubTexts(
        db,
        admin,
        { items: [{ field: "translations.en.title", kind: "text", text: "Tura" }, { field, kind: "text", text: "x" }] },
        { translator, now: NOW },
      );
      expect(outcome, field).toEqual({ ok: false, reason: "invalid" });
      expect(requests).toHaveLength(0);
    }
    // A rich text posted as plain words, or a document the allowlist refuses, is refused too.
    const { translator } = fakeTranslator();
    expect(await translateClubTexts(db, admin, { items: [{ field: "translations.en.body", kind: "text", text: "x" }] }, { translator, now: NOW })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(
      await translateClubTexts(db, admin, { items: [{ field: "translations.en.body", kind: "rich", doc: { type: "doc", content: [{ type: "script" }] } }] }, { translator, now: NOW }),
    ).toEqual({ ok: false, reason: "invalid" });
  });

  it("says there is nothing to translate when the Romanian boxes are empty", async () => {
    const { translator, requests } = fakeTranslator();
    const outcome = await translateClubTexts(db, await staff("MODERATOR"), { items: [{ field: "notice.noteEn", kind: "text", text: "  " }] }, { translator, now: NOW });
    expect(outcome).toEqual({ ok: false, reason: "nothing" });
    expect(requests).toHaveLength(0);
  });

  it("holds the club's daily budget, counted from the audit rows since the club's midnight", async () => {
    const admin = await staff("ADMIN");
    await updateTranslationBudget(db, admin, { dailyCharacters: "20" }, NOW);
    expect((await readTranslationBudget(db)).budget).toEqual({ dailyCharacters: 20 });
    const { translator } = fakeTranslator();
    const press = (text: string) => translateClubTexts(db, admin, { items: [{ field: "translations.en.title", kind: "text", text }] }, { translator, now: NOW });

    expect(await press("0123456789012")).toMatchObject({ ok: true, characters: 13, remainingToday: 7 });
    expect(await press("01234567")).toEqual({ ok: false, reason: "budget", remainingToday: 7 });
    expect(await press("0123456")).toMatchObject({ ok: true, remainingToday: 0 });
    // Yesterday's spend does not count today.
    const tomorrow = new Date(startOfClubDay(NOW).getTime() + 25 * 60 * 60_000);
    expect(await charactersTranslatedToday(db, tomorrow)).toBe(0);
    // The month's line on Costuri (§479) sums the same rows since the month's start — yesterday's included.
    expect(await charactersTranslatedSince(db, new Date("2026-09-01T00:00:00.000Z"))).toBe(20);
    expect(await charactersTranslatedSince(db, tomorrow)).toBe(0);
  });

  it("stops a person after the hour's presses, whatever the budget", async () => {
    const copywriter = await staff("COPYWRITER");
    const { translator } = fakeTranslator();
    const input = { items: [{ field: "translations.en.title", kind: "text", text: "a" }] };
    for (let press = 0; press < RATE_LIMITS["content-translate"].limit; press += 1) {
      expect((await translateClubTexts(db, copywriter, input, { translator, now: NOW })).ok).toBe(true);
    }
    expect(await translateClubTexts(db, copywriter, input, { translator, now: NOW })).toEqual({ ok: false, reason: "rateLimited" });
  });

  it("words the provider's refusals and audits nothing for them", async () => {
    const admin = await staff("ADMIN");
    for (const failure of ["quota", "refused", "unavailable"] as const) {
      const { translator } = fakeTranslator(new TranslatorError(failure, "fake"));
      expect(
        await translateClubTexts(db, admin, { items: [{ field: "cancel.reasonEn", kind: "text", text: "Ploaie" }] }, { translator, now: NOW }),
      ).toEqual({ ok: false, reason: failure });
    }
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "content.translated"))).toHaveLength(0);
  });

  it("§497: a spent DeepL credit refuses as `quota`, a too-small one as `credit` with what is left — nothing sent, nothing metered", async () => {
    const admin = await staff("ADMIN");
    const input = { items: [{ field: "translations.en.title", kind: "text", text: "Alergare" }] };
    const withCredit = (used: number, limit: number) => async () => translationCredit({ used, limit });

    const spent = fakeTranslator();
    expect(await translateClubTexts(db, admin, input, { translator: spent.translator, now: NOW, credit: withCredit(1_000_000, 1_000_000) })).toEqual({
      ok: false,
      reason: "quota",
    });
    expect(spent.requests).toHaveLength(0);

    const small = fakeTranslator();
    expect(await translateClubTexts(db, admin, input, { translator: small.translator, now: NOW, credit: withCredit(999_995, 1_000_000) })).toEqual({
      ok: false,
      reason: "credit",
      remainingCredit: 5,
    });
    expect(small.requests).toHaveLength(0);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "content.translated"))).toHaveLength(0);

    // Enough left, or a credit nobody could read: the press goes to DeepL as before.
    for (const credit of [withCredit(999_992, 1_000_000), async () => null]) {
      expect((await translateClubTexts(db, admin, input, { translator: fakeTranslator().translator, now: NOW, credit })).ok).toBe(true);
    }
  });

  it("meters what the provider billed when its second request fails — the plain words sent, the press refused", async () => {
    const admin = await staff("ADMIN");
    let calls = 0;
    const translator: Translator = {
      provider: "deepl",
      async translate(request) {
        calls += 1;
        if (calls > 1) throw new TranslatorError("unavailable", "fake");
        return request.texts.map((text) => `EN:${text}`);
      },
    };
    const outcome = await translateClubTexts(
      db,
      admin,
      {
        items: [
          { field: "translations.en.title", kind: "text", text: "Tura de luni" },
          { field: "translations.en.body", kind: "rich", doc: RICH },
        ],
      },
      { translator, now: NOW },
    );
    expect(outcome).toEqual({ ok: false, reason: "unavailable" });
    // The first request carried the plain words, the title and the picture's alt text; the
    // paragraph's HTML was the second, refused one.
    const billed = "Tura de luni".length + "Harta".length;
    const [row] = await db.select().from(auditLogs).where(eq(auditLogs.action, "content.translated"));
    expect(row?.metadataJson).toMatchObject({ characters: billed, outcome: "unavailable" });
    expect(await charactersTranslatedToday(db, NOW)).toBe(billed);
  });

  it("gives the participant message's {placeholders} back byte for byte, whatever the provider did to its markers", async () => {
    const moderator = await staff("MODERATOR");
    const sent: string[] = [];
    const translator: Translator = {
      provider: "deepl",
      // A provider that spaces the braces and translates every word it can see.
      async translate(request) {
        sent.push(...request.texts);
        return request.texts.map((text) => text.replace(/\{(\d+)\}/g, "{ $1 }").replace("Salut", "Hello").replace("la", "at"));
      },
    };
    const outcome = await translateClubTexts(
      db,
      moderator,
      { items: [{ field: "bodyEn", kind: "text", text: "Salut {participantName}, ne vedem la {eventTitle} ({eventDateFormatted})." }] },
      { translator, now: NOW },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.items[0]).toEqual({ field: "bodyEn", kind: "text", text: "Hello {participantName}, ne vedem at {eventTitle} ({eventDateFormatted})." });
    // The names themselves never reached the provider.
    expect(sent.join(" ")).not.toContain("participantName");
  });

  it("lets only the Administrator change the budget, audited from and to", async () => {
    const copywriter = await staff("COPYWRITER");
    const refused = await updateTranslationBudget(db, copywriter, { dailyCharacters: "10" }, NOW).catch((error: unknown) => error);
    expect(isDomainError(refused) && refused.code).toBe("FORBIDDEN");
    const admin = await staff("ADMIN");
    await updateTranslationBudget(db, admin, { dailyCharacters: "30000" }, NOW);
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "translationBudget.changed"));
    expect(audit?.metadataJson).toEqual({ from: 50_000, to: 30_000 });
  });
});
