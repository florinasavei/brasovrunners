import { cookies } from "next/headers";
import { env } from "@/shared/config/env";
import type { FamilySittingCookie } from "./domain/family-sitting";
import { openFormDraft, purposeSecret, sealFormDraft } from "./form-draft";

/**
 * The browser's half of a family sitting (§NNN): which sitting, the address its forms are sent
 * with, and the names typed so far — sealed (AES-256-GCM under the deployment's secret bound to
 * this purpose, the form draft's sealing), `httpOnly`, `sameSite=lax`, on the registration form's
 * own path, and alive exactly as long as the sitting holds its email. Nothing in it goes in a URL
 * (§14.5); nothing in it was read from the registrations table, so the screen that lists it back
 * says nothing about an address to anybody (§39).
 */

const COOKIE = "br_family_sitting";
const PURPOSE = "family-sitting";

export function sealFamilySittingCookie(value: FamilySittingCookie, secret = purposeSecret(PURPOSE)): string | null {
  return sealFormDraft(
    {
      s: value.sittingId ?? "",
      e: value.eventId,
      m: value.email,
      n: value.names.join("\n"),
      x: String(value.heldUntil.getTime()),
    },
    secret,
  );
}

export function openFamilySittingCookie(sealed: string, secret = purposeSecret(PURPOSE)): FamilySittingCookie | null {
  const opened = openFormDraft(sealed, secret);
  if (!opened?.e || !opened.m || !opened.x) return null;
  const heldUntil = new Date(Number(opened.x));
  if (!Number.isFinite(heldUntil.getTime())) return null;
  return {
    sittingId: opened.s ? opened.s : null,
    eventId: opened.e,
    email: opened.m,
    names: (opened.n ?? "").split("\n").filter((name) => name.trim() !== ""),
    heldUntil,
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
  const maxAge = Math.max(1, Math.ceil((value.heldUntil.getTime() - now.getTime()) / 1000));
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
