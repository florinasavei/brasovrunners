import { cache } from "react";
import { getDb } from "@/db/client";
import { readClubNotices } from "@/modules/notifications/club-notices";
import { clubCopyRecipients, confirmationNoticeRecipients, participantMessageBcc, resolveDeclarationCopies } from "@/modules/notifications/domain/club-notices";
import { env } from "@/shared/config/env";

/**
 * How many of the club's own mailboxes an email press writes to besides the person (the design «telling the owner
 * about every email a staff press sends», slice 3): the dialog before the press says it as one quiet count —
 * «Și 2 emailuri pentru căsuțele clubului.» — never the addresses, which «Emailuri azi» lists.
 *
 * - `bcc`: the hidden copy of every participant's message (§320), one row per address — what a per-message copy and a
 *   bulk send's one copy each queue (`outbox.ts#enqueueClubCopies`, `enqueueBulkClubCopies`);
 * - `archive`: the signed declaration's archive copy on a confirmation, one email whatever its cc and bcc (§244) — 1
 *   while the club named a mailbox, or the environment did;
 * - `notices`: «cineva a confirmat» (§245), one row per mailbox.
 *
 * The club's setting is one row by key, read once per backoffice render however many dialogs a page words — through
 * React's per-request `cache`, like the roads (`email-roads-request.ts`) — and counted exactly as the enqueue counts it.
 */
export type ClubCopies = { bcc: number; archive: number; notices: number };

export const clubCopiesForThisRequest = cache(async (): Promise<ClubCopies> => {
  const setting = await readClubNotices(getDb());
  return {
    bcc: clubCopyRecipients("", participantMessageBcc(setting)).length,
    archive: resolveDeclarationCopies(setting, env.DECLARATIONS_ARCHIVE_TO).to ? 1 : 0,
    notices: confirmationNoticeRecipients(setting).length,
  };
});
