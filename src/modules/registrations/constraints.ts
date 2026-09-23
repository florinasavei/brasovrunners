import { constraintsOf, type HtmlConstraints } from "@/shared/forms/constraints";
import { staffRegistrationSubmissionSchema } from "./fields";

/**
 * The HTML constraints of the staff "new registration" boxes, read off the schema the service
 * validates them with (`DECISIONS.md` §315): the name required with its ceilings, the address
 * `type="email"` with its ceiling, every optional detail a ceiling and nothing more.
 *
 * `blankIsAbsent`, because `admin/registrations/actions.ts#optional` hands a blank detail to the
 * schema as "not given" — the staff schema accepts an absent city and refuses an empty one, and
 * an empty box here means absent (BR-REQ-031-04 criterion 5).
 */
export function staffRegistrationConstraints(field: keyof typeof staffRegistrationSubmissionSchema.shape): HtmlConstraints {
  return constraintsOf(staffRegistrationSubmissionSchema, field, { blankIsAbsent: true });
}
