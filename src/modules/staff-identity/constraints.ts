import { constraintsOf, type HtmlConstraints } from "@/shared/forms/constraints";
import { staffInviteSchema } from "./service";

/**
 * The HTML constraints of the "add a colleague" boxes, read off `staffInviteSchema`
 * (`DECISIONS.md` §306): the address is `type="email"` with its ceiling, the name is required
 * with its ceiling — the browser refuses first what `inviteStaffUser` would refuse.
 */
export function staffInviteConstraints(field: keyof typeof staffInviteSchema.shape): HtmlConstraints {
  return constraintsOf(staffInviteSchema, field);
}
