import { eq } from "drizzle-orm";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — a reason at every self-cancellation door (the owner, 2026-09-29: «when people cancel, they
 * need to provide a reason»): the manage page's cancel, «Înscrierile mele» and the family wizard's
 * «Renunț» each refuse a press with no answer, with «Alt motiv» and no words, or with more than 200
 * characters — back on the same page, the box named, nothing spent and nobody cancelled — and a press
 * with a reason cancels and keeps it on the row, the answer alone in the audit row.
 *
 * The actions on the real clock, as they read it, with Next's redirect caught where the browser
 * would follow it.
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
// The pages, rendered with the real catalogue.
vi.mock("next-intl/server", async (importOriginal) => {
  const { createTranslator } = await import("next-intl");
  const messages = (await import("../../../messages/ro.json")).default;
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    getTranslations: async (namespace: string) => createTranslator({ locale: "ro", messages, namespace: namespace as "Registrations" }),
    getLocale: async () => "ro",
    setRequestLocale: () => {},
  };
});
vi.mock("@/i18n/navigation", async (importOriginal) => {
  const { createElement } = await import("react");
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    Link: ({ href, children }: { href: unknown; children: ReactNode }) => createElement("a", { href: typeof href === "string" ? href : "#" }, children),
  };
});

const { issueActionToken, readActionTokenContext } = await import("@/modules/action-tokens/repository");
const { cancelRegistrationAction } = await import("@/app/[locale]/registrations/manage/[token]/actions");
const { cancelFromMyRegistrationsAction } = await import("@/app/[locale]/registrations/mine/[token]/actions");
const { withdrawFamilyPersonAction } = await import("@/app/[locale]/registrations/declare/[token]/actions");
const { default: ManageRegistrationPage } = await import("@/app/[locale]/registrations/manage/[token]/page");
const { parseCancelReason } = await import("@/modules/registrations/domain/cancel-reason");

let participantId: string;
let registrationId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  const identity = canonicalizeEmail("ana@example.ro");
  const [participant] = await db
    .insert(participants)
    .values({
      deliveryEmail: identity.deliveryEmail,
      normalizedEmail: identity.normalizedEmail,
      canonicalEmail: identity.canonicalEmail,
      canonicalizationVersion: identity.canonicalizationVersion,
      defaultName: "Ana Pop",
    })
    .returning();
  participantId = participant.id;
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date(Date.now() + 30 * DAY), registrationMode: "INTERNAL", capacity: 20, editorialStatus: "PUBLISHED", publishedAt: new Date() })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul Tâmpei", slug: "crosul-tampei" },
    { eventId: event.id, locale: "en", title: "The Tâmpa cross", slug: "tampa-cross" },
  ]);
  const [row] = await db
    .insert(registrations)
    .values({
      eventId: event.id,
      participantId,
      status: "CONFIRMED",
      locale: "ro",
      registeredName: "Ana Pop",
      displayName: "Ana P.",
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: new Date(),
      resultsNameConsent: false,
      listOptOut: false,
      resultsConsentVersion: 1,
      confirmedAt: new Date(),
      checkinCode: "ABC123",
    })
    .returning();
  registrationId = row.id;
});

async function manageLink() {
  const now = new Date();
  return (await issueActionToken(db, { participantId, registrationId, purpose: "MANAGE_REGISTRATION", expiresAt: new Date(now.getTime() + 7 * DAY), now })).secret;
}

async function profileLink() {
  const now = new Date();
  return (await issueActionToken(db, { participantId, registrationId: null, purpose: "MANAGE_PROFILE", expiresAt: new Date(now.getTime() + 7 * DAY), now })).secret;
}

function formOf(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
}

/** Where the action sent the browser. */
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

async function statusOf() {
  const [row] = await db.select().from(registrations).where(eq(registrations.id, registrationId));
  return row;
}

const TOO_LONG = "a".repeat(201);

