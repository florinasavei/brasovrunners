import { cache } from "react";
import { getDb } from "@/db/client";
import type { EmailGroup, EmailTransport } from "@/modules/notifications/domain/email-transport";
import { gmailIsConfigured, readEmailTransport } from "@/modules/notifications/email-transport";

/** The club's roads as one backoffice render reads them: each group's setting, and whether Gmail exists here. */
export type EmailRoads = { groups: Readonly<Record<EmailGroup, EmailTransport>>; gmail: boolean };

/**
 * The club's roads for one backoffice render (§841): the transport setting (one row by key, §443)
 * and whether Gmail is configured, read once however many panels on the page word a dialog —
 * through React's per-request `cache`, like the deadlines (`deadlines/request.ts`). Its own module,
 * so a render test of one panel stubs this one read and nothing else.
 */
export const emailRoadsForThisRequest = cache(async (): Promise<EmailRoads> => {
  const setting = await readEmailTransport(getDb());
  return { groups: setting.groups, gmail: gmailIsConfigured() };
});
