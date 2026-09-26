import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { INLINE_TAP_TARGET } from "./tap-target";

/**
 * "Scrie-ne" inside a sentence — the contact form as the way to ask about one's data or a
 * photograph (§323) — for the `<contact>` tag of a rich message: `t.rich(key, { contact:
 * (chunks) => <ContactLink>{chunks}</ContactLink> })`.
 *
 * As tall as a thumb (BR-REQ-041-01 criterion 6) while staying in the line: 44 pixels of reach
 * above its words, given back as a negative margin so the line keeps its height (`INLINE_TAP_TARGET`,
 * §NNN), the same shape the contact page gives its own inline links.
 */
export default function ContactLink({ children }: { children: ReactNode }) {
  return (
    <Link href="/contact" style={INLINE_TAP_TARGET}>
      {children}
    </Link>
  );
}
