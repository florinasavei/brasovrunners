import { and, eq } from "drizzle-orm";
import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { eventRsvps, eventRsvpTokens } from "@/db/schema/event-rsvps";
import { eventTranslations, events } from "@/db/schema/events";
import { staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { findFirstRsvpMemberNoticeVersion, findFirstRsvpNoticeVersion, insertLegalDocumentVersion, noticeDescribesRsvpMember } from "@/modules/legal-documents/repository";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { viewPersonData } from "@/modules/registrations/person-data";
import { rememberPerson } from "@/modules/person-session/session";
import { answeredByAccount } from "@/modules/rsvp/counts";
import { accountIdentity } from "@/modules/rsvp/domain/account-identity";
import { identityOf } from "@/modules/rsvp/domain/identity";
import { answerRsvp, confirmRsvp, countRsvpsForAdmin, listRsvpsForAdmin, mintRsvpLinks, readOwnRsvpName, readPublicRsvps, setRsvpClubMember } from "@/modules/rsvp/rsvp";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  jar: new Map<string, string>(),
  redirected: [] as string[],
  language: "ro" as "ro" | "en",
}));
const revalidated = vi.hoisted(() => [] as string[][]);
const messages = { ro, en };

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: (url: string) => {
    state.redirected.push(url);
    throw new Error("NEXT_REDIRECT");
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (state.jar.has(name) ? { name, value: state.jar.get(name)! } : undefined),
    set: (name: string, value: string) => void state.jar.set(name, value),
    delete: (name: string) => void state.jar.delete(name),
  }),
  headers: async () => new Headers(),
}));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  return {
    getTranslations: async (namespace: string | { namespace: string }) =>
      createTranslator({ locale: state.language, messages: messages[state.language] as never, namespace: (typeof namespace === "string" ? namespace : namespace.namespace) as never }),
    getLocale: async () => state.language,
    setRequestLocale: () => {},
  };
});
vi.mock("@/i18n/navigation", async (importOriginal) => {
  const { createElement: h } = await import("react");
  const actual = await importOriginal<typeof import("@/i18n/navigation")>();
  return {
    ...actual,
    Link: ({ href, children }: { href: unknown; children: unknown }) => h("a", { href: actual.getPathname({ locale: state.language, href: href as never }) }, children as string),
  };
});
vi.mock("@/modules/public-cache/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/public-cache/cache")>()),
  revalidatePublicContent: (...contents: string[]) => {
    revalidated.push(contents);
  },
}));

const { default: RsvpLinkPage } = await import("@/app/[locale]/vin/[token]/page");
const { confirmRsvpAction, setNameByLinkAction } = await import("@/app/[locale]/vin/[token]/actions");
const { rsvpGoAction, rsvpMemberAction, rsvpStateAction } = await import("@/modules/rsvp/remembered-actions");

const NOW = new Date();
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

/**
 * §829 (BR-REQ-039-01, BR-REQ-060-01, BR-REQ-036-02; amends §812 and §796) — the member mark on «Cine vine»: the service and the doors that are not the zone.
 * A declared tick is `DECLARED` and is kept only while the notice in force describes the mark; an account's answer is `ACCOUNT` from its role alone; the
 * public read marks a member only beside a name that may be shown, counts every confirmed member answer, and reads the §421 line (the version a tick was
 * last given under). The member tick flips like the name's — a remembered browser or a live «Nu mai vin» link, never spent. Real database (PGlite).
 * The zone's door is `member-mark-zone.test.ts`; the pages, `member-page.test.ts`; the journey, `tests/e2e/rsvp.spec.ts`.
 */
