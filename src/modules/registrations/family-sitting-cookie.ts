import { cookies } from "next/headers";
import { env } from "@/shared/config/env";
import { sittingCookieMaxAgeSeconds, type FamilySittingCookie, type SittingPerson } from "./domain/family-sitting";
import { openFormDraft, purposeSecret, sealFormDraft } from "./form-draft";

/**
 * The browser's half of a family sitting (§NNN): which sitting, the address its forms are sent
 * with, the people typed so far (name and birth date), the boxes a family shares for the next form
 * and the last form's birth-date clash (§493) — sealed (AES-256-GCM under the deployment's secret bound to
 * this purpose, the form draft's sealing), `httpOnly`, `sameSite=lax`, on the registration form's
 * own path, and alive as long as the sitting holds its email plus a short grace
 * (`SITTING_COOKIE_GRACE_MINUTES`), so the open screen's own press at the window's end still carries it. Nothing in it goes in a URL
 * (§14.5); nothing in it was read from the registrations table, so the screen that lists it back
 * says nothing about an address to anybody (§39).
 */

const COOKIE = "br_family_sitting";
const PURPOSE = "family-sitting";

/** One line per person: the name, a tab, the birth date as typed ("" when none). */
function peopleLines(people: readonly SittingPerson[]): string {
  return people.map((person) => `${person.name.replace(/[\t\n]/g, " ")}\t${person.birthDate}`).join("\n");
}

function peopleOf(lines: string | undefined): SittingPerson[] {
  return (lines ?? "")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const [name = "", birthDate = ""] = line.split("\t");
      return { name, birthDate };
    });
}

function sharedOf(json: string | undefined): Record<string, string> | undefined {
  if (!json) return undefined;
  try {
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") return undefined;
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === "string")) as Record<string, string>;
  } catch {
    return undefined;
  }
}

function windowMinutesOf(text: string | undefined): number | undefined {
  const minutes = text ? Number(text) : Number.NaN;
  return Number.isInteger(minutes) && minutes >= 0 ? minutes : undefined;
}

export function sealFamilySittingCookie(value: FamilySittingCookie, secret = purposeSecret(PURPOSE)): string | null {
  const base = {
    s: value.sittingId ?? "",
    e: value.eventId,
    m: value.email,
    n: peopleLines(value.people),
    x: String(value.heldUntil.getTime()),
    w: value.sameBirthDate ? `${value.sameBirthDate.typed}\t${value.sameBirthDate.kept}` : "",
    // The club's window is 0 (§NNN): nothing held, only the offer of another person.
    a: value.atOnce ? "1" : "",
    // The window the action read (§NNN): the screen names this one, not the public cache's.
    k: value.windowMinutes !== undefined ? String(value.windowMinutes) : "",
  };
  /*
    The shared boxes are a convenience: a cookie that would pass a browser's 4 KB with them keeps
    the address and the people without them, rather than losing the sitting.
  */
  return sealFormDraft({ ...base, f: value.shared ? JSON.stringify(value.shared) : "" }, secret) ?? sealFormDraft(base, secret);
}

export function openFamilySittingCookie(sealed: string, secret = purposeSecret(PURPOSE)): FamilySittingCookie | null {
  const opened = openFormDraft(sealed, secret);
  if (!opened?.e || !opened.m || !opened.x) return null;
  const heldUntil = new Date(Number(opened.x));
  if (!Number.isFinite(heldUntil.getTime())) return null;
  const [typed = "", kept = ""] = (opened.w ?? "").split("\t");
  return {
    sittingId: opened.s ? opened.s : null,
    eventId: opened.e,
    email: opened.m,
    people: peopleOf(opened.n),
    heldUntil,
    atOnce: opened.a === "1" ? true : undefined,
    windowMinutes: windowMinutesOf(opened.k),
    shared: sharedOf(opened.f),
    sameBirthDate: typed !== "" && kept !== "" ? { typed, kept } : null,
  };
}

/** The sitting this browser holds, whatever its state; the caller asks `sittingCookieLive`. */
export async function readFamilySittingCookie(): Promise<FamilySittingCookie | null> {
  const sealed = (await cookies()).get(COOKIE)?.value;
  return sealed ? openFamilySittingCookie(sealed) : null;
}

export async function writeFamilySittingCookie(value: FamilySittingCookie, path: string, now: Date): Promise<void> {
  const sealed = sealFamilySittingCookie(value);
  if (!sealed) return;
  // The window's end plus the grace (§NNN): the automatic «Gata» at that instant still carries the cookie.
  const maxAge = sittingCookieMaxAgeSeconds(value.heldUntil, now);
  (await cookies()).set(COOKIE, sealed, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.APP_BASE_URL.startsWith("https://"),
    path,
    maxAge,
  });
}

/** «Gata» was pressed: the sitting takes no more forms on this browser. */
export async function clearFamilySittingCookie(path: string): Promise<void> {
  (await cookies()).set(COOKIE, "", { httpOnly: true, sameSite: "lax", secure: env.APP_BASE_URL.startsWith("https://"), path, maxAge: 0 });
}
