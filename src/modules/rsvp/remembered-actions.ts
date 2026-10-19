"use server";

import { cookies } from "next/headers";
import { getDb } from "@/db/client";
import type { Locale } from "@/i18n/routing";
import { findPublishedEventBySlug } from "@/modules/events/repository";
import { noticeDescribesRsvp } from "@/modules/legal-documents/repository";
import { forgetPerson, readRememberedPerson, refreshPerson } from "@/modules/person-session/session";
import { identityOf } from "./domain/identity";
import { rsvpOffered } from "./domain/offered";
import type { ClubMemberKind } from "./domain/public-member";
import { answerRsvp, countRsvps, readOwnRsvpName, setRsvpClubMember, setRsvpShowName, withdrawRsvp } from "./rsvp";

/**
 * The remembered browser's one-tap «Vin!» (§811, «Vin!» part 1; the owner, 2026-10-18: «I want the flow to be super easy»).
 *
 * The event page is static for everybody (§333, §549); the one island that knows a browser is remembered
 * (`ui/RsvpRemembered.tsx`) calls these. Each reads the `httpOnly` cookie itself (`person-session/`): the island never sees
 * the secret, only what these return — and a press is only ever as strong as that cookie. An identity from the cookie is
 * `source: "remembered"`, verified (`domain/identity.ts`), so the answer is counted at once, no email.
 *
 * A "use server" file exports only async functions; the shapes are in `RsvpIslandState`'s own module.
 */

export type RsvpIslandState =
  /** The cookie is missing, expired or forgotten: the typed form stands. */
  | { remembered: false }
  /** Remembered, but the event takes no answers now (or the page is stale): the island draws nothing. */
  | { remembered: true; offered: false }
  /**
   * `showName` and `name` (§827) are the person's own tick «Numele meu apare la „Cine vine"» as it stands (the tick and a name) and the name
   * their answer holds — the island shows it beside the tick and posts it, so a name is never published unseen (§812). It is handed only to
   * the browser whose `httpOnly` cookie proves it is the person's, and never the address. `false` and null while not `going`.
   */
  | { remembered: true; offered: true; going: boolean; showName: boolean; name: string | null; clubMember?: ClubMemberKind; count: number };

/** What the member tick says back (§831): the state as it stands, and why nothing was written (a sentence of the island's own), or null. */
export type RsvpMemberResult = { state: RsvpIslandState; refused: "none" | "closed" | null };

/** What the name switch says back: the state as it stands, and why nothing was written (a sentence of the island's own), or null. */
export type RsvpNameResult = { state: RsvpIslandState; refused: "name" | "none" | "closed" | null };

async function stateFor(slug: string, locale: Locale, now: Date): Promise<RsvpIslandState> {
  const db = getDb();
  const jar = await cookies();
  const person = await readRememberedPerson(db, jar, now);
  if (!person) return { remembered: false };
  const event = await findPublishedEventBySlug(db, locale, slug);
  if (!event || !rsvpOffered(event, now, await noticeDescribesRsvp(db, now))) return { remembered: true, offered: false };
  const own = await readOwnRsvpName(db, event.id, person.canonicalEmail);
  return {
    remembered: true,
    offered: true,
    going: own !== null,
    showName: own?.showName ?? false,
    name: own?.name ?? null,
    // The member mark the answer holds (§831), present only when it holds one: `DECLARED` is the box ticked, `ACCOUNT` a fact the island says.
    ...(own?.clubMember ? { clubMember: own.clubMember } : {}),
    count: await countRsvps(db, event.id),
  };
}

function localeOf(value: string): Locale {
  return value === "en" ? "en" : "ro";
}

/** What the island asks when it mounts with a hint cookie: whether this browser is still remembered, and where it stands. */
export async function rsvpStateAction(slug: string, locale: string): Promise<RsvpIslandState> {
  return stateFor(slug, localeOf(locale), new Date());
}

/**
 * «Vin!» in one tap: the remembered address's answer, counted at once. `showName` is the person's tick on this press, and `clubMember` (§831) their
 * declared «Sunt membru» — taken only while the notice in force describes the mark (`answerRsvp` asks), and always `DECLARED`: a remembered browser
 * proves an address, never an account.
 */