describe("§829 the member mark on «Vin!»", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let eventId: string;
  let slug: string;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    state.db = db;
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    state.jar.clear();
    state.redirected.length = 0;
    state.language = "ro";
    revalidated.length = 0;
    await approveNotice(1, "full");
    const [event] = await db
      .insert(events)
      .values({ type: "GROUP_RUN", startsAt: new Date(NOW.getTime() + 2 * DAY), registrationMode: "NONE", rsvpEnabled: true, editorialStatus: "PUBLISHED", publishedAt: new Date(NOW.getTime() - DAY) })
      .returning();
    eventId = event.id;
    slug = `alergare-${event.id.slice(0, 8)}`;
    await db.insert(eventTranslations).values([
      { eventId, locale: "ro", slug, title: "Alergarea de joi" },
      { eventId, locale: "en", slug: `run-${event.id.slice(0, 8)}`, title: "Thursday run" },
    ]);
  });

  /**
   * One privacy notice version: «full» is the template (it names `{{rsvp}}` and `{{rsvpMember}}`), «rsvp» the same words without the member marker — a notice
   * approved before this existed — and «none» says nothing about answers.
   */
  async function approveNotice(version: number, kind: "full" | "rsvp" | "none", effectiveAt = new Date(NOW.getTime() - (version === 1 ? 400 * DAY : HOUR))) {
    const strip = (body: unknown) => JSON.parse(JSON.stringify(body).replaceAll("{{rsvpMember}}", ""));
    const translations: LegalDocumentTranslationInput[] =
      kind === "none"
        ? [
            { locale: "ro", title: "Confidențialitate", body: { sections: [{ heading: "1", paragraphs: ["Nimic despre răspunsuri."] }] } },
            { locale: "en", title: "Privacy", body: { sections: [{ heading: "1", paragraphs: ["Nothing about answers."] }] } },
          ]
        : [
            { locale: "ro", title: "Confidențialitate", body: kind === "full" ? privacyNoticeRo : strip(privacyNoticeRo) },
            { locale: "en", title: "Privacy", body: kind === "full" ? privacyNoticeEn : strip(privacyNoticeEn) },
          ];
    await insertLegalDocumentVersion(db, { key: "PRIVACY_NOTICE", version, effectiveAt, isApproved: true, contentSha256: computeContentHash(translations), translations, now: NOW });
  }

  const remembered = (email: string, extra: Partial<Parameters<typeof identityOf>[1]> = {}) => identityOf("remembered", { email, displayName: null, showName: false, locale: "ro", ...extra });
  const rows = () => db.select().from(eventRsvps);
  const rowOf = async (canonical = "ana@example.test") => (await db.select().from(eventRsvps).where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.canonicalEmail, canonical))))[0];
  const publicRead = async () =>
    readPublicRsvps(db, eventId, { firstRsvpNoticeVersion: await findFirstRsvpNoticeVersion(db), firstMemberNoticeVersion: await findFirstRsvpMemberNoticeVersion(db) });
  const jar = () => ({ get: (name: string) => (state.jar.has(name) ? { value: state.jar.get(name)! } : undefined), set: (name: string, value: string) => void state.jar.set(name, value), delete: (name: string) => void state.jar.delete(name) });
  const rejects = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return isDomainError(error) ? error.code : (error as Error).message;
    }
    return "resolved";
  };

  describe("migration 0175", () => {
    it("adds a nullable column that says nothing by default and refuses any kind but the two", async () => {
      await answerRsvp(db, eventId, remembered("ana@example.test"), NOW);
      expect((await rowOf()).clubMember).toBeNull();
      const [row] = await rows();
      await expect(db.update(eventRsvps).set({ clubMember: "VERIFIED" }).where(eq(eventRsvps.id, row.id))).rejects.toThrow(/event_rsvps_club_member_known|club_member/);
      for (const kind of ["DECLARED", "ACCOUNT"]) {
        await db.update(eventRsvps).set({ clubMember: kind }).where(eq(eventRsvps.id, row.id));
        expect((await rowOf()).clubMember).toBe(kind);
      }
      await db.update(eventRsvps).set({ clubMember: null }).where(eq(eventRsvps.id, row.id));
      expect((await rowOf()).clubMember).toBeNull();
    });
  });

  describe("the doors store the right kind, under a notice that describes the mark", () => {
    it("the page's typed form: the tick waits, stored as DECLARED on the unconfirmed row, and counts once «Da, vin» is pressed", async () => {
      await answerRsvp(db, eventId, identityOf("page", { email: "ana@example.test", displayName: "Ana", showName: true, locale: "ro", clubMember: true }), NOW);
      expect(await rowOf()).toMatchObject({ clubMember: "DECLARED", confirmedAt: null, privacyNoticeVersion: 1 });
      // Not an answer yet: not counted, not named, not a member.
      expect(await publicRead()).toEqual({ count: 0, names: [], others: 0 });
      const [row] = await rows();
      const links = (await mintRsvpLinks(db, { rsvpId: row.id, startsAt: new Date(NOW.getTime() + 2 * DAY), confirm: true, now: NOW }))!;
      expect(await confirmRsvp(db, links.confirm!, NOW)).not.toBeNull();
      expect(await publicRead()).toEqual({ count: 1, names: ["Ana"], others: 0, members: 1, memberMarks: [true] });
    });

    it("the page's typed form without the tick stores nothing, and a later typing by a stranger cannot lend the tick to a counted answer", async () => {
      await answerRsvp(db, eventId, identityOf("page", { email: "ana@example.test", displayName: "Ana", showName: true, locale: "ro" }), NOW);
      expect((await rowOf()).clubMember).toBeNull();
      await db.update(eventRsvps).set({ confirmedAt: NOW });
      // Counted now: whoever types the address cannot change what it says (§812), the tick included.
      await answerRsvp(db, eventId, identityOf("page", { email: "ana@example.test", displayName: "Altcineva", showName: true, locale: "ro", clubMember: true }), new Date(NOW.getTime() + HOUR));
      expect(await rowOf()).toMatchObject({ clubMember: null, displayName: "Ana" });
    });

    it("the remembered browser: DECLARED from the press, and the island is told the state without the address", async () => {
      await rememberPerson(db, jar(), { email: "ana@example.test", displayName: "Ana" }, NOW);
      const state1 = await rsvpGoAction(slug, "ro", true, true);
      expect(await rowOf()).toMatchObject({ clubMember: "DECLARED", showName: true });
      expect(state1).toEqual({ remembered: true, offered: true, going: true, showName: true, name: "Ana", clubMember: "DECLARED", count: 1 });
      expect(JSON.stringify(state1)).not.toContain("example.test");
      expect(await publicRead()).toEqual({ count: 1, names: ["Ana"], others: 0, members: 1, memberMarks: [true] });
    });

    it("the link: the email's «Vin» takes the tick with the name — only for the row the email made, still unconfirmed and nameless", async () => {
      const [asked] = await db
        .insert(eventRsvps)
        .values({ eventId, deliveryEmail: "ana@example.test", canonicalEmail: "ana@example.test", canonicalizationVersion: 1, locale: "ro", privacyNoticeVersion: 1, askedAt: NOW, askedBasis: "SUBSCRIBER" })
        .returning();
      const links = (await mintRsvpLinks(db, { rsvpId: asked.id, startsAt: new Date(NOW.getTime() + 2 * DAY), confirm: true, confirmUntilStart: true, now: NOW }))!;
      const proved = await confirmRsvp(db, links.confirm!, NOW, { displayName: "Ana", showName: true, clubMember: true });
      expect(proved).not.toBeNull();
      expect(await rowOf()).toMatchObject({ clubMember: "DECLARED", displayName: "Ana", showName: true, privacyNoticeVersion: 1 });
      expect(await publicRead()).toMatchObject({ names: ["Ana"], members: 1, memberMarks: [true] });
    });

    it("the link: a row typed on the page is never ticked by the page of its link, and a counted row is not touched by a second press", async () => {
      await answerRsvp(db, eventId, identityOf("page", { email: "ana@example.test", displayName: "Ana", showName: false, locale: "ro" }), NOW);
      const [row] = await rows();
      const links = (await mintRsvpLinks(db, { rsvpId: row.id, startsAt: new Date(NOW.getTime() + 2 * DAY), confirm: true, now: NOW }))!;
      await confirmRsvp(db, links.confirm!, NOW, { clubMember: true });
      // A typed row has no `asked_at`: whoever pressed «Da, vin» gives no tick through it.
      expect((await rowOf()).clubMember).toBeNull();
    });

    it("the link's action reads the tick from the form, beside the name's, and never an address or a kind", async () => {
      const [asked] = await db
        .insert(eventRsvps)
        .values({ eventId, deliveryEmail: "dan@example.test", canonicalEmail: "dan@example.test", canonicalizationVersion: 1, locale: "ro", privacyNoticeVersion: 1, askedAt: NOW, askedBasis: "SUBSCRIBER" })
        .returning();
      const links = (await mintRsvpLinks(db, { rsvpId: asked.id, startsAt: new Date(NOW.getTime() + 2 * DAY), confirm: true, confirmUntilStart: true, now: NOW }))!;
      const form = new FormData();
      for (const [name, value] of Object.entries({ locale: "ro", token: links.confirm!, name: "Dan", showName: "on", clubMember: "on", kind: "ACCOUNT", club_member: "ACCOUNT" })) form.set(name, value);
      await confirmRsvpAction(form).catch((error: unknown) => {
        if (!(error instanceof Error) || error.message !== "NEXT_REDIRECT") throw error;
      });
      expect(await rowOf("dan@example.test")).toMatchObject({ clubMember: "DECLARED", displayName: "Dan" });
    });

    it("an account: ACCOUNT from the role, for every role, whatever a tick said — and nothing for an account read without one", async () => {
      for (const [index, role] of (["MEMBER", "CONTRIBUTOR", "MODERATOR", "ADMIN", "SUPERADMIN"] as const).entries()) {
        const email = `cont${index}@example.test`;
        await answerRsvp(db, eventId, accountIdentity({ email, displayName: "Cont", role }, "ro", false), NOW);
        expect((await rowOf(email)).clubMember, role).toBe("ACCOUNT");
      }
      await answerRsvp(db, eventId, accountIdentity({ email: "fara.rol@example.test", displayName: "Fără rol" }, "ro", true), NOW);
      expect((await rowOf("fara.rol@example.test")).clubMember).toBeNull();
    });

    it("an identity that claims more than its source proves is refused: a tick on an account, a role on a typed form", async () => {
      const account = { ...accountIdentity({ email: "ana@example.test", displayName: "Ana", role: "MEMBER" }, "ro", false), clubMember: true };
      expect(await rejects(answerRsvp(db, eventId, account, NOW))).toBe("VALIDATION_ERROR");
      expect(await rejects(answerRsvp(db, eventId, { ...identityOf("page", { email: "ana@example.test", showName: false, locale: "ro" }), role: "ADMIN" }, NOW))).toBe("VALIDATION_ERROR");
      expect(await rows()).toHaveLength(0);
    });

    it("a counted answer keeps the stronger kind: an account's press upgrades a tick, and a tick never lowers an account's", async () => {
      await answerRsvp(db, eventId, remembered("ana@example.test", { displayName: "Ana", clubMember: true }), NOW);
      expect((await rowOf()).clubMember).toBe("DECLARED");
      await answerRsvp(db, eventId, accountIdentity({ email: "ana@example.test", displayName: "Ana", role: "COPYWRITER" }, "ro", false), NOW);
      expect((await rowOf()).clubMember).toBe("ACCOUNT");
      await answerRsvp(db, eventId, remembered("ana@example.test", { clubMember: true }), NOW);
      expect((await rowOf()).clubMember).toBe("ACCOUNT");
      await answerRsvp(db, eventId, remembered("ana@example.test"), NOW);
      expect((await rowOf()).clubMember).toBe("ACCOUNT");
    });
  });

  describe("nothing is kept while the notice in force does not describe the mark", () => {
    beforeEach(async () => {
      // The notice every answer so far was given under says «Vin!» and nothing about a mark.
      await resetTables(db);
      const [event] = await db
        .insert(events)
        .values({ type: "GROUP_RUN", startsAt: new Date(NOW.getTime() + 2 * DAY), registrationMode: "NONE", rsvpEnabled: true, editorialStatus: "PUBLISHED", publishedAt: new Date(NOW.getTime() - DAY) })
        .returning();
      eventId = event.id;
      slug = `alergare-${event.id.slice(0, 8)}`;
      await db.insert(eventTranslations).values([
        { eventId, locale: "ro", slug, title: "Alergarea de joi" },
        { eventId, locale: "en", slug: `run-${event.id.slice(0, 8)}`, title: "Thursday run" },
      ]);
      await approveNotice(1, "rsvp");
    });

    it("says so from the notice: «Vin!» described, the mark not", async () => {
      expect(await noticeDescribesRsvpMember(db, NOW)).toBe(false);
      expect(await findFirstRsvpMemberNoticeVersion(db)).toBeNull();
      expect(await findFirstRsvpNoticeVersion(db)).toBe(1);
    });

    it("drops a posted tick on every door and an account's mark, so the data is never collected without the sentence that says so", async () => {
      await answerRsvp(db, eventId, remembered("ana@example.test", { displayName: "Ana", showName: true, clubMember: true }), NOW);
      await answerRsvp(db, eventId, identityOf("page", { email: "dan@example.test", displayName: "Dan", showName: true, locale: "ro", clubMember: true }), NOW);
      await answerRsvp(db, eventId, accountIdentity({ email: "cont@example.test", displayName: "Cont", role: "ADMIN" }, "ro", false), NOW);
      for (const row of await rows()) expect(row.clubMember, row.canonicalEmail).toBeNull();
      expect(await publicRead()).toEqual({ count: 2, names: ["Ana"], others: 1 });
    });

    it("refuses the tick on a counted answer as «closed», and the person may always take one back", async () => {
      await answerRsvp(db, eventId, remembered("ana@example.test", { displayName: "Ana" }), NOW);
      expect(await setRsvpClubMember(db, eventId, { identity: remembered("ana@example.test") }, { clubMember: true }, NOW)).toEqual({ ok: false, reason: "closed" });
      expect((await rowOf()).clubMember).toBeNull();
      await db.update(eventRsvps).set({ clubMember: "DECLARED" });
      expect(await setRsvpClubMember(db, eventId, { identity: remembered("ana@example.test") }, { clubMember: false }, NOW)).toEqual({ ok: true, clubMember: false });
      expect((await rowOf()).clubMember).toBeNull();
    });
  });

  describe("what the public read shows — the mark is the name's, the count is everyone's", () => {
    it("marks a member only beside a name that may be shown; an unnamed member only adds to the count, never to «și încă N»", async () => {
      // One moment apart, so «oldest first» is the order they were given in.
      const at = (n: number) => new Date(NOW.getTime() + n);
      await answerRsvp(db, eventId, remembered("ana@example.test", { displayName: "Ana", showName: true, clubMember: true }), at(1));
      await answerRsvp(db, eventId, remembered("bia@example.test", { displayName: "Bia", showName: true }), at(2));
      await answerRsvp(db, eventId, remembered("dan@example.test", { displayName: "Dan", showName: false, clubMember: true }), at(3));
      await answerRsvp(db, eventId, remembered("eva@example.test", { clubMember: true }), at(4));
      await answerRsvp(db, eventId, accountIdentity({ email: "cont@example.test", displayName: "Cont Admin", role: "ADMIN" }, "ro", true), at(5));
      const read = await publicRead();
      // Oldest first: Ana (member), Bia (not), then the account named by its own tick (a member), and two members only counted.
      expect(read.names).toEqual(["Ana", "Bia", "Cont Admin"]);
      expect(read.memberMarks).toEqual([true, false, true]);
      expect(read.members).toBe(4);
      expect(read.count).toBe(5);
      expect(read.others).toBe(2);
      // Nothing of the two unnamed members is in what the page is handed: no name, no mark, no kind.
      expect(JSON.stringify(read)).not.toMatch(/Dan|Eva|DECLARED|ACCOUNT|example\.test/);
      // The two unnamed members are only «și încă 2»: the rows after the shown names carry no mark of their own.
      expect(read.memberMarks).toHaveLength(read.names.length);
    });

    it("says nothing about members when none is — the shape of an answer with no mark is exactly what it was", async () => {
      await answerRsvp(db, eventId, remembered("ana@example.test", { displayName: "Ana", showName: true }), NOW);
      expect(await publicRead()).toEqual({ count: 1, names: ["Ana"], others: 0 });
    });

    it("never marks or counts an answer that is not counted yet, or one taken back", async () => {
      await answerRsvp(db, eventId, identityOf("page", { email: "ana@example.test", displayName: "Ana", showName: true, locale: "ro", clubMember: true }), NOW);
      expect(await publicRead()).toEqual({ count: 0, names: [], others: 0 });
      await answerRsvp(db, eventId, remembered("bia@example.test", { displayName: "Bia", showName: true, clubMember: true }), NOW);
      await db.delete(eventRsvps).where(eq(eventRsvps.canonicalEmail, "bia@example.test"));
      expect(await publicRead()).toEqual({ count: 0, names: [], others: 0 });
    });

    it("reads the §421 line: an answer given under a notice that did not describe the mark is not marked or counted, one given — or ticked — under it is", async () => {
      // v1 (the template) is already in force from the setup; make it the old notice by replacing the world: v1 says «Vin!» only, v2 adds the mark.
      await resetTables(db);
      const [event] = await db
        .insert(events)
        .values({ type: "GROUP_RUN", startsAt: new Date(NOW.getTime() + 2 * DAY), registrationMode: "NONE", rsvpEnabled: true, editorialStatus: "PUBLISHED", publishedAt: new Date(NOW.getTime() - DAY) })
        .returning();
      eventId = event.id;
      await db.insert(eventTranslations).values([
        { eventId, locale: "ro", slug: "a-1", title: "Alergarea de joi" },
        { eventId, locale: "en", slug: "a-1-en", title: "Thursday run" },
      ]);
      await approveNotice(1, "rsvp");
      await answerRsvp(db, eventId, remembered("ana@example.test", { displayName: "Ana", showName: true }), NOW);
      await approveNotice(2, "full", new Date(NOW.getTime() - HOUR));
      expect(await findFirstRsvpMemberNoticeVersion(db)).toBe(2);
      // Ana was told nothing of a mark when she answered. Even a row that holds a kind (a stale write) is not shown under v1.
      await db.update(eventRsvps).set({ clubMember: "DECLARED" });
      expect(await publicRead()).toEqual({ count: 1, names: ["Ana"], others: 0 });
      // Bia answers under v2 with the tick: marked and counted.
      await answerRsvp(db, eventId, remembered("bia@example.test", { displayName: "Bia", showName: true, clubMember: true }), new Date(NOW.getTime() + 1));
      expect(await publicRead()).toMatchObject({ names: ["Ana", "Bia"], memberMarks: [false, true], members: 1 });
      // Ana ticks it now, under v2: the version on her row moves with the tick, and she is counted from then on.
      expect(await setRsvpClubMember(db, eventId, { identity: remembered("ana@example.test") }, { clubMember: true }, NOW)).toEqual({ ok: true, clubMember: true });
      expect(await rowOf()).toMatchObject({ clubMember: "DECLARED", privacyNoticeVersion: 2 });
      expect(await publicRead()).toMatchObject({ names: ["Ana", "Bia"], memberMarks: [true, true], members: 2 });
    });
  });

  describe("the tick flips like the name's: a remembered browser or a live «Nu mai vin» link", () => {
    const who = (email: string) => ({ identity: remembered(email) });
    const counted = (email = "ana@example.test", displayName: string | null = "Ana") => answerRsvp(db, eventId, remembered(email, { displayName }), NOW);

    it("turns ON for a counted answer, records the notice in force, and tells the public cache once, only when something changed", async () => {
      await counted();
      await approveNotice(2, "full", new Date(NOW.getTime() - HOUR));
      revalidated.length = 0;
      expect(await setRsvpClubMember(db, eventId, who("ana@example.test"), { clubMember: true }, NOW)).toEqual({ ok: true, clubMember: true });
      expect(await rowOf()).toMatchObject({ clubMember: "DECLARED", privacyNoticeVersion: 2 });
      expect(revalidated).toEqual([["places"]]);
      // Again: nothing changes, nothing is expired.
      expect(await setRsvpClubMember(db, eventId, who("ana@example.test"), { clubMember: true }, NOW)).toEqual({ ok: true, clubMember: true });
      expect(revalidated).toHaveLength(1);
    });

    it("turns OFF and keeps everything else; an untick needs no open event and no notice", async () => {
      await counted();
      await setRsvpClubMember(db, eventId, who("ana@example.test"), { clubMember: true }, NOW);
      await db.update(events).set({ rsvpEnabled: false }).where(eq(events.id, eventId));
      revalidated.length = 0;
      expect(await setRsvpClubMember(db, eventId, who("ana@example.test"), { clubMember: false }, NOW)).toEqual({ ok: true, clubMember: false });
      expect(await rowOf()).toMatchObject({ clubMember: null, displayName: "Ana" });
      expect(revalidated).toEqual([["places"]]);
      expect(await setRsvpClubMember(db, eventId, who("ana@example.test"), { clubMember: false }, NOW)).toEqual({ ok: true, clubMember: false });
      expect(revalidated).toHaveLength(1);
      // …and ticking is refused once the event takes no answers.
      expect(await setRsvpClubMember(db, eventId, who("ana@example.test"), { clubMember: true }, NOW)).toEqual({ ok: false, reason: "closed" });
    });

    it("says «none» for no counted answer — unconfirmed, taken back, or another person's — and writes nothing", async () => {
      expect(await setRsvpClubMember(db, eventId, who("ana@example.test"), { clubMember: true }, NOW)).toEqual({ ok: false, reason: "none" });
      await answerRsvp(db, eventId, identityOf("page", { email: "ana@example.test", showName: false, locale: "ro" }), NOW);
      expect(await setRsvpClubMember(db, eventId, who("ana@example.test"), { clubMember: true }, NOW)).toEqual({ ok: false, reason: "none" });
      await counted("dan@example.test", "Dan");
      expect(await setRsvpClubMember(db, eventId, who("ana@example.test"), { clubMember: true }, NOW)).toEqual({ ok: false, reason: "none" });
      expect((await rowOf("dan@example.test")).clubMember).toBeNull();
    });

    it("leaves an account's mark alone — it is the role's, not a tick — and refuses an account identity and an unverified one", async () => {
      await answerRsvp(db, eventId, accountIdentity({ email: "ana@example.test", displayName: "Ana", role: "MEMBER" }, "ro", false), NOW);
      expect(await setRsvpClubMember(db, eventId, who("ana@example.test"), { clubMember: false }, NOW)).toEqual({ ok: true, clubMember: true });
      expect((await rowOf()).clubMember).toBe("ACCOUNT");
      expect(await setRsvpClubMember(db, eventId, who("ana@example.test"), { clubMember: true }, NOW)).toEqual({ ok: true, clubMember: true });
      expect((await rowOf()).clubMember).toBe("ACCOUNT");
      expect(await rejects(setRsvpClubMember(db, eventId, { identity: accountIdentity({ email: "ana@example.test", displayName: "Ana", role: "MEMBER" }, "ro", false) }, { clubMember: true }, NOW))).toBe("FORBIDDEN");
      expect(await rejects(setRsvpClubMember(db, eventId, { identity: identityOf("page", { email: "ana@example.test", showName: false, locale: "ro" }) }, { clubMember: true }, NOW))).toBe("FORBIDDEN");
    });

    it("reads a live «Nu mai vin» link and does NOT spend it; a link of another event, or a confirm link, changes nothing", async () => {
      await counted();
      const [row] = await rows();
      const startsAt = new Date(NOW.getTime() + 2 * DAY);
      const links = (await mintRsvpLinks(db, { rsvpId: row.id, startsAt, confirm: true, now: NOW }))!;
      expect(await setRsvpClubMember(db, eventId, { token: links.withdraw }, { clubMember: true }, NOW)).toEqual({ ok: true, clubMember: true });
      expect((await rowOf()).clubMember).toBe("DECLARED");
      expect((await db.select().from(eventRsvpTokens).where(eq(eventRsvpTokens.purpose, "RSVP_WITHDRAW")))[0].usedAt).toBeNull();
      expect(await setRsvpClubMember(db, eventId, { token: links.withdraw }, { clubMember: false }, NOW)).toEqual({ ok: true, clubMember: false });
      // A confirm link proves another thing, a malformed one nothing, and the wrong event's none.
      expect(await setRsvpClubMember(db, eventId, { token: links.confirm! }, { clubMember: true }, NOW)).toEqual({ ok: false, reason: "none" });
      expect(await setRsvpClubMember(db, eventId, { token: "x" }, { clubMember: true }, NOW)).toEqual({ ok: false, reason: "none" });
      expect(await setRsvpClubMember(db, "11111111-1111-4111-8111-111111111111", { token: links.withdraw }, { clubMember: true }, NOW)).toEqual({ ok: false, reason: "none" });
      expect((await rowOf()).clubMember).toBeNull();
    });

    it("tells the remembered island the state, flips it from the action, and says why when nothing was written", async () => {
      await rememberPerson(db, jar(), { email: "ana@example.test", displayName: "Ana" }, NOW);
      expect(await rsvpMemberAction(slug, "ro", true)).toMatchObject({ refused: "none", state: { remembered: true, offered: true, going: false } });
      await rsvpGoAction(slug, "ro", false, false);
      expect(await rsvpStateAction(slug, "ro")).toEqual({ remembered: true, offered: true, going: true, showName: false, name: "Ana", count: 1 });
      const on = await rsvpMemberAction(slug, "ro", true);
      expect(on).toEqual({ state: { remembered: true, offered: true, going: true, showName: false, name: "Ana", clubMember: "DECLARED", count: 1 }, refused: null });
      expect(await publicRead()).toMatchObject({ members: 1 });
      const off = await rsvpMemberAction(slug, "ro", false);
      expect(off.state).toEqual({ remembered: true, offered: true, going: true, showName: false, name: "Ana", count: 1 });
      expect(await publicRead()).toEqual({ count: 1, names: [], others: 1 });
    });

    it("reads the cookie alone: no cookie, nothing written", async () => {
      await counted();
      expect(await rsvpMemberAction(slug, "ro", true)).toEqual({ state: { remembered: false }, refused: null });
      expect((await rowOf()).clubMember).toBeNull();
    });

    it("hands the person's own reads the kind: the account's map and the island's, and nothing in the address", async () => {
      await counted();
      await setRsvpClubMember(db, eventId, who("ana@example.test"), { clubMember: true }, NOW);
      expect(await readOwnRsvpName(db, eventId, "ana@example.test")).toEqual({ showName: false, name: "Ana", clubMember: "DECLARED" });
      expect([...(await answeredByAccount(db, "ana@example.test", [eventId])).values()]).toEqual([{ showName: false, name: "Ana", clubMember: "DECLARED" }]);
    });
  });

  describe("the editor's fold", () => {
    it("lists the kind per row and counts the confirmed members, declared or from an account", async () => {
      await answerRsvp(db, eventId, remembered("ana@example.test", { displayName: "Ana", clubMember: true }), NOW);
      await answerRsvp(db, eventId, accountIdentity({ email: "cont@example.test", displayName: "Cont", role: "ADMIN" }, "ro", false), NOW);
      await answerRsvp(db, eventId, remembered("bia@example.test"), NOW);
      await answerRsvp(db, eventId, identityOf("page", { email: "dan@example.test", showName: false, locale: "ro", clubMember: true }), NOW);
      const listed = await listRsvpsForAdmin(db, eventId);
      expect(Object.fromEntries(listed.map((row) => [row.email, row.clubMember]))).toEqual({ "ana@example.test": "DECLARED", "cont@example.test": "ACCOUNT", "bia@example.test": null, "dan@example.test": "DECLARED" });
      // Dan is not counted yet: the line counts the confirmed.
      expect(await countRsvpsForAdmin(db, eventId)).toEqual({ confirmed: 3, unconfirmed: 1, members: 2 });
    });

    it("says nothing of members when there is none", async () => {
      await answerRsvp(db, eventId, remembered("bia@example.test"), NOW);
      expect(await countRsvpsForAdmin(db, eventId)).toEqual({ confirmed: 1, unconfirmed: 0 });
    });

    it("lists the kind among everything held about a person (art. 15): the column is personal data, so «all the data of a person» says it", async () => {
      const [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
      await answerRsvp(db, eventId, remembered("ana@example.test", { displayName: "Ana", clubMember: true }), NOW);
      const data = await viewPersonData(db, admin, "ana@example.test", NOW);
      expect(data.rsvpAnswers).toHaveLength(1);
      expect(data.rsvpAnswers[0]).toMatchObject({ clubMember: "DECLARED", displayName: "Ana" });
    });
  });

  describe("the «Nu mai vin» link's page", () => {
    async function html(element: ReactElement): Promise<string> {
      const { NextIntlClientProvider } = await import("next-intl");
      const stream = await renderToReadableStream(createElement(NextIntlClientProvider, { locale: state.language, messages: messages[state.language] } as unknown as ComponentProps<typeof NextIntlClientProvider>, element));
      await stream.allReady;
      return (await new Response(stream).text()).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "").replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
    }
    const page = async (token: string, query: { invalid?: string; nume?: string; membru?: string } = {}, locale: "ro" | "en" = "ro") => {
      state.language = locale;
      return html(await RsvpLinkPage({ params: Promise.resolve({ locale, token }), searchParams: Promise.resolve(query) }));
    };
    async function withdrawLink(email = "ana@example.test") {
      await answerRsvp(db, eventId, remembered(email, { displayName: "Ana" }), NOW);
      const row = await rowOf(email);
      return (await mintRsvpLinks(db, { rsvpId: row.id, startsAt: new Date(NOW.getTime() + 2 * DAY), confirm: false, now: NOW }))!.withdraw;
    }
    const form = (token: string, fields: Record<string, string> = {}) => {
      const data = new FormData();
      data.set("locale", "ro");
      data.set("token", token);
      for (const [name, value] of Object.entries(fields)) data.set(name, value);
      return data;
    };
    const press = async (data: FormData) => {
      await setNameByLinkAction(data).catch((error: unknown) => {
        if (!(error instanceof Error) || error.message !== "NEXT_REDIRECT") throw error;
      });
      return state.redirected.at(-1);
    };

    it("draws the tick in the name's own form, unticked, with the club's sentence behind its «?», the GET writing nothing", async () => {
      const withdraw = await withdrawLink();
      const before = await rows();
      const markup = await page(withdraw);
      expect(markup).toContain("Sunt membru al grupului");
      expect(markup).toMatch(/<input[^>]*name="clubMember"[^>]*type="checkbox"|<input[^>]*type="checkbox"[^>]*name="clubMember"/);
      expect(markup).not.toMatch(/<input[^>]*name="clubMember"[^>]*checked|<input[^>]*checked[^>]*name="clubMember"/);
      expect(markup).toContain('name="memberBox" value="1"');
      expect(markup).toContain("Bifa e declarația ta; clubul nu o verifică.");
      // The platform's own words behind the «?», until the club writes its own (§789): the tooltip is the button's accessible name.
      expect(markup).toContain("Am fost la cel puțin 3 alergări de grup în ultimele 6 luni.");
      expect(markup).not.toMatch(/name="(kind|clubMemberKind|club_member)"/);
      expect(await rows()).toEqual(before);
    });

    it("draws it ticked once it is on, and says «Membru» as a fact — no box — for an answer an account made", async () => {
      const withdraw = await withdrawLink();
      await db.update(eventRsvps).set({ clubMember: "DECLARED" });
      expect(await page(withdraw)).toMatch(/<input[^>]*name="clubMember"[^>]*checked|<input[^>]*checked[^>]*name="clubMember"/);
      await db.update(eventRsvps).set({ clubMember: "ACCOUNT" });
      const fact = await page(withdraw);
      expect(fact).toContain('data-testid="rsvp-member-fact"');
      expect(fact).not.toContain('name="clubMember"');
      expect(fact).not.toContain('name="memberBox"');
      expect(await page(withdraw, {}, "en")).toContain("Member");
    });

    it("draws no tick while the notice in force does not describe the mark — and keeps a tick already given, so it can be taken back", async () => {
      const withdraw = await withdrawLink();
      await approveNotice(2, "rsvp", new Date(NOW.getTime() - HOUR));
      expect(await noticeDescribesRsvpMember(db, NOW)).toBe(false);
      expect(await page(withdraw)).not.toContain('name="clubMember"');
      await db.update(eventRsvps).set({ clubMember: "DECLARED" });
      expect(await page(withdraw)).toContain('name="clubMember"');
    });

    it("takes the tick from the same press as the name — the link is read, not spent — and says it in one sentence drawn only while the row agrees", async () => {
      const withdraw = await withdrawLink();
      expect(await press(form(withdraw, { showName: "on", name: "Ana", memberBox: "1", clubMember: "on" }))).toMatch(/\?nume=shown&membru=on$/);
      expect(await rowOf()).toMatchObject({ clubMember: "DECLARED", showName: true });
      expect((await db.select().from(eventRsvpTokens).where(eq(eventRsvpTokens.purpose, "RSVP_WITHDRAW")))[0].usedAt).toBeNull();
      expect(await page(withdraw, { nume: "shown", membru: "on" })).toContain("Gata: ești numărat printre membri.");
      // «Off» claims a state: not drawn while the row says the tick is on.
      expect(await page(withdraw, { membru: "off" })).not.toContain("nu mai ești numărat printre membri");
      expect(await press(form(withdraw, { showName: "on", name: "Ana", memberBox: "1" }))).toMatch(/\?nume=shown&membru=off$/);
      expect(await rowOf()).toMatchObject({ clubMember: null });
      expect(await page(withdraw, { membru: "off" })).toContain("Gata: nu mai ești numărat printre membri.");
    });

    it("says nothing of a tick the press left as it was: a name saved beside an untouched tick, ticked or not", async () => {
      const withdraw = await withdrawLink();
      expect(await press(form(withdraw, { showName: "on", name: "Ana", memberBox: "1" }))).toMatch(/\?nume=shown$/);
      await db.update(eventRsvps).set({ clubMember: "DECLARED" });
      expect(await press(form(withdraw, { showName: "on", name: "Ana", memberBox: "1", clubMember: "on" }))).toMatch(/\?nume=shown$/);
      expect((await rowOf()).clubMember).toBe("DECLARED");
    });

    it("changes nothing about the tick when its box was not drawn: an unticked box posts nothing, and «not drawn» is not «unticked»", async () => {
      const withdraw = await withdrawLink();
      await db.update(eventRsvps).set({ clubMember: "DECLARED" });
      expect(await press(form(withdraw, { showName: "on", name: "Ana" }))).toMatch(/\?nume=shown$/);
      expect((await rowOf()).clubMember).toBe("DECLARED");
    });

    it("never takes a kind, an address or a role from the form", async () => {
      const withdraw = await withdrawLink();
      await press(form(withdraw, { memberBox: "1", clubMember: "on", kind: "ACCOUNT", clubMemberKind: "ACCOUNT", role: "ADMIN", email: "alt@example.test", showName: "on", name: "Ana" }));
      expect(await rows()).toHaveLength(1);
      expect(await rowOf()).toMatchObject({ clubMember: "DECLARED", canonicalEmail: "ana@example.test" });
    });

    it("refuses a tick under a notice that does not describe the mark with «closed», and writes nothing", async () => {
      const withdraw = await withdrawLink();
      await approveNotice(2, "rsvp", new Date(NOW.getTime() - HOUR));
      expect(await press(form(withdraw, { memberBox: "1", clubMember: "on", showName: "on", name: "Ana" }))).toMatch(/&membru=closed$/);
      expect((await rowOf()).clubMember).toBeNull();
      expect(await page(withdraw, { membru: "closed" })).toContain("bifa de membru nu se mai poate pune");
    });

    it("draws the tick on the email's question beside the name's, in both languages", async () => {
      const [asked] = await db
        .insert(eventRsvps)
        .values({ eventId, deliveryEmail: "ana@example.test", canonicalEmail: "ana@example.test", canonicalizationVersion: 1, locale: "ro", privacyNoticeVersion: 1, askedAt: NOW, askedBasis: "SUBSCRIBER" })
        .returning();
      const links = (await mintRsvpLinks(db, { rsvpId: asked.id, startsAt: new Date(NOW.getTime() + 2 * DAY), confirm: true, confirmUntilStart: true, now: NOW }))!;
      const markup = await page(links.confirm!);
      expect(markup).toContain('name="showName"');
      expect(markup).toContain('name="clubMember"');
      expect(markup).toContain("Sunt membru al grupului");
      const english = await page(links.confirm!, {}, "en");
      expect(english).toContain("I am a member of the");
      expect(english).toContain("I have taken part in at least 3 group runs in the last 6 months.");
    });
  });
});
