import type { EmailGroup, EmailTransport } from "@/modules/notifications/domain/email-transport";

/**
 * The road one press sends its email by (§841): what the confirmation dialog promised — «Pleacă
 * prin Mailgun» — carried to the Server Action the press runs.
 *
 * The owner, 2026-10-21: «When I do any action that sends an email, I want to configure how the
 * email gets sent (Mailgun vs Gmail), what is the recommended, and a confirmation message.» So
 * every dialog that announces an email (§384) also says which road it takes today — the group's
 * setting (§443) — which road the platform recommends for that group and why, and, where both
 * roads exist, lets the reader switch to the other one **for this press alone**: the group's
 * setting stays what «Setări» → «Emailuri» says.
 *
 * **How the choice travels.** The dialog is a client island and the press is a Server Action
 * behind one of some thirty forms, none of which knows about roads. A hidden field would mean
 * every action reading and forwarding it; the one channel every action request already carries
 * is the cookie jar. So the dialog writes a cookie as it confirms — the road, the group, a
 * twenty-second expiry — and the request that follows reads it once (`email-road-request.ts`):
 * `enqueueEmail` stamps the row's `road` with it when the row's group is the dialog's, and the
 * flash names it in the toast and spends it. The cookie is short-lived and deleted by the action
 * that flashes, so it cannot outlive its press by more than its twenty seconds, and it names a
 * road and a group, never a person or a message.
 *
 * Pure: no React, no `next/headers`, so the island and the server share one encoding and the
 * unit suite walks it in Node.
 */
export const EMAIL_ROAD_COOKIE = "br-email-road";

/** How long the choice may wait for its request: the press's own round trip, and no more. */
export const EMAIL_ROAD_MAX_AGE_SECONDS = 20;

export type EmailRoadChoice = {
  road: EmailTransport;
  /** The group of the message the dialog announced: only that group's rows take the road. */
  group: EmailGroup;
};

const ROADS: readonly EmailTransport[] = ["mailgun", "gmail"];
const GROUPS: readonly EmailGroup[] = ["links", "confirmations", "reminders", "announcements", "club", "newsletter"];

/** The cookie's value: `gmail.links.1761050000000` — the road, the group, when it stops counting. */
export function encodeEmailRoadChoice(choice: EmailRoadChoice, now: number): string {
  return `${choice.road}.${choice.group}.${now + EMAIL_ROAD_MAX_AGE_SECONDS * 1000}`;
}

/**
 * The choice read back, or `null` for anything that is not one or is past its moment: a cookie
 * is the browser's to rewrite, so the road and the group are checked against the lists.
 */
export function decodeEmailRoadChoice(raw: string | undefined | null, now: number): EmailRoadChoice | null {
  if (!raw || raw.length > 64) return null;
  const [road, group, expires] = raw.split(".");
  if (!ROADS.includes(road as EmailTransport) || !GROUPS.includes(group as EmailGroup)) return null;
  if (!/^\d{1,16}$/.test(expires ?? "") || Number(expires) < now) return null;
  return { road: road as EmailTransport, group: group as EmailGroup };
}

/** The `document.cookie` line the dialog writes as it confirms: the choice, for the press's own seconds. */
export function emailRoadCookieLine(choice: EmailRoadChoice, now: number): string {
  return `${EMAIL_ROAD_COOKIE}=${encodeEmailRoadChoice(choice, now)}; Max-Age=${EMAIL_ROAD_MAX_AGE_SECONDS}; Path=/; SameSite=Lax`;
}
