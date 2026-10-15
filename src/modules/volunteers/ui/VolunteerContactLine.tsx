import ContactSupportIcon from "@mui/icons-material/ContactSupport";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";
import { formatPhone } from "@/modules/registrations/phone";
import { INLINE_TAP_TARGET, TAP_TARGET } from "@/shared/ui/tap-target";
import type { CategoryContact } from "../domain/volunteer";

/** Whether a category's contact has anything to say: at least one of its three boxes (§774). */
export function hasVolunteerContact(contact: CategoryContact | null): contact is CategoryContact {
  return contact !== null && (contact.name !== null || contact.phone !== null || contact.email !== null);
}

/**
 * «Întrebări? Ana · 0712 345 678 · ana@club.test» — the contact person the club set for a category's volunteers (§774; the owner,
 * 2026-10-14: «trebuie să fie o persoană de contact pentru voluntari»), under that category's heading on the volunteers' page.
 *
 * A Server Component with no state: the words come in (`label`, the page's «Întrebări?»), the three boxes are each optional, and a
 * contact with none of them draws nothing. The telephone is a `tel:` link and the address a `mailto:` one, each 44 pixels tall
 * for a thumb: the first link reaches above its words (`INLINE_TAP_TARGET`), a later one — which may wrap to the line under the
 * first, where that reach would cover the first's lower half — takes `TAP_TARGET`'s own shape, as the contact page's second address
 * does (§480). The telephone is read grouped («+40 712 345 678», `formatPhone`) while its link keeps the digits. It is the club's own business contact, published by the club's choice.
 */
export default function VolunteerContactLine({ contact, label }: { contact: CategoryContact | null; label: string }) {
  if (!hasVolunteerContact(contact)) return null;
  const stretched = { display: "inline-flex", alignItems: "center", ...TAP_TARGET } as const;
  let links = 0;
  const linkSx = () => (links++ === 0 ? INLINE_TAP_TARGET : stretched);
  const parts: ReactNode[] = [];
  if (contact.name) parts.push(<span key="name">{contact.name}</span>);
  if (contact.phone) {
    parts.push(
      <Box key="phone" component="a" href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`} sx={linkSx()} data-testid="volunteer-contact-phone">
        {formatPhone(contact.phone)}
      </Box>,
    );
  }
  if (contact.email) {
    parts.push(
      <Box key="email" component="a" href={`mailto:${contact.email}`} sx={{ ...linkSx(), overflowWrap: "anywhere" }} data-testid="volunteer-contact-email">
        {contact.email}
      </Box>,
    );
  }
  return (
    <Typography variant="body2" color="text.secondary" data-testid="volunteer-contact">
      <ContactSupportIcon aria-hidden sx={{ fontSize: 18, verticalAlign: "text-bottom", mr: 0.5 }} />
      <Box component="span" sx={{ fontWeight: 600 }}>
        {label}
      </Box>{" "}
      {parts.flatMap((part, index) => (index === 0 ? [part] : [" · ", part]))}
    </Typography>
  );
}
