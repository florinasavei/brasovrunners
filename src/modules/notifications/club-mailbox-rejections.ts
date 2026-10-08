import { listClubMailboxRejections } from "./delivery-evidence";
import { type ClubNotices, mailboxesReceivingCopies, resolveDeclarationCopies } from "./domain/club-notices";
import { type ClubMailboxGroup, groupClubMailboxRejections } from "./domain/club-mailbox-rejections";

/** The window «Adresele clubului care resping emailuri» and its «Sarcini» row read (§671). */
export const CLUB_REJECTION_WINDOW_DAYS = 30;

/** Enough refusals for the window's counts; the read stops there in SQL. */
const CLUB_REJECTION_ROWS = 500;

/**
 * The club's own mailboxes that refused its emails in the last thirty days, one entry per address
 * (`domain/club-mailbox-rejections.ts`, §671): the club's settings as they stand now decide which addresses
 * may be written (`mailboxesReceivingCopies`) and which are the declaration's copies. The caller asserts who
 * may read it — the addresses are the club's, shown to those who read the registrations (BR-REQ-060-01).
 */
export async function readClubMailboxRejections(
  db: Parameters<typeof listClubMailboxRejections>[0],
  notices: ClubNotices,
  archiveFallback: string | undefined,
  now: Date,
): Promise<ClubMailboxGroup[]> {
  const declarations = resolveDeclarationCopies(notices, archiveFallback);
  const rows = await listClubMailboxRejections(db, {
    since: new Date(now.getTime() - CLUB_REJECTION_WINDOW_DAYS * 24 * 3_600_000),
    mailboxes: mailboxesReceivingCopies(declarations, notices),
    limit: CLUB_REJECTION_ROWS,
  });
  return groupClubMailboxRejections(rows, { declarationCopies: [...declarations.cc, ...declarations.bcc] });
}
