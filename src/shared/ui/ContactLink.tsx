import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { TAP_TARGET } from "./tap-target";

/**
 * "Scrie-ne" inside a sentence — the contact form as the way to ask about one's data or a
 * photograph (§NNN) — for the `<contact>` tag of a rich message: `t.rich(key, { contact:
 * (chunks) => <ContactLink>{chunks}</ContactLink> })`.
 *
 * As tall as a thumb (BR-REQ-041-01 criterion 6) while staying in the line: `inline-flex` with
 * the 44-pixel minimum, the same shape the contact page gives its own inline link.
 */
export default function ContactLink({ children }: { children: ReactNode }) {
  return (
    <Link href="/contact" style={{ display: "inline-flex", alignItems: "center", minHeight: TAP_TARGET.minHeight }}>
      {children}
    </Link>
  );
}