describe("§NNN the reason for a participant's own cancellation", () => {
  it("reads the three answers, the words only for «Alt motiv», and names the box it refuses", () => {
    expect(parseCancelReason(formOf({}))).toEqual({ ok: false, problem: "kind" });
    expect(parseCancelReason(formOf({ cancelReasonKind: "BORED" }))).toEqual({ ok: false, problem: "kind" });
    expect(parseCancelReason(formOf({ cancelReasonKind: "INJURY_OR_ILLNESS", cancelReason: "genunchiul" }))).toEqual({ ok: true, reason: { kind: "INJURY_OR_ILLNESS", text: null } });
    expect(parseCancelReason(formOf({ cancelReasonKind: "OTHER_PLANS" }))).toEqual({ ok: true, reason: { kind: "OTHER_PLANS", text: null } });
    expect(parseCancelReason(formOf({ cancelReasonKind: "OTHER", cancelReason: "   " }))).toEqual({ ok: false, problem: "text" });
    expect(parseCancelReason(formOf({ cancelReasonKind: "OTHER", cancelReason: TOO_LONG }))).toEqual({ ok: false, problem: "long" });
    expect(parseCancelReason(formOf({ cancelReasonKind: "OTHER", cancelReason: "  Nunta\n fratelui " }))).toEqual({ ok: true, reason: { kind: "OTHER", text: "Nunta fratelui" } });
    // 200 characters counted as a person counts them, diacritics included.
    expect(parseCancelReason(formOf({ cancelReasonKind: "OTHER", cancelReason: "ș".repeat(200) })).ok).toBe(true);
  });

  it("the manage page: refused without a reason, the box named and the link unspent; with one, cancelled and kept", async () => {
    const secret = await manageLink();
    const base = { locale: "ro", token: secret, registrationId };
    for (const [fields, problem] of [
      [{}, "kind"],
      [{ cancelReasonKind: "OTHER" }, "text"],
      [{ cancelReasonKind: "OTHER", cancelReason: TOO_LONG }, "long"],
    ] as const) {
      const to = await redirectOf(cancelRegistrationAction(formOf({ ...base, ...fields })));
      expect(to, problem).toContain(`?reason=${problem}&person=${registrationId}#cancel-reason`);
      expect((await statusOf()).status).toBe("CONFIRMED");
    }
    expect((await readActionTokenContext(db, { secret, purpose: "MANAGE_REGISTRATION", now: new Date() })).ok).toBe(true);

    // The page it lands on names the box, under the person's own cancel.
    const html = renderToStaticMarkup(
      (await ManageRegistrationPage({ params: Promise.resolve({ locale: "ro", token: secret }), searchParams: Promise.resolve({ reason: "text", person: registrationId }) })) as ReactElement,
    );
    expect(html).toContain('id="cancel-reason"');
    expect(html).toContain("Ai ales «Alt motiv»: scrie motivul, pe scurt.");
    expect(html).toContain("De ce anulezi?");
    expect(html).toContain("Accidentare sau boală");

    const done = await redirectOf(cancelRegistrationAction(formOf({ ...base, cancelReasonKind: "OTHER", cancelReason: "Nunta fratelui" })));
    expect(done).toContain("?done=1");
    expect(await statusOf()).toMatchObject({ status: "CANCELLED", cancellationSource: "PARTICIPANT", cancelReasonKind: "OTHER", cancelReason: "Nunta fratelui" });
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.entityId, registrationId));
    expect(audit.metadataJson).toEqual({ from: "CONFIRMED", via: "MANAGE_LINK", reasonKind: "OTHER" });
  });

  it("«Înscrierile mele»: refused without a reason, the link unspent; with one, cancelled and kept", async () => {
    const secret = await profileLink();
    const base = { locale: "ro", token: secret, registrationId };
    const to = await redirectOf(cancelFromMyRegistrationsAction(formOf(base)));
    expect(to).toContain(`?reason=kind&person=${registrationId}#cancel-reason`);
    expect((await statusOf()).status).toBe("CONFIRMED");
    expect((await readActionTokenContext(db, { secret, purpose: "MANAGE_PROFILE", now: new Date() })).ok).toBe(true);

    expect(await redirectOf(cancelFromMyRegistrationsAction(formOf({ ...base, cancelReasonKind: "INJURY_OR_ILLNESS" })))).toContain("?done=1");
    expect(await statusOf()).toMatchObject({ status: "CANCELLED", cancelReasonKind: "INJURY_OR_ILLNESS", cancelReason: null });
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.entityId, registrationId));
    expect(audit.metadataJson).toEqual({ from: "CONFIRMED", via: "MY_REGISTRATIONS", reasonKind: "INJURY_OR_ILLNESS" });
  });

  it("the family wizard's «Renunț»: refused without a reason before anything is read, the box named on the step", async () => {
    const to = await redirectOf(withdrawFamilyPersonAction(formOf({ locale: "ro", token: "any-link", registrationId })));
    expect(to).toContain("?reason=kind#cancel-reason");
    const tooLong = await redirectOf(withdrawFamilyPersonAction(formOf({ locale: "ro", token: "any-link", registrationId, cancelReasonKind: "OTHER", cancelReason: TOO_LONG })));
    expect(tooLong).toContain("?reason=long#cancel-reason");
    expect((await statusOf()).status).toBe("CONFIRMED");
  });
});
