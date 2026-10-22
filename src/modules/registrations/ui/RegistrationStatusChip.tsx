import type { RegistrationStatus } from "@/db/schema/registrations";
import { REGISTRATION_STATUS_LABEL } from "@/modules/staff-identity/domain/staff-labels";
import StatusChip from "@/shared/ui/StatusChip";
import type { StatusGlyphName } from "@/shared/ui/status-glyphs";

/**
 * A registration's state as a chip (§847; the owner, 2026-10-21, of the backoffice: «they look like they are from a
 * different app»): one table — the tone, the glyph and the backoffice's word — read by every screen that names a
 * registration's state: the registrations list's «Stare» column, the registration's own page beside the name, and the
 * race-day desk's row (`DeskRow`). Each had drawn its own: a grey chip on two, the desk's own colours on the third, and
 * no glyph on any.
 *
 * The words are `REGISTRATION_STATUS_LABEL`'s, Romanian once (§35), so the three screens and the export say the same.
 * The tones are the volunteers' (`STATE_CHIP`, §754) read for a registration: amber while somebody still has to do
 * something — the address, the declaration, the offer — green once confirmed, grey for a line that waits and for a
 * registration that is over. The desk marks an ended row by its struck number and, for a printed bib, by its red line
 * (§311); the chip no longer paints it red as well.
 */
export const REGISTRATION_STATUS_CHIP: Record<RegistrationStatus, { glyph: StatusGlyphName; color: "warning" | "success" | "default"; label: string }> = {
  PENDING_EMAIL_CONFIRMATION: { glyph: "awaitingEmail", color: "warning", label: REGISTRATION_STATUS_LABEL.PENDING_EMAIL_CONFIRMATION },
  PENDING_DECLARATION: { glyph: "awaitingSignature", color: "warning", label: REGISTRATION_STATUS_LABEL.PENDING_DECLARATION },
  WAITLISTED: { glyph: "waitlisted", color: "default", label: REGISTRATION_STATUS_LABEL.WAITLISTED },
  WAITLIST_OFFERED: { glyph: "placeOffered", color: "warning", label: REGISTRATION_STATUS_LABEL.WAITLIST_OFFERED },
  CONFIRMED: { glyph: "done", color: "success", label: REGISTRATION_STATUS_LABEL.CONFIRMED },
  CANCELLED: { glyph: "cancelled", color: "default", label: REGISTRATION_STATUS_LABEL.CANCELLED },
  EXPIRED: { glyph: "expired", color: "default", label: REGISTRATION_STATUS_LABEL.EXPIRED },
};

/** The chip itself, from the table above: a Server Component handing `StatusChip` three strings (§370). */
export default function RegistrationStatusChip({ status, testId = "registration-status" }: { status: RegistrationStatus; testId?: string }) {
  const chip = REGISTRATION_STATUS_CHIP[status];
  return <StatusChip glyph={chip.glyph} color={chip.color} label={chip.label} testId={testId} />;
}