export async function rsvpGoAction(slug: string, locale: string, showName: boolean, clubMember = false): Promise<RsvpIslandState> {
  const now = new Date();
  const lang = localeOf(locale);
  const db = getDb();
  const jar = await cookies();
  const person = await readRememberedPerson(db, jar, now);
  if (!person) return { remembered: false };
  const event = await findPublishedEventBySlug(db, lang, slug);
  if (!event || !rsvpOffered(event, now, await noticeDescribesRsvp(db, now))) return { remembered: true, offered: false };
  await answerRsvp(
    db,
    event.id,
    identityOf("remembered", { email: person.email, displayName: person.displayName, showName: showName && person.displayName !== null, clubMember, locale: lang }),
    now,
  );
  // An answering browser is good for another year.
  await refreshPerson(db, jar, person, now);
  return stateFor(slug, lang, now);
}

/**
 * «Numele meu apare la „Cine vine"» (§827): the remembered address's own tick on its confirmed answer, any time. The cookie says who (the
 * island never names an address); `name` is what the box holds — the answer's own name the island showed, or one typed when it held none —
 * taken only with the tick, and a name the answer already holds is never published without it (`setRsvpShowName`). Turning it off needs
 * no open event and no notice (`setRsvpShowName`); turning it on records the notice in force. No audit row, nothing about the name kept anywhere else.
 */
export async function rsvpShowNameAction(slug: string, locale: string, showName: boolean, name: string): Promise<RsvpNameResult> {
  const now = new Date();
  const lang = localeOf(locale);
  const db = getDb();
  const jar = await cookies();
  const person = await readRememberedPerson(db, jar, now);
  if (!person) return { state: { remembered: false }, refused: null };
  const event = await findPublishedEventBySlug(db, lang, slug);
  if (!event) return { state: { remembered: true, offered: false }, refused: null };
  const result = await setRsvpShowName(
    db,
    event.id,
    { identity: identityOf("remembered", { email: person.email, showName: false, locale: lang }) },
    // A typed name is the person's own, taken only with the tick; an unticked press writes nothing of it.
    { showName, displayName: showName ? name : null },
    now,
  );
  return { state: await stateFor(slug, lang, now), refused: result.ok ? null : result.reason };
}

/**
 * «Sunt membru al grupului …» (§831): the remembered address's own declared tick on its confirmed answer, any time — `rsvpShowNameAction`'s twin. The
 * cookie says who (the island never names an address). Turning it on records the notice in force and needs the event to take «Vin!» and the notice
 * to describe the mark; turning it off needs neither (`setRsvpClubMember`). An account's mark (`ACCOUNT`) is not this tick's to take away.
 */
export async function rsvpMemberAction(slug: string, locale: string, clubMember: boolean): Promise<RsvpMemberResult> {
  const now = new Date();
  const lang = localeOf(locale);
  const db = getDb();
  const jar = await cookies();
  const person = await readRememberedPerson(db, jar, now);
  if (!person) return { state: { remembered: false }, refused: null };
  const event = await findPublishedEventBySlug(db, lang, slug);
  if (!event) return { state: { remembered: true, offered: false }, refused: null };
  const result = await setRsvpClubMember(db, event.id, { identity: identityOf("remembered", { email: person.email, showName: false, locale: lang }) }, { clubMember }, now);
  return { state: await stateFor(slug, lang, now), refused: result.ok ? null : result.reason };
}

/** «Nu mai vin» in one tap. Never gated by the notice or the tick (a person may always take an answer back). */
export async function rsvpLeaveAction(slug: string, locale: string): Promise<RsvpIslandState> {
  const now = new Date();
  const lang = localeOf(locale);
  const db = getDb();
  const jar = await cookies();
  const person = await readRememberedPerson(db, jar, now);
  if (!person) return { remembered: false };
  const event = await findPublishedEventBySlug(db, lang, slug);
  if (event) {
    await withdrawRsvp(db, { eventId: event.id, identity: identityOf("remembered", { email: person.email, showName: false, locale: lang }) }, now);
    await refreshPerson(db, jar, person, now);
  }
  return stateFor(slug, lang, now);
}

/** «Nu sunt eu»: this browser is forgotten (its row deleted, both cookies cleared) and the typed form comes back. */
export async function rsvpForgetAction(): Promise<void> {
  await forgetPerson(getDb(), await cookies());
}
